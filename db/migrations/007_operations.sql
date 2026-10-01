CREATE TABLE maintenance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),point_id uuid REFERENCES points(id),
  occurred_at timestamptz NOT NULL,record_type text NOT NULL CHECK(record_type IN ('cleaning','calibration','replacement','installation','repair')),
  payload jsonb NOT NULL,source text NOT NULL,supersedes_id uuid UNIQUE REFERENCES maintenance_records(id),
  recorded_by uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT now(),request_key text NOT NULL,UNIQUE(recorded_by,request_key)
);
CREATE TABLE manual_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),point_id uuid REFERENCES points(id),
  occurred_at timestamptz NOT NULL,metric text NOT NULL,raw_value text NOT NULL,value numeric,unit text NOT NULL,
  method text NOT NULL,source text NOT NULL,supersedes_id uuid UNIQUE REFERENCES manual_checks(id),
  recorded_by uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT now(),request_key text NOT NULL,UNIQUE(recorded_by,request_key)
);
CREATE TABLE work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),point_id uuid REFERENCES points(id),
  fault text NOT NULL,state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','assigned','handled','reviewed')),
  responsible_role text NOT NULL,assigned_to uuid REFERENCES users(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  request_key text NOT NULL,UNIQUE(created_by,request_key)
);
CREATE TABLE work_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid NOT NULL REFERENCES work_orders(id),
  state text NOT NULL,note text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE export_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_by uuid NOT NULL REFERENCES users(id),object_ids uuid[] NOT NULL,
  from_at timestamptz NOT NULL,to_at timestamptz NOT NULL,payload jsonb NOT NULL,sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours'
);
CREATE TABLE service_heartbeats (
  service text PRIMARY KEY,instance_id text NOT NULL,state text NOT NULL CHECK(state IN ('ok','blocked','failed')),
  observed_at timestamptz NOT NULL,last_success_at timestamptz,detail_code text
);
CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),category text NOT NULL,
  month date NOT NULL,limit_amount numeric NOT NULL CHECK(limit_amount>0),currency text NOT NULL DEFAULT 'CNY',source text NOT NULL,
  configured_by uuid NOT NULL REFERENCES users(id),UNIQUE(object_id,category,month)
);
CREATE TABLE usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),category text NOT NULL,
  business_key text NOT NULL UNIQUE,occurred_at timestamptz NOT NULL,units numeric NOT NULL CHECK(units>=0),amount numeric CHECK(amount>=0),
  currency text NOT NULL DEFAULT 'CNY',price_source text,recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK(amount IS NULL OR price_source IS NOT NULL)
);
CREATE TABLE budget_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),budget_id uuid NOT NULL REFERENCES budgets(id),level text NOT NULL CHECK(level IN ('eighty_percent','limit')),
  observed_at timestamptz NOT NULL,UNIQUE(budget_id,level)
);
CREATE TABLE backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),started_at timestamptz NOT NULL,completed_at timestamptz,
  latest_recoverable_at timestamptz,manifest_ref text NOT NULL,checksum_passed boolean NOT NULL DEFAULT false,
  state text NOT NULL CHECK(state IN ('running','verified','failed')),scope text[] NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE recovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),evidence jsonb NOT NULL,result jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_maintenance BEFORE UPDATE OR DELETE ON maintenance_records FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_manual BEFORE UPDATE OR DELETE ON manual_checks FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_work_order_events BEFORE UPDATE OR DELETE ON work_order_events FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_usage BEFORE UPDATE OR DELETE ON usage_events FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
