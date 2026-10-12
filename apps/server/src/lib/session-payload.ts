import { prisma } from "./prisma";
import { toMembership, toPublicUser, toTenantSummary } from "./serializers";
import { resolveEffectiveTenantMembership } from "./tenant-access";

/**
 * 会话响应组装（供「无 cookie 客户端」复用：微信小程序登录、小程序密码登录）。
 *
 * 为什么单独放一个文件：网页端走 cookie，小程序走 bearer token，但
 * 「返回哪些字段、怎么选墙、怎么取封禁状态」必须完全一致，否则两个客户端的
 * 行为会漂移。这里只依赖 prisma 与序列化函数，不 import lib/auth，
 * 避免 auth.ts 反过来 import 本文件时形成循环依赖。
 */

export const tenantSummaryInclude = {
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

/** 载入登录所需用户及其成员关系（含租户摘要字段）。 */
export async function loadUserForLogin(userId: string) {
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

export type LoadedUser = NonNullable<Awaited<ReturnType<typeof loadUserForLogin>>>;

/**
 * 选墙规则与网页端一致：优先显式指定的 tenantId（且确有成员关系），
 * 否则退回该用户的第一个校园墙（单墙自托管场景即唯一那面墙）。
 */
export function resolveTenantId(user: LoadedUser, requestedTenantId?: string) {
  if (requestedTenantId && user.memberships.some((membership) => membership.tenantId === requestedTenantId)) {
    return requestedTenantId;
  }
  return user.memberships[0]?.tenantId ?? null;
}

/** 组装小程序/纯 API 客户端登录后的会话响应（与 /api/auth/login 对齐，另附 bearer token）。 */
export async function buildSessionPayload(user: LoadedUser, tenantId: string | null, token: string) {
  const effectiveMembership = tenantId
    ? resolveEffectiveTenantMembership({
        userId: user.id,
        systemRole: user.systemRole,
        tenantId,
        memberships: user.memberships,
      })
    : null;
  const membership = tenantId ? user.memberships.find((item) => item.tenantId === tenantId) : undefined;

  // 与 lib/auth.ts 的 findActiveBan 同义；此处内联以避免循环依赖。
  const activeBan =
    tenantId && membership
      ? await prisma.banRecord.findFirst({
          where: {
            tenantId,
            userId: user.id,
            endsAt: {
              gt: new Date(),
            },
          },
          orderBy: {
            endsAt: "desc",
          },
        })
      : null;

  return {
    authenticated: true,
    token,
    user: toPublicUser(user),
    memberships: user.memberships.map(toMembership),
    currentTenant: membership ? toTenantSummary(membership.tenant) : null,
    currentMembership: effectiveMembership
      ? { id: effectiveMembership.id, role: effectiveMembership.role }
      : null,
    activeBan: activeBan
      ? {
          id: activeBan.id,
          comment: activeBan.comment,
          startsAt: activeBan.startsAt.toISOString(),
          endsAt: activeBan.endsAt.toISOString(),
          createdAt: activeBan.createdAt.toISOString(),
        }
      : null,
    needsTenantSelection: false,
    hostLocked: false,
  };
}

/** 账号字符串 → 邮箱或 QQ 号（与网页端登录同一套判定）。 */
export function parseAccount(account: string): { email: string | null; qqUin: bigint | null } {
  const trimmed = account.trim();
  const email = trimmed.includes("@") ? trimmed.toLowerCase() : null;
  const qqUin = /^[1-9]\d{4,9}$/.test(trimmed) ? BigInt(trimmed) : null;
  return { email, qqUin };
}
