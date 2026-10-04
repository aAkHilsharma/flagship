import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import {
  emptyConfig,
  evaluationSchema,
  flagConfigSchema,
  keySchema,
  ruleSchema,
  type Role,
} from '@flagship/contracts';
import { evaluate } from '@flagship/evaluator';
import { connectDatabase } from './db';
import {
  applications,
  audit,
  credentials,
  features,
  flags,
  flagVersions,
  organizations,
  users,
} from './schema';
import { digest, newToken } from './auth';
import { bump, changeFlag, fail, record, type Actor } from './services';
import { createAuthentication, type Authenticate } from './clerk';
import { createDelivery } from './delivery';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
    credential: typeof credentials.$inferSelect;
  }
}
const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const description = z.string().max(2000);
const idOf = (req: FastifyRequest) => uuid.parse((req.params as { id: string }).id);
const safeUser = (u: Actor) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  createdAt: u.createdAt,
});
export async function buildApp(
  options: {
    databaseUrl?: string;
    redisUrl?: string;
    logger?: boolean;
    publisher?: boolean;
    authenticate?: Authenticate;
  } = {},
) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1024 * 1024,
    forceCloseConnections: true,
  });
  const { db, client } = connectDatabase(options.databaseUrl);
  const delivery = createDelivery(
    db,
    options.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:56379',
    app.log,
  );
  const origins = (
    process.env.DASHBOARD_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173'
  ).split(',');
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(rateLimit, { global: false });
  app.decorateRequest('actor');
  app.decorateRequest('credential');
  app.addHook('onRequest', async (req) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      !origins.includes(req.headers.origin)
    )
      fail(403, 'Origin not allowed');
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: 'Invalid request', issues: error.flatten() });
    const err = error as {
      code?: string;
      cause?: { code?: string };
      statusCode?: number;
      message: string;
    };
    const code = err.code ?? err.cause?.code;
    if (code === '23505')
      return reply.code(409).send({ error: 'That key or email already exists' });
    if (code === '23503')
      return reply
        .code(409)
        .send({ error: 'Resource is still in use or its parent does not exist' });
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'Internal server error' : err.message });
  });
  const authenticate = options.authenticate ?? createAuthentication(origins);
  async function checkApplication(applicationId: string, organizationId: string) {
    const [row] = await db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(eq(applications.id, applicationId), eq(applications.organizationId, organizationId)),
      );
    if (!row) fail(404, 'Application not found');
  }
  // Every management route passes here. Ownership is resolved from persisted parents,
  // never from an organization ID supplied by the browser.
  async function checkScope(req: FastifyRequest, organizationId: string) {
    const route = req.routeOptions.url!;
    const params = req.params as { id?: string };
    if (route === '/me' || route === '/applications') return;
    if (route === '/audit') {
      const q = z.object({ applicationId: uuid.optional() }).parse(req.query);
      if (q.applicationId) await checkApplication(q.applicationId, organizationId);
      return;
    }
    if (route.startsWith('/applications/'))
      return checkApplication(uuid.parse(params.id), organizationId);
    const resource = route.startsWith('/features')
      ? features
      : route.startsWith('/flags')
        ? flags
        : route.startsWith('/credentials')
          ? credentials
          : null;
    if (!resource) return fail(403, 'Unscoped management route');
    if (params.id) {
      const [row] = await db
        .select({ applicationId: resource.applicationId })
        .from(resource)
        .where(eq(resource.id, uuid.parse(params.id)));
      if (!row) return fail(404, 'Resource not found');
      return checkApplication(row.applicationId, organizationId);
    }
    const input = z
      .object({ applicationId: uuid })
      .parse(req.method === 'GET' ? req.query : req.body);
    await checkApplication(input.applicationId, organizationId);
  }
  const authorize =
    (roles: Role[] = ['admin', 'member', 'auditor']) =>
    async (req: FastifyRequest) => {
      const identity = await authenticate(req.headers.authorization);
      if (!roles.includes(identity.role)) fail(403, 'Your role does not allow this action');
      await db
        .insert(organizations)
        .values({ id: identity.organizationId, name: identity.organizationName })
        .onConflictDoUpdate({ target: organizations.id, set: { name: identity.organizationName } });
      const [user] = await db
        .insert(users)
        .values({
          clerkUserId: identity.userId,
          name: identity.name,
          email: identity.email,
          role: 'auditor',
        })
        .onConflictDoUpdate({
          target: users.clerkUserId,
          set: { name: identity.name, email: identity.email },
        })
        .returning();
      req.actor = { ...user, role: identity.role, organizationId: identity.organizationId };
      await checkScope(req, identity.organizationId);
    };
  async function sdkAuth(req: FastifyRequest) {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) fail(401, 'Backend SDK credentials required');
    const [credential] = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.tokenHash, digest(token!)), isNull(credentials.revokedAt)));
    if (!credential) fail(401, 'Invalid or revoked SDK credential');
    req.credential = credential;
  }
  app.get('/health', async () => {
    await db.execute(sql`SELECT 1`);
    return { status: 'ok', redis: delivery.redis.isReady ? 'connected' : 'degraded' };
  });
  app.get('/me', { preHandler: authorize() }, async (req) => ({
    ...safeUser(req.actor),
    organizationId: req.actor.organizationId,
  }));

  app.get('/applications', { preHandler: authorize() }, async (req) =>
    db
      .select()
      .from(applications)
      .where(eq(applications.organizationId, req.actor.organizationId!))
      .orderBy(applications.createdAt),
  );
  app.get('/applications/:id', { preHandler: authorize() }, async (req) => {
    const [row] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, idOf(req)));
    if (!row) fail(404, 'Application not found');
    return row;
  });
  app.post('/applications', { preHandler: authorize(['admin']) }, async (req, reply) => {
    const body = z
      .object({ name, key: keySchema, description: description.default('') })
      .strict()
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [a] = await tx
        .insert(applications)
        .values({ ...body, organizationId: req.actor.organizationId })
        .returning();
      await record(tx, req.actor, 'application.create', a.id, a.id);
      return a;
    });
    return reply.code(201).send(row);
  });
  app.patch('/applications/:id', { preHandler: authorize(['admin']) }, async (req) => {
    const id = idOf(req),
      body = z
        .object({ name: name.optional(), description: description.optional() })
        .strict()
        .refine((b) => Object.keys(b).length > 0, 'Provide at least one field')
        .parse(req.body);
    return db.transaction(async (tx) => {
      const [a] = await tx
        .update(applications)
        .set(body)
        .where(eq(applications.id, id))
        .returning();
      if (!a) fail(404, 'Application not found');
      await record(tx, req.actor, 'application.update', id, id);
      return a;
    });
  });
  app.delete('/applications/:id', { preHandler: authorize(['admin']) }, async (req) => {
    const id = idOf(req);
    await db.transaction(async (tx) => {
      const [a] = await tx.select().from(applications).where(eq(applications.id, id)).for('update');
      if (!a) fail(404, 'Application not found');
      if ((await tx.select().from(features).where(eq(features.applicationId, id)).limit(1)).length)
        fail(409, 'Delete its features first');
      await tx.delete(applications).where(eq(applications.id, id));
      await record(tx, req.actor, 'application.delete', id, id);
    });
    return { ok: true };
  });

  app.get('/features', { preHandler: authorize() }, async (req) => {
    const q = z.object({ applicationId: uuid }).parse(req.query);
    return db.select().from(features).where(eq(features.applicationId, q.applicationId));
  });
  app.get('/features/:id', { preHandler: authorize() }, async (req) => {
    const [f] = await db
      .select()
      .from(features)
      .where(eq(features.id, idOf(req)));
    if (!f) fail(404, 'Feature not found');
    return f;
  });
  app.post('/features', { preHandler: authorize(['admin']) }, async (req, reply) => {
    const body = z
      .object({ applicationId: uuid, name, description: description.default('') })
      .strict()
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, body.applicationId))
        .for('update');
      const [f] = await tx.insert(features).values(body).returning();
      await record(tx, req.actor, 'feature.create', f.id, f.applicationId);
      return f;
    });
    return reply.code(201).send(row);
  });
  app.patch('/features/:id', { preHandler: authorize(['admin']) }, async (req) => {
    const id = idOf(req),
      body = z
        .object({ name: name.optional(), description: description.optional() })
        .strict()
        .refine((b) => Object.keys(b).length > 0, 'Provide at least one field')
        .parse(req.body);
    return db.transaction(async (tx) => {
      const [f] = await tx.update(features).set(body).where(eq(features.id, id)).returning();
      if (!f) fail(404, 'Feature not found');
      await record(tx, req.actor, 'feature.update', id, f.applicationId);
      return f;
    });
  });
  app.delete('/features/:id', { preHandler: authorize(['admin']) }, async (req) => {
    const id = idOf(req);
    await db.transaction(async (tx) => {
      const [f] = await tx.delete(features).where(eq(features.id, id)).returning();
      if (!f) fail(404, 'Feature not found');
      await record(tx, req.actor, 'feature.delete', id, f.applicationId);
    });
    return { ok: true };
  });

  app.get('/flags', { preHandler: authorize() }, async (req) => {
    const q = z.object({ applicationId: uuid }).parse(req.query);
    return db
      .select()
      .from(flags)
      .where(eq(flags.applicationId, q.applicationId))
      .orderBy(flags.createdAt);
  });
  app.get('/flags/:id', { preHandler: authorize() }, async (req) => {
    const [f] = await db
      .select()
      .from(flags)
      .where(eq(flags.id, idOf(req)));
    if (!f) fail(404, 'Flag not found');
    return f;
  });
  app.post('/flags', { preHandler: authorize(['admin']) }, async (req, reply) => {
    const body = z
      .object({
        applicationId: uuid,
        featureId: uuid,
        key: keySchema,
        name,
        description: description.default(''),
        config: flagConfigSchema.default(emptyConfig),
      })
      .strict()
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, body.applicationId))
        .for('update');
      const [feature] = await tx
        .select()
        .from(features)
        .where(
          and(eq(features.id, body.featureId), eq(features.applicationId, body.applicationId)),
        );
      if (!feature) fail(400, 'Feature must belong to this application');
      const [f] = await tx.insert(flags).values(body).returning();
      await tx
        .insert(flagVersions)
        .values({ flagId: f.id, version: 1, config: f.config, actorId: req.actor.id });
      await record(tx, req.actor, 'flag.create', f.id, f.applicationId);
      await bump(tx, f.applicationId);
      return f;
    });
    return reply.code(201).send(row);
  });
  app.patch('/flags/:id', { preHandler: authorize(['admin', 'member']) }, async (req) => {
    const body = z
      .object({
        expectedVersion: z.number().int().positive(),
        name: name.optional(),
        description: description.optional(),
        enabled: z.boolean().optional(),
        archived: z.boolean().optional(),
        fallback: z.boolean().optional(),
        rules: z.array(ruleSchema).optional(),
      })
      .strict()
      .parse(req.body);
    if (
      req.actor.role === 'member' &&
      Object.keys(body).some((k) => !['enabled', 'expectedVersion'].includes(k))
    )
      fail(403, 'Members may only enable or disable flags');
    return changeFlag(db, idOf(req), body.expectedVersion, req.actor, 'flag.update', (old) => ({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      config: {
        ...old.config,
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.archived !== undefined ? { archived: body.archived } : {}),
        ...(body.fallback !== undefined ? { fallback: body.fallback } : {}),
        ...(body.rules ? { rules: body.rules } : {}),
      },
    }));
  });
  app.get('/flags/:id/versions', { preHandler: authorize() }, async (req) =>
    db
      .select()
      .from(flagVersions)
      .where(eq(flagVersions.flagId, idOf(req)))
      .orderBy(desc(flagVersions.version)),
  );
  app.post('/flags/:id/revert', { preHandler: authorize(['admin']) }, async (req) => {
    const id = idOf(req),
      body = z
        .object({
          expectedVersion: z.number().int().positive(),
          version: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
    return changeFlag(db, id, body.expectedVersion, req.actor, 'flag.revert', async (_old, tx) => {
      const [v] = await tx
        .select()
        .from(flagVersions)
        .where(and(eq(flagVersions.flagId, id), eq(flagVersions.version, body.version)));
      if (!v) fail(404, 'Version not found');
      return { config: v.config };
    });
  });
  app.delete('/flags/:id', { preHandler: authorize(['admin']) }, async (req) => {
    const id = idOf(req),
      body = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
    await db.transaction(async (tx) => {
      const [lookup] = await tx.select().from(flags).where(eq(flags.id, id));
      if (!lookup) fail(404, 'Flag not found');
      await tx
        .select()
        .from(applications)
        .where(eq(applications.id, lookup.applicationId))
        .for('update');
      const [f] = await tx.select().from(flags).where(eq(flags.id, id)).for('update');
      if (!f) fail(404, 'Flag not found');
      if (f.version !== body.expectedVersion)
        fail(409, 'Configuration changed. Refresh before deleting.');
      if (!f.config.archived) fail(409, 'Archive the flag before deleting it');
      await tx.delete(flags).where(eq(flags.id, id));
      await record(tx, req.actor, 'flag.delete', id, f.applicationId, { key: f.key });
      await bump(tx, f.applicationId);
    });
    return { ok: true };
  });
  // Rules are ordered, embedded configuration entities; every edit versions the whole flag atomically.
  app.get('/flags/:id/rules', { preHandler: authorize() }, async (req) => {
    const [f] = await db
      .select()
      .from(flags)
      .where(eq(flags.id, idOf(req)));
    if (!f) fail(404, 'Flag not found');
    return f.config.rules;
  });
  app.post('/flags/:id/rules', { preHandler: authorize(['admin']) }, async (req) => {
    const body = z
      .object({ expectedVersion: z.number().int().positive(), rule: ruleSchema })
      .strict()
      .parse(req.body);
    return changeFlag(db, idOf(req), body.expectedVersion, req.actor, 'rule.create', (old) => ({
      config: { ...old.config, rules: [...old.config.rules, body.rule] },
    }));
  });
  app.patch('/flags/:id/rules/:ruleId', { preHandler: authorize(['admin']) }, async (req) => {
    const ruleId = uuid.parse((req.params as { ruleId: string }).ruleId),
      body = z
        .object({ expectedVersion: z.number().int().positive(), rule: ruleSchema })
        .strict()
        .parse(req.body);
    if (body.rule.id !== ruleId) fail(400, 'Rule ID is immutable');
    return changeFlag(db, idOf(req), body.expectedVersion, req.actor, 'rule.update', (old) => {
      if (!old.config.rules.some((r) => r.id === ruleId)) fail(404, 'Rule not found');
      return {
        config: {
          ...old.config,
          rules: old.config.rules.map((r) => (r.id === ruleId ? body.rule : r)),
        },
      };
    });
  });
  app.delete('/flags/:id/rules/:ruleId', { preHandler: authorize(['admin']) }, async (req) => {
    const ruleId = uuid.parse((req.params as { ruleId: string }).ruleId),
      body = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
    return changeFlag(db, idOf(req), body.expectedVersion, req.actor, 'rule.delete', (old) => {
      if (!old.config.rules.some((r) => r.id === ruleId)) fail(404, 'Rule not found');
      return { config: { ...old.config, rules: old.config.rules.filter((r) => r.id !== ruleId) } };
    });
  });

  app.get('/applications/:id/credentials', { preHandler: authorize(['admin']) }, async (req) =>
    db
      .select({
        id: credentials.id,
        name: credentials.name,
        prefix: credentials.prefix,
        createdAt: credentials.createdAt,
        revokedAt: credentials.revokedAt,
      })
      .from(credentials)
      .where(eq(credentials.applicationId, idOf(req))),
  );
  app.post(
    '/applications/:id/credentials',
    { preHandler: authorize(['admin']) },
    async (req, reply) => {
      const applicationId = idOf(req),
        body = z.object({ name }).strict().parse(req.body),
        token = newToken();
      const row = await db.transaction(async (tx) => {
        const [c] = await tx
          .insert(credentials)
          .values({
            applicationId,
            name: body.name,
            prefix: token.slice(0, 11),
            tokenHash: digest(token),
          })
          .returning();
        await record(tx, req.actor, 'credential.create', c.id, applicationId);
        return c;
      });
      return reply.code(201).send({ id: row.id, name: row.name, prefix: row.prefix, token });
    },
  );
  app.post('/credentials/:id/rotate', { preHandler: authorize(['admin']) }, async (req) => {
    const token = newToken(),
      id = idOf(req);
    return db.transaction(async (tx) => {
      const [c] = await tx.select().from(credentials).where(eq(credentials.id, id)).for('update');
      if (!c || c.revokedAt) fail(404, 'Active credential not found');
      await tx.update(credentials).set({ revokedAt: new Date() }).where(eq(credentials.id, id));
      const [next] = await tx
        .insert(credentials)
        .values({
          applicationId: c.applicationId,
          name: c.name,
          prefix: token.slice(0, 11),
          tokenHash: digest(token),
        })
        .returning();
      await record(tx, req.actor, 'credential.rotate', id, c.applicationId);
      return { id: next.id, name: next.name, prefix: next.prefix, token };
    });
  });
  app.delete('/credentials/:id', { preHandler: authorize(['admin']) }, async (req) => {
    const id = idOf(req);
    await db.transaction(async (tx) => {
      const [c] = await tx
        .update(credentials)
        .set({ revokedAt: new Date() })
        .where(eq(credentials.id, id))
        .returning();
      if (!c) fail(404, 'Credential not found');
      await record(tx, req.actor, 'credential.revoke', id, c.applicationId);
    });
    return { ok: true };
  });
  app.get('/audit', { preHandler: authorize() }, async (req) => {
    const q = z
      .object({
        applicationId: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    return db
      .select()
      .from(audit)
      .where(
        and(
          eq(audit.organizationId, req.actor.organizationId!),
          q.applicationId ? eq(audit.applicationId, q.applicationId) : undefined,
        ),
      )
      .orderBy(desc(audit.createdAt))
      .limit(q.limit)
      .offset(q.offset);
  });

  app.get('/config', { preHandler: sdkAuth }, async (req) =>
    delivery.snapshot(req.credential.applicationId),
  );
  app.post('/evaluate', { preHandler: sdkAuth }, async (req) => {
    const body = evaluationSchema.parse(req.body),
      config = await delivery.snapshot(req.credential.applicationId);
    return {
      ...evaluate(
        config.flags.find((f) => f.key === body.flagKey),
        body.context,
        body.defaultValue,
      ),
      revision: config.revision,
    };
  });
  const streams = new Set<() => void>();
  app.get('/stream', { preHandler: sdkAuth }, async (req, reply) => {
    const credential = req.credential;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders();
    let sent = -1,
      closed = false,
      refreshing = false,
      pending = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      delivery.events.off(credential.applicationId, onChange);
      streams.delete(close);
      reply.raw.end();
    };
    const write = (value: string) => {
      if (!closed && !reply.raw.write(value)) close();
    };
    const refresh = async () => {
      if (closed) return;
      if (refreshing) {
        pending = true;
        return;
      }
      refreshing = true;
      try {
        do {
          pending = false;
          const [active] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.id, credential.id), isNull(credentials.revokedAt)));
          if (!active) {
            write('event: revoked\ndata: {}\n\n');
            close();
            break;
          }
          const snapshot = await delivery.snapshot(credential.applicationId);
          if (snapshot.revision > sent) {
            write(`id: ${snapshot.revision}\nevent: config\ndata: ${JSON.stringify(snapshot)}\n\n`);
            sent = snapshot.revision;
          }
        } while (pending && !closed);
      } catch {
        close();
      } finally {
        refreshing = false;
      }
    };
    const onChange = () => void refresh();
    delivery.events.on(credential.applicationId, onChange);
    // Also checks credential revocation and repairs gaps after publisher/Redis outages.
    const heartbeat = setInterval(() => {
      write(': heartbeat\n\n');
      void refresh();
    }, 5000);
    heartbeat.unref();
    streams.add(close);
    reply.raw.on('close', close);
    await refresh();
  });
  if (options.publisher !== false) delivery.start();
  app.addHook('preClose', async () => {
    for (const close of streams) close();
  });
  app.addHook('onClose', async () => {
    await delivery.close();
    await client.end();
  });
  return { app, db, delivery };
}
