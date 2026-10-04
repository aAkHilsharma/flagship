import { parseArgs } from 'node:util';
import { createClerkClient } from '@clerk/backend';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { connectDatabase } from './db';
import { applications, audit, organizations } from './schema';

// Local operator command, never exposed as a public claim endpoint.
const { values } = parseArgs({
  options: { application: { type: 'string' }, organization: { type: 'string' } },
});
const applicationId = z.string().uuid().parse(values.application);
const organizationId = z
  .string()
  .regex(/^org_[a-zA-Z0-9]+$/)
  .parse(values.organization);
if (!process.env.CLERK_SECRET_KEY) throw new Error('CLERK_SECRET_KEY is required');
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const organization = await clerk.organizations.getOrganization({ organizationId });
const { db, client } = connectDatabase();
try {
  await db.transaction(async (tx) => {
    await tx
      .insert(organizations)
      .values({ id: organization.id, name: organization.name })
      .onConflictDoNothing();
    const [application] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId))
      .for('update');
    if (!application) throw new Error('Application not found');
    if (application.organizationId === organizationId) return;
    if (application.organizationId)
      throw new Error('Cannot move an application already owned by another organization');
    await tx
      .update(applications)
      .set({ organizationId })
      .where(and(eq(applications.id, applicationId), isNull(applications.organizationId)));
    await tx
      .update(audit)
      .set({ organizationId })
      .where(and(eq(audit.applicationId, applicationId), isNull(audit.organizationId)));
    await tx.insert(audit).values({
      organizationId,
      actorName: 'Local migration operator',
      applicationId,
      action: 'application.assign',
      resourceId: applicationId,
      details: { organizationId },
    });
  });
  console.log(
    'Application assigned to ' + organization.name + '. Flags and credentials preserved.',
  );
} finally {
  await client.end();
}
