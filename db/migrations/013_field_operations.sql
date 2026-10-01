CREATE TABLE calendar_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),name text NOT NULL,version integer NOT NULL,
 species text NOT NULL,variety text,stage text NOT NULL,source_ref text NOT NULL,items jsonb NOT NULL,effective_from timestamptz NOT NULL,
 approved_by uuid REFERENCES users(id),approved_at timestamptz,retired_at timestamptz,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(object_id,name,version)
);
CREATE TRIGGER immutable_calendar_text BEFORE UPDATE OF object_id,name,version,species,variety,stage,source_ref,items,effective_from ON calendar_versions FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TABLE field_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),batch_id uuid REFERENCES production_batches(id),
 calendar_id uuid REFERENCES calendar_versions(id),alert_id uuid REFERENCES alerts(id),title text NOT NULL,instructions text NOT NULL,due_at timestamptz,
 kind text NOT NULL CHECK(kind IN ('inspection','farm_work','irrigation')),state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','dispatched','claimed','reported','reviewed','cancelled')),
 version integer NOT NULL DEFAULT 1,assignee_id uuid REFERENCES users(id),claimed_by uuid REFERENCES users(id),created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),request_key text NOT NULL,content_hash char(64) NOT NULL,UNIQUE(created_by,request_key)
);
CREATE TABLE field_task_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES field_tasks(id),version integer NOT NULL,action text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),payload jsonb NOT NULL,request_key text NOT NULL,content_hash char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(actor_id,request_key)
);
CREATE TABLE inspection_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),task_id uuid NOT NULL REFERENCES field_tasks(id),
 observation text NOT NULL,judgment text NOT NULL,action_taken text NOT NULL,occurred_at timestamptz NOT NULL,
 record_id uuid REFERENCES farm_records(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE irrigation_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),task_id uuid NOT NULL REFERENCES field_tasks(id),
 step text NOT NULL CHECK(step IN ('application','confirmation','execution','result','not_executed')),details text NOT NULL,
 occurred_at timestamptz NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(task_id,step)
);
CREATE TRIGGER immutable_task_events BEFORE UPDATE OR DELETE ON field_task_events FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_inspections BEFORE UPDATE OR DELETE ON inspection_reports FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_irrigation BEFORE UPDATE OR DELETE ON irrigation_entries FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
