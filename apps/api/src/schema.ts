import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type { FlagConfig, Role } from '@flagship/contracts';
const created = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  clerkUserId: text('clerk_user_id').unique(),
  passwordHash: text('password_hash'),
  role: text('role').$type<Role>().notNull(),
  createdAt: created(),
});
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: created(),
});
export const applications = pgTable(
  'applications',
  {
    organizationId: text('organization_id').references(() => organizations.id),
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description').notNull().default(''),
    revision: integer('revision').notNull().default(0),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('applications_org_key_idx').on(t.organizationId, t.key),
    index('applications_org_idx').on(t.organizationId),
  ],
);
export const features = pgTable(
  'features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: created(),
  },
  (t) => [index('features_app_idx').on(t.applicationId)],
);
export const flags = pgTable(
  'flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    featureId: uuid('feature_id')
      .notNull()
      .references(() => features.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    config: jsonb('config').$type<FlagConfig>().notNull(),
    version: integer('version').notNull().default(1),
    createdAt: created(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('flags_app_key_idx').on(t.applicationId, t.key)],
);
export const flagVersions = pgTable(
  'flag_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flagId: uuid('flag_id')
      .notNull()
      .references(() => flags.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    config: jsonb('config').$type<FlagConfig>().notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: created(),
  },
  (t) => [uniqueIndex('versions_flag_version_idx').on(t.flagId, t.version)],
);
export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: created(),
});
export const audit = pgTable(
  'audit',
  {
    organizationId: text('organization_id').references(() => organizations.id),
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: text('actor_name').notNull(),
    applicationId: uuid('application_id'),
    action: text('action').notNull(),
    resourceId: text('resource_id').notNull(),
    details: jsonb('details').notNull().default({}),
    createdAt: created(),
  },
  (t) => [
    index('audit_app_created_idx').on(t.applicationId, t.createdAt),
    index('audit_org_created_idx').on(t.organizationId, t.createdAt),
  ],
);
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id').notNull(),
    revision: integer('revision').notNull(),
    createdAt: created(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [index('outbox_pending_idx').on(t.publishedAt)],
);
