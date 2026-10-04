import { EventEmitter } from 'node:events';
import { createClient } from 'redis';
import { asc, eq, isNull } from 'drizzle-orm';
import type { Database } from './db';
import { applications, flags, outbox } from './schema';
import { configSnapshotSchema, type ConfigSnapshot } from '@flagship/contracts';

export function createDelivery(
  db: Database,
  redisUrl: string,
  log: { warn: (obj: unknown, msg?: string) => void },
) {
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const redis = createClient({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: { connectTimeout: 1500, reconnectStrategy: (attempt) => Math.min(500 * attempt, 5000) },
  });
  const subscriber = redis.duplicate();
  redis.on('error', () => {});
  subscriber.on('error', () => {});
  const seen = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | undefined,
    busy = false,
    stopped = false,
    ticks = 0;
  const notify = (id: string, revision: number) => {
    if (revision > (seen.get(id) ?? -1)) {
      seen.set(id, revision);
      events.emit(id, revision);
    }
  };
  async function snapshot(applicationId: string): Promise<ConfigSnapshot> {
    // Versioned cache keys prevent old cache fills from overwriting newer data.
    // REPEATABLE READ makes the revision and flag contents a consistent snapshot.
    return db.transaction(
      async (tx) => {
        const [app] = await tx
          .select()
          .from(applications)
          .where(eq(applications.id, applicationId));
        if (!app)
          throw Object.assign(new Error('Application no longer exists'), { statusCode: 401 });
        const cacheKey = `flagship:config:${app.id}:${app.revision}`;
        if (redis.isReady) {
          try {
            const cached = await redis.get(cacheKey);
            if (cached) {
              const parsed = configSnapshotSchema.safeParse(JSON.parse(cached));
              if (
                parsed.success &&
                parsed.data.applicationId === app.id &&
                parsed.data.revision === app.revision
              )
                return parsed.data;
            }
          } catch {
            /* Database remains authoritative. */
          }
        }
        const rows = await tx
          .select({ key: flags.key, version: flags.version, config: flags.config })
          .from(flags)
          .where(eq(flags.applicationId, app.id));
        const result: ConfigSnapshot = {
          applicationId: app.id,
          revision: app.revision,
          flags: rows,
        };
        if (redis.isReady)
          try {
            await redis.set(cacheKey, JSON.stringify(result), { EX: 60 });
          } catch {
            /* Cache is optional. */
          }
        return result;
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
  async function pump() {
    if (busy || stopped) return;
    busy = true;
    try {
      await db.transaction(async (tx) => {
        const pending = await tx
          .select()
          .from(outbox)
          .where(isNull(outbox.publishedAt))
          .orderBy(asc(outbox.createdAt))
          .limit(100)
          .for('update', { skipLocked: true });
        for (const event of pending) {
          notify(event.applicationId, event.revision);
          if (!redis.isReady) continue;
          try {
            await redis.publish(
              'flagship:updates',
              JSON.stringify({ id: event.applicationId, revision: event.revision }),
            );
            await tx.update(outbox).set({ publishedAt: new Date() }).where(eq(outbox.id, event.id));
          } catch {
            /* Unpublished events remain durable for the next attempt. */
          }
        }
      });
      // Pub/sub is ephemeral. Reconciliation repairs lost notifications on any replica,
      // including when Redis is disconnected but PostgreSQL remains reachable.
      if (++ticks % 5 === 0) {
        const apps = await db
          .select({ id: applications.id, revision: applications.revision })
          .from(applications);
        for (const app of apps) notify(app.id, app.revision);
      }
    } catch (error) {
      log.warn({ err: error }, 'Configuration publisher will retry');
    } finally {
      busy = false;
    }
  }
  return {
    snapshot,
    events,
    redis,
    start() {
      void redis.connect().catch(() => {});
      void subscriber
        .connect()
        .then(() =>
          subscriber.subscribe('flagship:updates', (message) => {
            try {
              const event = JSON.parse(message);
              if (typeof event.id === 'string' && Number.isInteger(event.revision))
                notify(event.id, event.revision);
            } catch {
              /* Ignore malformed notifications. */
            }
          }),
        )
        .catch(() => {});
      timer = setInterval(() => void pump(), 1000);
      timer.unref();
    },
    async close() {
      stopped = true;
      if (timer) clearInterval(timer);
      events.removeAllListeners();
      if (redis.isOpen) redis.destroy();
      if (subscriber.isOpen) subscriber.destroy();
    },
    pump,
  };
}
