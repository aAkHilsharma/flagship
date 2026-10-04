CREATE TABLE organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN clerk_user_id text UNIQUE;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
-- Local accounts are retained only as historical audit actors. No password login remains.
UPDATE users SET password_hash = NULL;
DELETE FROM sessions;
ALTER TABLE applications ADD COLUMN organization_id text REFERENCES organizations(id);
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_key_unique;
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_key_key;
CREATE UNIQUE INDEX applications_org_key_idx ON applications(organization_id, key);
CREATE INDEX applications_org_idx ON applications(organization_id);
ALTER TABLE audit ADD COLUMN organization_id text REFERENCES organizations(id);
CREATE INDEX audit_org_created_idx ON audit(organization_id, created_at);
-- NULL ownership deliberately quarantines existing data until an explicit local migration.
