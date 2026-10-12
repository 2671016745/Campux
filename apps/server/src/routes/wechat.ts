import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CampuxConfig } from "@campux/config";
import { createManyDedup, verifyPassword } from "@campux/db";
import { createSession, findActiveBan, hashToken, setSessionCookie } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { toMembership, toPublicUser, toTenantSummary } from "../lib/serializers";
import { resolveEffectiveTenantMembership } from "../lib/tenant-access";

/**
 * 微信小程序登录路由。
 *
 * 与网页端「聚合登录」的区别：小程序没有浏览器 cookie，也没有可回跳的授权页，
 * 因此这里提供纯 JSON 接口，登录成功后返回 bearer token，由小程序存入本地存储，
 * 后续请求以 `Authorization: Bearer <token>` 携带（见 lib/auth.ts 的 getSessionContext）。
 *
 * ── 绑定模型（重要）────────────────────────────────────────────────────
 * 微信身份（openid）不自动建号，沿用仓库既有约定「第三方身份只做登录、不注册」：
 * openid 未绑定任何 Campux 账号时，login 返回 `{ unbound: true }`，小程序引导用户
 * 输入已有账号（QQ 号 / QQ 邮箱）与密码，调用 /api/wechat/bind 绑定并登录。
 *
 * bind 必须用小程序新取的 code 在服务端换 openid，绝不能让客户端把 openid 传上来，
 * 否则任何人都能伪造 openid 抢绑他人账号。
 */

const WECHAT_PROVIDER = "wechat_miniprogram";

const tenantSummaryInclude = {
  metadata: {
    where: {
      key: "logo_url" as const,
    },
  },
  aiSettings: {
    select: {
      enabled: true,
    },
  },
  _count: {
    select: {
      botAccounts: true,
      posts: {
        where: {
          status: "pending_approval" as const,
        },
      },
    },
  },
} as const;

const loginBodySchema = z.object({
  code: z.string().trim().min(1, "缺少微信登录 code"),
  tenantId: z.string().trim().min(1).optional(),
});

const bindBodySchema = z.object({
  code: z.string().trim().min(1, "缺少微信登录 code"),
  account: z.string().trim().min(1, "请输入 QQ 号或 QQ 邮箱"),
  password: z.string().min(1, "请输入密码"),
  tenantId: z.string().trim().min(1).optional(),
});

class WechatRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * 把 zod 校验失败转成 400 + 首条中文提示。
 * 仓库没有全局 errorHandler，若不显式处理，ZodError 会变成 500。
 */
function parseOrReply<T>(
  schema: z.ZodType<T>,
  value: unknown,
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
): { ok: true; data: T } | { ok: false } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const first = result.error.issues[0];
  reply.code(400).send({ message: first?.message ?? "请求参数不正确" });
  return { ok: false };
}

/** 用 code 调微信 code2session 换 openid。openid 只在服务端流转，不返回给客户端。 */
async function exchangeCodeForOpenId(app: FastifyInstance, code: string) {
  // 仅开发环境：允许用 WECHAT_DEV_FAKE_OPENID 跳过真实 code2session，
  // 便于本地/开发者工具端到端联调（生产环境该分支永不生效）。
  // openid 由「前缀 + code」派生，这样不同 code 代表不同微信身份，
  // 同一个 code 重复使用则代表同一身份（可用来验证「已绑定直接登录」）。
  if (process.env.WECHAT_DEV_FAKE_OPENID && process.env.NODE_ENV !== "production") {
    app.log.warn("WECHAT_DEV_FAKE_OPENID is set: skipping real code2session (development only)");
    return `${process.env.WECHAT_DEV_FAKE_OPENID}:${code}`;
  }

  const appId = process.env.WECHAT_APPID;
  const appSecret = process.env.WECHAT_APPSECRET;
  if (!appId || !appSecret) {
    throw new WechatRequestError(
      "服务器未配置微信小程序凭证（WECHAT_APPID / WECHAT_APPSECRET），请联系管理员",
      503,
    );
  }

  const url =
    `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appId)}` +
    `&secret=${encodeURIComponent(appSecret)}&js_code=${encodeURIComponent(code)}` +
    `&grant_type=authorization_code`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    app.log.warn({ err: error }, "wechat code2session request failed");
    throw new WechatRequestError("微信服务网络异常，请稍后重试", 502);
  }
  if (!response.ok) {
    app.log.warn({ status: response.status }, "wechat code2session non-2xx");
    throw new WechatRequestError("微信服务暂不可用，请稍后重试", 502);
  }

  const data = (await response.json()) as {
    openid?: string;
    session_key?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (data.errcode || !data.openid) {
    app.log.warn({ errcode: data.errcode, errmsg: data.errmsg }, "wechat code2session rejected");
    throw new WechatRequestError(data.errmsg?.trim() || "微信登录失败，请重试", 400);
  }
  return data.openid;
}

/** 载入登录所需用户及其成员关系（含租户摘要字段）。 */
async function loadUserForLogin(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: {
          tenant: {
            include: tenantSummaryInclude,
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });
}

type LoadedUser = NonNullable<Awaited<ReturnType<typeof loadUserForLogin>>>;

/**
 * 选墙规则与网页端一致：优先显式指定的 tenantId（且确有成员关系），
 * 否则退回该用户的第一个校园墙（单墙自托管场景即唯一那面墙）。
 */
function resolveTenantId(user: LoadedUser, requestedTenantId?: string) {
  if (requestedTenantId && user.memberships.some((membership) => membership.tenantId === requestedTenantId)) {
    return requestedTenantId;
  }
  return user.memberships[0]?.tenantId ?? null;
}

