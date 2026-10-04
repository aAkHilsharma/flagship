import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { organizationRole, verifySession } from '../apps/api/src/clerk';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const options = {
  jwtKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  authorizedParties: ['http://localhost:5173'],
};
function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test' })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'user_test',
      sid: 'sess_test',
      iss: 'https://test.clerk.accounts.dev',
      azp: 'http://localhost:5173',
      iat: now,
      nbf: now - 1,
      exp: now + 60,
      v: 2,
      o: { id: 'org_test', rol: 'admin' },
      ...overrides,
    }),
  ).toString('base64url');
  const body = header + '.' + payload;
  return body + '.' + sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url');
}
describe('Clerk session boundary', () => {
  it('verifies signed sessions and derives the active organization', async () => {
    await expect(verifySession(token(), options)).resolves.toEqual({
      userId: 'user_test',
      organizationId: 'org_test',
    });
    await expect(
      verifySession(token({ o: undefined, org_id: 'org_legacy' }), options),
    ).resolves.toEqual({ userId: 'user_test', organizationId: 'org_legacy' });
  });
  it('rejects tampering, expired tokens, wrong origins, and missing session IDs', async () => {
    const valid = token().split('.');
    valid[1] = Buffer.from(
      JSON.stringify({ sub: 'user_attacker', sid: 'sess_test', o: { id: 'org_victim' } }),
    ).toString('base64url');
    for (const value of [
      valid.join('.'),
      token({ exp: 1 }),
      token({ azp: 'https://attacker.invalid' }),
      token({ sid: undefined }),
      token({ azp: undefined }),
      'fs_not_a_session',
    ]) {
      await expect(verifySession(value, options)).rejects.toMatchObject({ statusCode: 401 });
    }
  });
  it('requires an active organization and fails closed for unknown roles', async () => {
    await expect(verifySession(token({ o: undefined }), options)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(organizationRole('org:admin')).toBe('admin');
    expect(organizationRole('org:member')).toBe('member');
    expect(organizationRole('org:auditor')).toBe('auditor');
    expect(() => organizationRole('org:unknown')).toThrow('Unsupported organization role');
  });
});
