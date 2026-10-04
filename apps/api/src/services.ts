import { eq, sql } from 'drizzle-orm';
import { applications, audit, flags, flagVersions, outbox, users } from './schema';
import type { Database } from './db';
import { flagConfigSchema, type FlagConfig } from '@flagship/contracts';
export type Actor = typeof users.$inferSelect & { organizationId: string | null };
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export const fail = (statusCode: number, message: string): never => {
  throw Object.assign(new Error(message), { statusCode });
};
export async function record(
  tx: Tx,
  actor: Actor,
  action: string,
  resourceId: string,
  applicationId: string | null,
  details: unknown = {},
) {
  await tx.insert(audit).values({
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorName: actor.name,
    action,
    resourceId,
    applicationId,
    details,
  });
}
export async function bump(tx: Tx, applicationId: string) {
  const [app] = await tx
    .update(applications)
    .set({ revision: sql`${applications.revision}+1` })
    .where(eq(applications.id, applicationId))
    .returning();
  if (!app) fail(404, 'Application not found');
  await tx.insert(outbox).values({ applicationId, revision: app.revision });
  return app.revision;
}
export async function changeFlag(
  db: Database,
  id: string,
  expectedVersion: number,
  actor: Actor,
  action: string,
  edit: (
    old: typeof flags.$inferSelect,
    tx: Tx,
  ) =>
    | Promise<{ config?: FlagConfig; name?: string; description?: string }>
    | { config?: FlagConfig; name?: string; description?: string },
) {
  return db.transaction(async (tx) => {
    const [lookup] = await tx.select().from(flags).where(eq(flags.id, id));
    if (!lookup) fail(404, 'Flag not found');
    // All flag mutations acquire application lock first, then flag lock.
    const [parent] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, lookup.applicationId))
      .for('update');
    if (!parent || parent.organizationId !== actor.organizationId) fail(404, 'Flag not found');
    const [old] = await tx.select().from(flags).where(eq(flags.id, id)).for('update');
    if (!old) fail(404, 'Flag not found');
    if (old.version !== expectedVersion) fail(409, 'Configuration changed. Refresh before saving.');
    const patch = await edit(old, tx);
    const config = flagConfigSchema.parse(patch.config ?? old.config);
    const [updated] = await tx
      .update(flags)
      .set({ ...patch, config, version: old.version + 1, updatedAt: new Date() })
      .where(eq(flags.id, id))
      .returning();
    await tx
      .insert(flagVersions)
      .values({ flagId: id, version: updated.version, config, actorId: actor.id });
    await record(tx, actor, action, id, old.applicationId, {
      fromVersion: old.version,
      toVersion: updated.version,
    });
    await bump(tx, old.applicationId);
    return updated;
  });
}
