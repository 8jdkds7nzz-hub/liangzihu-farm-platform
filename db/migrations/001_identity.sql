CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9_.@-]{2,79}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash text,
  role text NOT NULL CHECK (role IN ('admin','owner','technician','worker','maintainer','expert')),
  enabled boolean NOT NULL DEFAULT true,
  auth_version integer NOT NULL DEFAULT 0,
  wecom_corp_id text,
  wecom_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(wecom_corp_id,wecom_user_id),
  CHECK ((wecom_corp_id IS NULL) = (wecom_user_id IS NULL))
);
CREATE FUNCTION identity_bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.password_hash,NEW.role,NEW.enabled,NEW.wecom_corp_id,NEW.wecom_user_id)
     IS DISTINCT FROM ROW(OLD.password_hash,OLD.role,OLD.enabled,OLD.wecom_corp_id,OLD.wecom_user_id) THEN
    NEW.auth_version := OLD.auth_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER identity_version BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION identity_bump_version();

CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  auth_version integer NOT NULL,
  mfa_verified boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE second_factors (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  encrypted_secret text NOT NULL,
  last_time_step bigint NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_challenges (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  auth_version integer NOT NULL,
  encrypted_secret text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id),
  code_hash char(64) NOT NULL,
  used_at timestamptz,
  PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  object_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('read','record','claim','close_alert','review','dispatch','share','configure','export','act')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR starts_at < expires_at)
);
-- Object foreign keys are added with A02's object registry; UUIDs never imply access.
CREATE INDEX grants_lookup ON grants(user_id,object_id,action) WHERE revoked_at IS NULL;
CREATE TABLE integration_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  token_hash char(64) NOT NULL UNIQUE,
  object_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('read','record')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE TABLE login_attempts (
  key_hash char(64) PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL,
  blocked_until timestamptz
);
CREATE TABLE oauth_states (
  state_hash char(64) PRIMARY KEY,
  browser_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  event_type text NOT NULL,
  target_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'
);
