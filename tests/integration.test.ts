import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { buildApp } from '../apps/api/src/app';
import { defaultDatabaseUrl } from '../apps/api/src/db';
import { migrate } from '../apps/api/src/migrate';
import { audit, flagVersions, outbox, applications } from '../apps/api/src/schema';
import type { Authenticate, Identity } from '../apps/api/src/clerk';
import { fail } from '../apps/api/src/services';
import { FlagshipClient } from '../packages/sdk/src/index';

const dbName = 'flagship_test_' + randomUUID().replaceAll('-', '');
const rootUrl = process.env.TEST_DATABASE_URL ?? defaultDatabaseUrl;
const adminClient = postgres(rootUrl, { max: 1 });
const testUrl = new URL(rootUrl);
testUrl.pathname = '/' + dbName;
let server: Awaited<ReturnType<typeof buildApp>>,
  baseUrl: string,
  cookie: string,
  applicationId: string,
  featureId: string,
  flagId: string,
  key: string;
const identities = new Map<string, Identity>([
  [
    'owner',
    {
      userId: 'user_owner',
      organizationId: 'org_alpha',
      organizationName: 'Alpha',
      name: 'Owner',
      email: 'owner@test.local',
      role: 'admin',
    },
  ],
  [
    'member',
    {
      userId: 'user_member',
      organizationId: 'org_alpha',
      organizationName: 'Alpha',
      name: 'Member',
      email: 'member@test.local',
      role: 'member',
    },
  ],
  [
    'auditor',
    {
      userId: 'user_auditor',
      organizationId: 'org_alpha',
      organizationName: 'Alpha',
      name: 'Auditor',
      email: 'auditor@test.local',
      role: 'auditor',
    },
  ],
  [
    'other',
    {
      userId: 'user_other',
      organizationId: 'org_beta',
      organizationName: 'Beta',
      name: 'Other',
      email: 'other@test.local',
      role: 'admin',
    },
  ],
]);
const authenticate: Authenticate = async (authorization) => {
  const identity = identities.get(authorization?.replace(/^Bearer /, '') ?? '');
  if (!identity) return fail(401, 'Invalid session');
  return identity;
};
const userContext = { key: 'employee-1', attributes: { employee: true, country: 'IN' } };
async function call(method: string, url: string, payload?: unknown, session = cookie) {
  return server.app.inject({
    method: method as 'GET',
    url,
    headers: session ? { authorization: 'Bearer ' + session } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}
async function eventually(check: () => boolean | Promise<boolean>, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Condition not reached before timeout');
}
beforeAll(async () => {
  await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
  await migrate(testUrl.toString());
  server = await buildApp({ authenticate, databaseUrl: testUrl.toString(), logger: false });
  baseUrl = await server.app.listen({ port: 0, host: '127.0.0.1' });
  cookie = 'owner';
  const app = await call('POST', '/applications', { name: 'Test storefront', key: 'test-store' });
  expect(app.statusCode).toBe(201);
  applicationId = app.json().id;
  const feature = await call('POST', '/features', { applicationId, name: 'Checkout' });
  expect(feature.statusCode).toBe(201);
  featureId = feature.json().id;
  const flag = await call('POST', '/flags', {
    applicationId,
    featureId,
    key: 'new-checkout',
    name: 'New checkout',
  });
  expect(flag.statusCode).toBe(201);
  flagId = flag.json().id;
  const credential = await call('POST', `/applications/${applicationId}/credentials`, {
    name: 'Test SDK',
  });
  expect(credential.statusCode).toBe(201);
  key = credential.json().token;
});
afterAll(async () => {
  if (server) await server.app.close();
  await adminClient.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await adminClient.end();
});

describe('database-backed management and delivery', () => {
  it('removes legacy auth routes, requires Clerk auth and blocks foreign origins', async () => {
    for (const url of ['/signup', '/login', '/users'])
      expect((await call('POST', url, {})).statusCode).toBe(404);
    expect((await call('GET', '/applications', undefined, '')).statusCode).toBe(401);
    expect(
      (await server.app.inject({ url: '/applications', headers: { cookie: 'fs_session=old' } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await server.app.inject({
          method: 'POST',
          url: '/applications',
          headers: { authorization: 'Bearer owner', origin: 'https://attacker.invalid' },
          payload: { name: 'Bad', key: 'bad-app' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('enforces organization roles', async () => {
    expect(
      (await call('POST', '/applications', { name: 'No', key: 'no-app' }, 'member')).statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', '/flags/' + flagId, { expectedVersion: 1, fallback: true }, 'member'))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', '/flags/' + flagId, { expectedVersion: 1, enabled: true }, 'auditor'))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', '/flags/' + flagId, { expectedVersion: 1, enabled: true }, 'member'))
        .statusCode,
    ).toBe(200);
    expect(JSON.stringify((await call('GET', '/me')).json())).not.toContain('passwordHash');
  });
  it('isolates every resource path between organizations', async () => {
    expect((await call('GET', '/applications', undefined, 'other')).json()).toEqual([]);
    const ruleId = randomUUID();
    const credential = (
      await call('POST', `/applications/${applicationId}/credentials`, { name: 'Isolation check' })
    ).json();
    const requests: [string, string, unknown?][] = [
      ['GET', `/applications/${applicationId}`],
      ['PATCH', `/applications/${applicationId}`, { name: 'Stolen' }],
      ['DELETE', `/applications/${applicationId}`],
      ['GET', `/features?applicationId=${applicationId}`],
      ['POST', '/features', { applicationId, name: 'Stolen' }],
      ['GET', `/features/${featureId}`],
      ['PATCH', `/features/${featureId}`, { name: 'Stolen' }],
      ['DELETE', `/features/${featureId}`],
      ['GET', `/flags?applicationId=${applicationId}`],
      ['POST', '/flags', { applicationId, featureId, key: 'stolen', name: 'Stolen' }],
      ['GET', `/flags/${flagId}`],
      ['PATCH', `/flags/${flagId}`, { expectedVersion: 2, enabled: false }],
      ['DELETE', `/flags/${flagId}`, { expectedVersion: 2 }],
      ['GET', `/flags/${flagId}/versions`],
      ['POST', `/flags/${flagId}/revert`, { expectedVersion: 2, version: 1 }],
      ['GET', `/flags/${flagId}/rules`],
      ['POST', `/flags/${flagId}/rules`, {}],
      ['PATCH', `/flags/${flagId}/rules/${ruleId}`, {}],
      ['DELETE', `/flags/${flagId}/rules/${ruleId}`, {}],
      ['GET', `/applications/${applicationId}/credentials`],
      ['POST', `/applications/${applicationId}/credentials`, { name: 'Stolen' }],
      ['POST', `/credentials/${credential.id}/rotate`, {}],
      ['DELETE', `/credentials/${credential.id}`],
      ['GET', `/audit?applicationId=${applicationId}`],
    ];
    for (const [method, url, payload] of requests)
      expect((await call(method, url, payload, 'other')).statusCode, `${method} ${url}`).toBe(404);
    expect((await call('GET', '/audit', undefined, 'other')).json()).toEqual([]);
    const otherApp = await call(
      'POST',
      '/applications',
      { name: 'Same key, different org', key: 'test-store' },
      'other',
    );
    expect(otherApp.statusCode).toBe(201);
    expect(
      (await call('POST', '/applications', { name: 'Duplicate', key: 'test-store' }, 'other'))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          'POST',
          '/applications',
          { name: 'Forged', key: 'forged', organizationId: 'org_alpha' },
          'other',
        )
      ).statusCode,
    ).toBe(400);
    const unowned = (
      await server.db.insert(applications).values({ name: 'Legacy', key: 'legacy' }).returning()
    )[0];
    expect((await call('GET', '/applications/' + unowned.id)).statusCode).toBe(404);
    // One identity can be an administrator in one organization and a reader in another.
    identities.set('owner-beta', {
      ...identities.get('owner')!,
      organizationId: 'org_beta',
      organizationName: 'Beta',
      role: 'auditor',
    });
    expect((await call('GET', '/applications', undefined, 'owner-beta')).json()).toHaveLength(1);
    expect(
      (await call('POST', '/applications', { name: 'Denied', key: 'denied' }, 'owner-beta'))
        .statusCode,
    ).toBe(403);
    expect((await call('GET', '/me')).json().role).toBe('admin');
  });
  it('makes concurrent edits atomic with one winner and one conflict', async () => {
    const current = (await call('GET', '/flags/' + flagId)).json();
    const results = await Promise.all([
      call('PATCH', '/flags/' + flagId, { expectedVersion: current.version, enabled: false }),
      call('PATCH', '/flags/' + flagId, { expectedVersion: current.version, enabled: true }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const after = (await call('GET', '/flags/' + flagId)).json();
    expect(after.version).toBe(current.version + 1);
    const history = await server.db
      .select()
      .from(flagVersions)
      .where(eq(flagVersions.flagId, flagId));
    expect(history).toHaveLength(after.version);
    const records = await server.db.select().from(audit).where(eq(audit.resourceId, flagId));
    expect(records.filter((r) => r.action === 'flag.update')).toHaveLength(2);
  });
  it('rejects cross-application features and limits SDK access to its application', async () => {
    const other = (
      await call('POST', '/applications', { name: 'Other app', key: 'other-app' })
    ).json();
    expect(
      (
        await call('POST', '/flags', {
          applicationId: other.id,
          featureId,
          key: 'leak-test',
          name: 'Leak',
        })
      ).statusCode,
    ).toBe(400);
    const f = (
      await call('POST', '/features', { applicationId: other.id, name: 'Other feature' })
    ).json();
    expect(
      (
        await call('POST', '/flags', {
          applicationId: other.id,
          featureId: f.id,
          key: 'private-flag',
          name: 'Private',
        })
      ).statusCode,
    ).toBe(201);
    const result = await server.app.inject({
      url: '/config?applicationId=' + other.id,
      headers: { authorization: 'Bearer ' + key },
    });
    expect(result.json().applicationId).toBe(applicationId);
    expect(result.json().flags.some((f: { key: string }) => f.key === 'private-flag')).toBe(false);
    expect(
      (await server.app.inject({ url: '/config', headers: { authorization: 'Bearer wrong' } }))
        .statusCode,
    ).toBe(401);
  });
  it('versions rule changes and rejects malformed configuration without partial writes', async () => {
    const old = (await call('GET', '/flags/' + flagId)).json();
    const rule = {
      id: randomUUID(),
      name: 'Employees',
      conditions: [{ attribute: 'employee', operator: 'equals', value: true }],
      percentage: 100,
      value: true,
    };
    const add = await call('POST', `/flags/${flagId}/rules`, {
      expectedVersion: old.version,
      rule,
    });
    expect(add.statusCode).toBe(200);
    expect(
      (
        await call('PATCH', `/flags/${flagId}/rules/${rule.id}`, {
          expectedVersion: add.json().version,
          rule: { ...rule, percentage: 101 },
        })
      ).statusCode,
    ).toBe(400);
    expect((await call('GET', '/flags/' + flagId)).json().version).toBe(add.json().version);
    const edit = await call('PATCH', `/flags/${flagId}/rules/${rule.id}`, {
      expectedVersion: add.json().version,
      rule: { ...rule, percentage: 50 },
    });
    expect(edit.statusCode).toBe(200);
    const remove = await call('DELETE', `/flags/${flagId}/rules/${rule.id}`, {
      expectedVersion: edit.json().version,
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().config.rules).toHaveLength(0);
  });
  it('pushes updates across replicas, agrees with remote evaluation, and restores old versions', async () => {
    const replica = await buildApp({ databaseUrl: testUrl.toString(), logger: false });
    const address = await replica.app.listen({ port: 0, host: '127.0.0.1' });
    const sdk = new FlagshipClient({ baseUrl: address, apiKey: key });
    try {
      await sdk.start();
      await eventually(() => sdk.status.connected);
      const old = (await call('GET', '/flags/' + flagId)).json();
      const rules = [
        {
          id: randomUUID(),
          name: 'Employees',
          conditions: [{ attribute: 'employee', operator: 'equals', value: true }],
          percentage: 100,
          value: true,
        },
      ];
      const updated = await call('PATCH', '/flags/' + flagId, {
        expectedVersion: old.version,
        enabled: true,
        rules,
        fallback: false,
      });
      expect(updated.statusCode).toBe(200);
      await eventually(() => sdk.isEnabled('new-checkout', userContext));
      const remote = await server.app.inject({
        method: 'POST',
        url: '/evaluate',
        headers: { authorization: 'Bearer ' + key },
        payload: { flagKey: 'new-checkout', context: userContext, defaultValue: false },
      });
      expect(remote.json().value).toBe(sdk.isEnabled('new-checkout', userContext));
      expect(
        sdk.isEnabled('new-checkout', { key: 'customer', attributes: { employee: false } }),
      ).toBe(false);
      const restored = await call('POST', `/flags/${flagId}/revert`, {
        expectedVersion: updated.json().version,
        version: 1,
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json().version).toBe(updated.json().version + 1);
      await eventually(() => !sdk.isEnabled('new-checkout', userContext));
    } finally {
      await sdk.close();
      await replica.app.close();
    }
  });
  it('keeps cached configuration through an outage and catches up after reconnect', async () => {
    let replica = await buildApp({
      databaseUrl: testUrl.toString(),
      logger: false,
      publisher: false,
    });
    const address = await replica.app.listen({ port: 0, host: '127.0.0.1' });
    const port = new URL(address).port;
    const sdk = new FlagshipClient({ baseUrl: address, apiKey: key, reconnectDelayMs: 50 });
    try {
      const old = (await call('GET', '/flags/' + flagId)).json();
      await call('PATCH', '/flags/' + flagId, {
        expectedVersion: old.version,
        enabled: true,
        fallback: true,
      });
      await sdk.start();
      await eventually(() => sdk.status.connected);
      expect(sdk.isEnabled('new-checkout', userContext)).toBe(true);
      await replica.app.close();
      await eventually(() => !sdk.status.connected);
      expect(sdk.isEnabled('new-checkout', userContext)).toBe(true);
      expect(sdk.isEnabled('unknown-flag', userContext, true)).toBe(true);
      const current = (await call('GET', '/flags/' + flagId)).json();
      await call('PATCH', '/flags/' + flagId, { expectedVersion: current.version, enabled: false });
      replica = await buildApp({
        databaseUrl: testUrl.toString(),
        logger: false,
        publisher: false,
      });
      await replica.app.listen({ port: Number(port), host: '127.0.0.1' });
      await eventually(() => sdk.status.connected && !sdk.isEnabled('new-checkout', userContext));
    } finally {
      await sdk.close();
      await replica.app.close();
    }
  });
  it('persists outbox events when Redis is unavailable and still delivers local changes', async () => {
    const replica = await buildApp({
      databaseUrl: testUrl.toString(),
      redisUrl: 'redis://127.0.0.1:1',
      logger: false,
    });
    const address = await replica.app.listen({ port: 0, host: '127.0.0.1' });
    const sdk = new FlagshipClient({ baseUrl: address, apiKey: key });
    try {
      await sdk.start();
      const old = (await call('GET', '/flags/' + flagId)).json();
      await call('PATCH', '/flags/' + flagId, {
        expectedVersion: old.version,
        enabled: true,
        fallback: true,
      });
      await eventually(() => sdk.isEnabled('new-checkout', userContext));
      expect(sdk.status.ready).toBe(true);
      // The outbox is in PostgreSQL, independent of this replica's Redis connection.
      const rows = await server.db.select().from(outbox);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await sdk.close();
      await replica.app.close();
    }
  });
  it('rotates keys, terminates revoked streams, and clears SDK configuration on explicit revocation', async () => {
    const created = (
      await call('POST', `/applications/${applicationId}/credentials`, { name: 'Rotating SDK' })
    ).json();
    const sdk = new FlagshipClient({ baseUrl, apiKey: created.token });
    try {
      await sdk.start();
      await eventually(() => sdk.status.connected);
      const rotated = (await call('POST', `/credentials/${created.id}/rotate`, {})).json();
      expect(rotated.token).not.toBe(created.token);
      await eventually(() => sdk.status.revoked);
      expect(sdk.status.ready).toBe(false);
      expect(
        (
          await server.app.inject({
            url: '/config',
            headers: { authorization: 'Bearer ' + created.token },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await server.app.inject({
            url: '/config',
            headers: { authorization: 'Bearer ' + rotated.token },
          })
        ).statusCode,
      ).toBe(200);
      await call('DELETE', '/credentials/' + rotated.id);
      expect(
        (
          await server.app.inject({
            url: '/config',
            headers: { authorization: 'Bearer ' + rotated.token },
          })
        ).statusCode,
      ).toBe(401);
      const logs = (await call('GET', '/audit')).json();
      expect(JSON.stringify(logs)).not.toContain(rotated.token);
    } finally {
      await sdk.close();
    }
  });
  it('archives to the application default and requires version checks before deletion', async () => {
    const old = (await call('GET', '/flags/' + flagId)).json();
    const archived = (
      await call('PATCH', '/flags/' + flagId, { expectedVersion: old.version, archived: true })
    ).json();
    const remote = await server.app.inject({
      method: 'POST',
      url: '/evaluate',
      headers: { authorization: 'Bearer ' + key },
      payload: { flagKey: 'new-checkout', context: userContext, defaultValue: true },
    });
    expect(remote.json()).toMatchObject({ value: true, reason: 'DEFAULT' });
    expect(
      (await call('DELETE', '/flags/' + flagId, { expectedVersion: old.version })).statusCode,
    ).toBe(409);
    expect(
      (await call('DELETE', '/flags/' + flagId, { expectedVersion: archived.version })).statusCode,
    ).toBe(200);
    expect((await call('GET', '/flags/' + flagId)).statusCode).toBe(404);
    expect(
      (await server.db.select().from(audit).where(eq(audit.resourceId, flagId))).length,
    ).toBeGreaterThan(0);
  });
});
