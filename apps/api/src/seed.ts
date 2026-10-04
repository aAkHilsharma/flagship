import { eq } from 'drizzle-orm';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { connectDatabase } from './db';
import { newToken, digest } from './auth';
import { applications, credentials, features, flags, flagVersions, users } from './schema';
import { bump, record } from './services';
import { migrate } from './migrate';
await migrate();
const { db, client } = connectDatabase();
try {
  await db.transaction(async (tx) => {
    let [admin] = await tx.select().from(users).where(eq(users.email, 'admin@flagship.local'));
    if (!admin) {
      [admin] = await tx
        .insert(users)
        .values({
          name: 'Akhil',
          email: 'admin@flagship.local',
          passwordHash: null,
          role: 'admin',
        })
        .returning();
      await record(tx, { ...admin, organizationId: null }, 'user.seed', admin.id, null);
    }
    let [application] = await tx
      .select()
      .from(applications)
      .where(eq(applications.key, 'fieldwork'));
    if (!application) {
      [application] = await tx
        .insert(applications)
        .values({
          name: 'Fieldwork',
          key: 'fieldwork',
          description: 'The storefront. A real application for testing rollouts.',
        })
        .returning();
      await record(
        tx,
        { ...admin, organizationId: null },
        'application.create',
        application.id,
        application.id,
      );
      const [checkout] = await tx
        .insert(features)
        .values({
          applicationId: application.id,
          name: 'Checkout',
          description: 'A faster path from bag to order.',
        })
        .returning();
      const [discovery] = await tx
        .insert(features)
        .values({
          applicationId: application.id,
          name: 'Product discovery',
          description: 'Help customers find their next favorite.',
        })
        .returning();
      const definitions = [
        {
          key: 'new-checkout',
          name: 'One-step checkout',
          featureId: checkout.id,
          enabled: true,
          description: 'A redesigned checkout, starting with our team.',
          rules: [
            {
              id: randomUUID(),
              name: 'Employees first',
              conditions: [{ attribute: 'employee', operator: 'equals' as const, value: true }],
              percentage: 100,
              value: true,
            },
            {
              id: randomUUID(),
              name: 'Premium preview',
              conditions: [{ attribute: 'plan', operator: 'equals' as const, value: 'premium' }],
              percentage: 20,
              value: true,
            },
          ],
        },
        {
          key: 'saved-payment-methods',
          name: 'Saved payment methods',
          featureId: checkout.id,
          enabled: false,
          description: 'Remember payment preferences for returning customers.',
          rules: [],
        },
        {
          key: 'express-shipping',
          name: 'Express shipping',
          featureId: checkout.id,
          enabled: true,
          description: 'Priority delivery for customers in India.',
          rules: [
            {
              id: randomUUID(),
              name: 'India',
              conditions: [{ attribute: 'country', operator: 'equals' as const, value: 'IN' }],
              percentage: 50,
              value: true,
            },
          ],
        },
        {
          key: 'smarter-search',
          name: 'Smarter product search',
          featureId: discovery.id,
          enabled: false,
          description: 'Search suggestions with better matching.',
          rules: [],
        },
        {
          key: 'curated-collections',
          name: 'Curated collections',
          featureId: discovery.id,
          enabled: true,
          description: 'A more personal storefront for every customer.',
          rules: [
            { id: randomUUID(), name: 'Everyone', conditions: [], percentage: 100, value: true },
          ],
        },
      ];
      for (const d of definitions) {
        const { enabled, rules, ...fields } = d;
        const config = { enabled, archived: false, fallback: false, rules };
        const [f] = await tx
          .insert(flags)
          .values({ ...fields, applicationId: application.id, config })
          .returning();
        await tx
          .insert(flagVersions)
          .values({ flagId: f.id, version: 1, config, actorId: admin.id });
        await record(tx, { ...admin, organizationId: null }, 'flag.create', f.id, application.id);
      }
      await bump(tx, application.id);
    }
    const folder = new URL('../../../.local/', import.meta.url);
    await mkdir(folder, { recursive: true });
    let token: string | undefined;
    try {
      token = (await readFile(new URL('demo-key', folder), 'utf8')).trim();
    } catch {}
    const existing = token
      ? (
          await tx
            .select()
            .from(credentials)
            .where(eq(credentials.tokenHash, digest(token)))
        )[0]
      : undefined;
    if (!existing || existing.revokedAt) {
      token = newToken();
      const [c] = await tx
        .insert(credentials)
        .values({
          applicationId: application.id,
          name: 'Local demo server',
          prefix: token.slice(0, 11),
          tokenHash: digest(token),
        })
        .returning();
      await record(
        tx,
        { ...admin, organizationId: null },
        'credential.create',
        c.id,
        application.id,
      );
      await writeFile(new URL('demo-key', folder), token, { mode: 0o600 });
    }
  });
  console.log(
    'Seed ready. Sign in: admin@flagship.local / Flagship-local-2026! (or your SEED_PASSWORD). Demo credential saved in ignored .local/demo-key.',
  );
} finally {
  await client.end();
}
