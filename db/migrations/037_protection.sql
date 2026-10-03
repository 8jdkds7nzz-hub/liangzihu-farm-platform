CREATE TABLE protection_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),title text NOT NULL,crop text NOT NULL,target text NOT NULL,stage text NOT NULL,
 boundary jsonb NOT NULL,obstacles text NOT NULL,sensitive_areas jsonb NOT NULL,sensitive_note text NOT NULL,conditions text NOT NULL,
 input_lot_id uuid NOT NULL REFERENCES stock_lots(id),task_id uuid REFERENCES field_tasks(id),source text NOT NULL,
 version integer NOT NULL,supersedes_id uuid UNIQUE REFERENCES protection_plans(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE prescription_maps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),plan_id uuid NOT NULL REFERENCES protection_plans(id),
 version integer NOT NULL,source_asset_id uuid REFERENCES media_assets(id),source_analysis_id uuid,
 zones jsonb NOT NULL,dose_unit text NOT NULL,basis text NOT NULL,state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','approved','withdrawn')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,review_note text,UNIQUE(plan_id,version)
);
CREATE TABLE protection_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),plan_id uuid NOT NULL REFERENCES protection_plans(id),
 prescription_id uuid REFERENCES prescription_maps(id),operator text NOT NULL,started_at timestamptz NOT NULL,ended_at timestamptz NOT NULL,
 track jsonb NOT NULL,swath_m double precision,max_gap_seconds integer,material_quantity numeric(20,6),unit text NOT NULL,
 missing jsonb NOT NULL,coverage jsonb NOT NULL,result_check text,
 remediation_of uuid REFERENCES protection_executions(id),cause text,remediation_cost numeric(20,6),evidence text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(ended_at>=started_at)
);
CREATE TABLE prescription_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),prescription_id uuid NOT NULL REFERENCES prescription_maps(id),
 action text NOT NULL CHECK(action IN('shared','downloaded','applied')),execution_id uuid REFERENCES protection_executions(id),
 party text NOT NULL,occurred_at timestamptz NOT NULL,evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE protection_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),source_ref text NOT NULL,input_hash char(64) NOT NULL,
 input_rows jsonb NOT NULL,result_rows jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE protection_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),plan_id uuid NOT NULL REFERENCES protection_plans(id),
 provider text NOT NULL,kind text NOT NULL,asset_ids uuid[] NOT NULL,missing text NOT NULL,received_by text NOT NULL,
 occurred_at timestamptz NOT NULL,evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE protection_followups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),execution_id uuid NOT NULL REFERENCES protection_executions(id),
 observation text NOT NULL,judgment text NOT NULL,action text NOT NULL,occurred_at timestamptz NOT NULL,evidence text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_prescription BEFORE UPDATE OF object_id,plan_id,version,source_asset_id,source_analysis_id,zones,dose_unit,basis,created_by ON prescription_maps FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['protection_plans','protection_executions','prescription_events','protection_imports','protection_deliveries','protection_followups']
 LOOP EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION preserve_measurement()',t,t); END LOOP;
END $$;