/** 组装小程序登录后的会话响应（与 /api/auth/login 对齐，另附 bearer token）。 */
async function buildSessionPayload(user: LoadedUser, tenantId: string | null, token: string) {
  const effectiveMembership = tenantId
    ? resolveEffectiveTenantMembership({
        userId: user.id,
        systemRole: user.systemRole,
        tenantId,
        memberships: user.memberships,
      })
    : null;
  const membership = tenantId ? user.memberships.find((item) => item.tenantId === tenantId) : undefined;

  return {
    authenticated: true,
    token,
    user: toPublicUser(user),
    memberships: user.memberships.map(toMembership),
    currentTenant: membership ? toTenantSummary(membership.tenant) : null,
    currentMembership: effectiveMembership
      ? { id: effectiveMembership.id, role: effectiveMembership.role }
      : null,
    activeBan: tenantId && membership ? await findActiveBan(tenantId, user.id) : null,
    needsTenantSelection: false,
    hostLocked: false,
  };
}

export function registerWechatRoutes(app: FastifyInstance, _config: CampuxConfig) {
  // ─── 微信登录：openid 已绑定则直接登录 ─────────────────────────────────
  app.post("/api/wechat/login", async (request, reply) => {
    const parsed = parseOrReply(loginBodySchema, request.body ?? {}, reply);
    if (!parsed.ok) {
      return;
    }
    const body = parsed.data;
    let openid: string;
    try {
      openid = await exchangeCodeForOpenId(app, body.code);
    } catch (error) {
      if (error instanceof WechatRequestError) {
        return reply.code(error.status).send({ message: error.message });
      }
      throw error;
    }

    const identity = await prisma.oAuthIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: WECHAT_PROVIDER,
          providerUserId: openid,
        },
      },
    });

    // 未绑定：不建号，交由小程序引导用户绑定已有账号。
    if (!identity) {
      return { unbound: true };
    }

    const user = await loadUserForLogin(identity.userId);
    if (!user) {
      return reply.code(409).send({ message: "绑定的账号已不存在，请联系管理员" });
    }

    const tenantId = resolveTenantId(user, body.tenantId);
    const token = await createSession(user.id, tenantId);
    setSessionCookie(reply, token);
    return buildSessionPayload(user, tenantId, token);
  });

  // ─── 首次绑定：用已有账号的 QQ 号/邮箱 + 密码绑定微信并登录 ──────────────
  app.post("/api/wechat/bind", async (request, reply) => {
    const parsed = parseOrReply(bindBodySchema, request.body ?? {}, reply);
    if (!parsed.ok) {
      return;
    }
    const body = parsed.data;
    let openid: string;
    try {
      openid = await exchangeCodeForOpenId(app, body.code);
    } catch (error) {
      if (error instanceof WechatRequestError) {
        return reply.code(error.status).send({ message: error.message });
      }
      throw error;
    }

    const account = body.account.trim();
    const email = account.includes("@") ? account.toLowerCase() : null;
    const qqUin = /^[1-9]\d{4,9}$/.test(account) ? BigInt(account) : null;
    if (!email && qqUin === null) {
      return reply.code(400).send({ message: "请输入 QQ 号或 QQ 邮箱" });
    }

    const user = await prisma.user.findUnique({
      where: email ? { email } : { qqUin: qqUin! },
      select: { id: true, passwordHash: true, isTestAccount: true },
    });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.code(401).send({ message: "账号或密码错误" });
    }
    if (user.isTestAccount && process.env.NODE_ENV !== "development") {
      return reply.code(403).send({ message: "测试账号只能在开发环境登录" });
    }

    // 该 openid 已绑定其他账号 → 拒绝，防止把别人的微信抢绑过来。
    const existing = await prisma.oAuthIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: WECHAT_PROVIDER,
          providerUserId: openid,
        },
      },
    });
    if (existing && existing.userId !== user.id) {
      return reply.code(409).send({ message: "该微信已绑定其他账号，请先解绑" });
    }
    if (!existing) {
      // 跨数据库安全：postgres 走 createMany(skipDuplicates)，sqlite 由 createManyDedup 去重；
      // 并发下仍可能撞唯一键（P2002），捕获后复核归属，幂等或明确报错。
      try {
        await createManyDedup(
          prisma.oAuthIdentity,
          [{ userId: user.id, provider: WECHAT_PROVIDER, providerUserId: openid }],
          (row) => `${row.provider}:${row.providerUserId}`,
        );
        app.log.info(`[wechat] bound openid -> user ${user.id}`);
      } catch (error) {
        const raced = await prisma.oAuthIdentity.findUnique({
          where: {
            provider_providerUserId: {
              provider: WECHAT_PROVIDER,
              providerUserId: openid,
            },
          },
        });
        if (!raced || raced.userId !== user.id) {
          app.log.warn({ err: error }, "wechat bind conflicted with another account");
          return reply.code(409).send({ message: "该微信已被其他账号绑定" });
        }
      }
    }

    const loaded = await loadUserForLogin(user.id);
    if (!loaded) {
      return reply.code(409).send({ message: "账号状态异常，请稍后重试" });
    }
    const tenantId = resolveTenantId(loaded, body.tenantId);
    const token = await createSession(loaded.id, tenantId);
    setSessionCookie(reply, token);
    return buildSessionPayload(loaded, tenantId, token);
  });

  // ─── 解绑（供小程序「设置」页使用）────────────────────────────────────
  app.post("/api/wechat/unbind", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return reply.code(401).send({ message: "请先登录" });
    }
    const token = authHeader.slice("Bearer ".length);
    const session = await prisma.accountSession.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return reply.code(401).send({ message: "登录已过期，请重新登录" });
    }
    await prisma.oAuthIdentity.deleteMany({
      where: { userId: session.userId, provider: WECHAT_PROVIDER },
    });
    return { ok: true };
  });
}
