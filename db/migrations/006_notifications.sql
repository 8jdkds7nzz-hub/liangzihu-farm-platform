CREATE TABLE duty_rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),
  starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,night_shift boolean NOT NULL,
  onsite_id uuid NOT NULL REFERENCES users(id),technician_id uuid NOT NULL REFERENCES users(id),owner_id uuid NOT NULL REFERENCES users(id),maintainer_id uuid NOT NULL REFERENCES users(id),
  call_timeout_ms integer CHECK(call_timeout_ms>0),verified boolean NOT NULL DEFAULT false,evidence text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),cancelled_at timestamptz,
  CHECK(ends_at>starts_at),CHECK(NOT night_shift OR call_timeout_ms IS NOT NULL)
);
CREATE INDEX duty_period ON duty_rosters(object_id,starts_at,ends_at) WHERE cancelled_at IS NULL;
CREATE TABLE notification_contacts (
  user_id uuid NOT NULL REFERENCES users(id),channel text NOT NULL CHECK(channel IN ('wecom','voice')),
  encrypted_address text NOT NULL,verified boolean NOT NULL,evidence text NOT NULL,updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,channel)
);
CREATE TABLE notification_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),alert_id uuid NOT NULL REFERENCES alerts(id),event_id uuid REFERENCES domain_events(id),
  roster_id uuid REFERENCES duty_rosters(id),recipient_id uuid NOT NULL REFERENCES users(id),channel text NOT NULL CHECK(channel IN ('wecom','voice')),
  phase text NOT NULL CHECK(phase IN ('initial','recovery','escalation','reminder','admin_reminder')),
  level integer,request_key text NOT NULL UNIQUE,text text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','accepted','delivered','failed','unknown','cancelled','blocked')),
  started_at timestamptz,provider_request_id text,error_code text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intent_id uuid NOT NULL UNIQUE REFERENCES notification_intents(id),
  job_id uuid NOT NULL REFERENCES jobs(id),lease_token uuid NOT NULL,started_at timestamptz NOT NULL,
  completed_at timestamptz,result text,cost numeric CHECK(cost>=0),cost_source text
);
CREATE TABLE notification_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intent_id uuid NOT NULL REFERENCES notification_intents(id),
  state text NOT NULL CHECK(state IN ('accepted','delivered','failed','unknown')),provider_request_id text,
  connected boolean,occurred_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),reason_code text
);
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE ON notification_receipts FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
