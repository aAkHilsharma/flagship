CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL UNIQUE,
 password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','member','auditor')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,key text NOT NULL UNIQUE,description text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS features (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,name text NOT NULL,description text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS features_app_idx ON features(application_id);
CREATE TABLE IF NOT EXISTS flags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,feature_id uuid NOT NULL REFERENCES features(id) ON DELETE RESTRICT,key text NOT NULL,name text NOT NULL,description text NOT NULL DEFAULT '',config jsonb NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS flags_app_key_idx ON flags(application_id,key);
CREATE TABLE IF NOT EXISTS flag_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),flag_id uuid NOT NULL REFERENCES flags(id) ON DELETE CASCADE,version integer NOT NULL,config jsonb NOT NULL,actor_id uuid REFERENCES users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS versions_flag_version_idx ON flag_versions(flag_id,version);
CREATE TABLE IF NOT EXISTS credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,name text NOT NULL,prefix text NOT NULL,token_hash text NOT NULL UNIQUE,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid REFERENCES users(id) ON DELETE SET NULL,actor_name text NOT NULL,application_id uuid,action text NOT NULL,resource_id text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS audit_app_created_idx ON audit(application_id,created_at);
CREATE TABLE IF NOT EXISTS outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL,revision integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox(published_at);
