import { createClerkClient, verifyToken } from '@clerk/backend';
import type { Role } from '@flagship/contracts';
import { fail } from './services';

export type Identity = {
  userId: string;
  organizationId: string;
  organizationName: string;
  name: string;
  email: string;
  role: Role;
};
export type Authenticate = (authorization: string | undefined) => Promise<Identity>;

export function organizationRole(role: string): Role {
  if (role === 'org:admin') return 'admin';
  if (role === 'org:member') return 'member';
  if (role === 'org:auditor') return 'auditor';
  return fail(403, 'Unsupported organization role');
}

// Bearer-only authentication avoids shared-cookie organization confusion between tabs.
export async function verifySession(
  token: string,
  options: {
    secretKey?: string;
    jwtKey?: string;
    authorizedParties: string[];
  },
) {
  try {
    const claims = await verifyToken(token, options);
    if (
      !claims.sub ||
      !claims.sid ||
      !claims.azp ||
      !options.authorizedParties.includes(claims.azp)
    )
      return fail(401, 'Invalid session');
    const organizationId = (claims.o as { id?: string } | undefined)?.id ?? claims.org_id;
    if (!organizationId) return fail(403, 'Select an organization first');
    return { userId: claims.sub, organizationId };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 403) throw error;
    return fail(401, 'Invalid or expired Clerk session');
  }
}

export function createAuthentication(authorizedParties: string[]): Authenticate {
  return async (authorization) => {
    if (!authorization?.startsWith('Bearer ')) return fail(401, 'Sign in required');
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return fail(503, 'Clerk is not configured');
    const identity = await verifySession(authorization.slice(7), { secretKey, authorizedParties });
    const clerk = createClerkClient({ secretKey });
    // Check current membership on every management request: removal/demotion takes effect
    // immediately, without relying on stale role claims in an otherwise valid token.
    let memberships;
    try {
      memberships = await clerk.organizations.getOrganizationMembershipList({
        organizationId: identity.organizationId,
        userId: [identity.userId],
        limit: 1,
      });
    } catch (error) {
      if ((error as { status?: number }).status === 404)
        return fail(403, 'Organization access denied');
      return fail(503, 'Unable to verify organization membership');
    }
    const membership = memberships.data.find((m) => m.publicUserData?.userId === identity.userId);
    if (!membership) return fail(403, 'Organization access denied');
    const data = membership.publicUserData;
    return {
      ...identity,
      organizationName: membership.organization.name,
      role: organizationRole(membership.role),
      name:
        [data?.firstName, data?.lastName].filter(Boolean).join(' ') ||
        data?.identifier ||
        identity.userId,
      email: data?.identifier ?? '',
    };
  };
}
