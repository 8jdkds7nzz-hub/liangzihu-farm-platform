CREATE TABLE rule_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),point_id uuid NOT NULL REFERENCES points(id),object_id uuid NOT NULL REFERENCES objects(id),
  batch_id uuid NOT NULL REFERENCES production_batches(id),name text NOT NULL,enabled boolean NOT NULL DEFAULT false,
  active_version_id uuid,enabled_at timestamptz,created_by uuid NOT NULL REFERENCES users(id)
);
CREATE TABLE rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),binding_id uuid NOT NULL REFERENCES rule_bindings(id),version integer NOT NULL,
  metric text NOT NULL,unit text NOT NULL,comparison text NOT NULL CHECK(comparison IN ('lt','lte','gt','gte')),threshold numeric NOT NULL,
  duration_ms integer NOT NULL CHECK(duration_ms>=0),max_gap_ms integer NOT NULL CHECK(max_gap_ms>0),max_age_ms integer NOT NULL CHECK(max_age_ms>0),
  severity text NOT NULL CHECK(severity IN ('info','warning','severe')),source text NOT NULL,
  approved_by uuid REFERENCES users(id),approved_at timestamptz,approval_evidence text,
  effective_from timestamptz NOT NULL,effective_to timestamptz,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(binding_id,version),CHECK(effective_to IS NULL OR effective_to>effective_from)
);
ALTER TABLE rule_bindings ADD CONSTRAINT active_rule_fk FOREIGN KEY(active_version_id) REFERENCES rule_versions(id);
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),point_id uuid REFERENCES points(id),
  rule_binding_id uuid REFERENCES rule_bindings(id),rule_version_id uuid REFERENCES rule_versions(id),
  correlation_key text NOT NULL,kind text NOT NULL CHECK(kind IN ('measurement','monitoring_gap','source_unavailable')),
  title text NOT NULL,severity text NOT NULL CHECK(severity IN ('info','warning','severe')),
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','recovered','closed')),data_quality text NOT NULL DEFAULT 'valid',
  opened_at timestamptz NOT NULL,recovered_at timestamptz,closed_at timestamptz,
  first_notification_at timestamptz,recurrences integer NOT NULL DEFAULT 0,continuations integer NOT NULL DEFAULT 0,unmanaged boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX one_active_alert ON alerts(correlation_key) WHERE state<>'closed';
CREATE TABLE alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),alert_id uuid NOT NULL REFERENCES alerts(id),event_type text NOT NULL,
  actor_id uuid REFERENCES users(id),occurred_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT '',evidence jsonb NOT NULL DEFAULT '[]',request_key text,classification text CHECK(classification IN ('normal','false_alarm','device_issue','unknown')),
  UNIQUE(actor_id,request_key),CHECK(jsonb_typeof(evidence)='array')
);
CREATE TABLE alert_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),alert_id uuid NOT NULL REFERENCES alerts(id),
  purpose text NOT NULL CHECK(purpose IN ('field_check','repair')),actor_id uuid NOT NULL REFERENCES users(id),
  request_key text NOT NULL,claimed_at timestamptz NOT NULL,ended_at timestamptz,UNIQUE(actor_id,request_key)
);
CREATE UNIQUE INDEX active_claim ON alert_claims(alert_id,purpose) WHERE ended_at IS NULL;
CREATE TABLE rule_runtime (
  binding_id uuid PRIMARY KEY REFERENCES rule_bindings(id),version_id uuid NOT NULL REFERENCES rule_versions(id),
  last_observation_id uuid REFERENCES observations(id),last_sampled_at timestamptz,candidate_started_at timestamptz,
  previous_matched boolean NOT NULL DEFAULT false,active_alert_id uuid REFERENCES alerts(id)
);
CREATE TRIGGER immutable_alert_events BEFORE UPDATE OR DELETE ON alert_events FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
