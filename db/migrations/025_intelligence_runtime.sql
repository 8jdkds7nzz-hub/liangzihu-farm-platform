ALTER TABLE assistant_runs ADD COLUMN execution_token uuid;
ALTER TABLE image_reviews ADD COLUMN execution_token uuid;
ALTER TABLE image_reviews ADD COLUMN auth_version integer;
ALTER TABLE image_reviews DROP CONSTRAINT image_reviews_state_check;
ALTER TABLE image_reviews ADD CONSTRAINT image_reviews_state_check CHECK(state IN('queued','running','complete','failed','access_revoked','result_unknown'));
UPDATE image_reviews SET state='failed',error_code='LEGACY_AUTH_UNKNOWN' WHERE state IN('queued','running');
CREATE TABLE model_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES assistant_runs(id),
 execution_token uuid NOT NULL,backup boolean NOT NULL,month date NOT NULL,
 price_snapshot jsonb NOT NULL,model text,usage jsonb,outcome text NOT NULL DEFAULT 'unknown',
 started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,error_code text
);
CREATE TRIGGER immutable_model_attempt_input BEFORE UPDATE OF run_id,execution_token,backup,month,price_snapshot,started_at ON model_attempts FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
ALTER TABLE briefing_publications ADD COLUMN revoked_by uuid REFERENCES users(id);
ALTER TABLE briefing_publications ADD COLUMN revoke_reason text;
ALTER TABLE briefing_publications ADD COLUMN resource_grant_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE briefing_publications p SET resource_grant_ids=ARRAY(SELECT g.id FROM resource_grants g WHERE g.user_id=p.recipient_id AND g.resource_type='briefing_item' AND g.resource_id=ANY(p.item_ids) AND g.created_by=p.confirmed_by AND g.created_at=p.created_at AND g.expires_at=p.expires_at);
CREATE TABLE model_receipts (
 run_id uuid PRIMARY KEY REFERENCES assistant_runs(id),confirmed_by uuid NOT NULL REFERENCES users(id),
 content_hash char(64) NOT NULL,costs jsonb NOT NULL,evidence text NOT NULL,
 resolved_usage_ids uuid[] NOT NULL,confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_model_receipts BEFORE UPDATE OR DELETE ON model_receipts FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
