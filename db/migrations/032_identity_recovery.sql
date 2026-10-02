CREATE TABLE identity_recoveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,
 token_hash char(64) NOT NULL UNIQUE,requested_by uuid REFERENCES users(id),reset_mfa boolean NOT NULL,
 identity_evidence text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',consumed_at timestamptz
);
CREATE TRIGGER immutable_identity_recovery_input BEFORE UPDATE OF user_id,auth_version,token_hash,requested_by,reset_mfa,identity_evidence,reason,created_at ON identity_recoveries FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
