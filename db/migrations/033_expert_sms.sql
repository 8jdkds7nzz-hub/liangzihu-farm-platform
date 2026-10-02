ALTER TABLE users ADD COLUMN wecom_identity_evidence text;
CREATE TABLE expert_phones (
 user_id uuid PRIMARY KEY REFERENCES users(id),phone_hash text NOT NULL UNIQUE,encrypted_phone text NOT NULL,
 evidence text NOT NULL,verified_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sms_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text NOT NULL UNIQUE,browser_hash text NOT NULL,
 phone_hash text NOT NULL,user_id uuid REFERENCES users(id),auth_version integer,otp_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 attempted_at timestamptz,state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','accepted','failed','unknown')),
 provider_request_id text,failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 5),consumed_at timestamptz
);
CREATE INDEX sms_phone_period ON sms_challenges(phone_hash,created_at);
CREATE TRIGGER immutable_sms_inputs BEFORE UPDATE ON sms_challenges FOR EACH ROW WHEN (
 ROW(OLD.id,OLD.token_hash,OLD.browser_hash,OLD.phone_hash,OLD.user_id,OLD.auth_version,OLD.otp_hash,OLD.created_at,OLD.expires_at)
 IS DISTINCT FROM ROW(NEW.id,NEW.token_hash,NEW.browser_hash,NEW.phone_hash,NEW.user_id,NEW.auth_version,NEW.otp_hash,NEW.created_at,NEW.expires_at)
) EXECUTE FUNCTION preserve_measurement();
