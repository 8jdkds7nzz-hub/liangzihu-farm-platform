CREATE TABLE comparison_definitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),name text NOT NULL,
 current_definition_id uuid NOT NULL REFERENCES metric_definitions(id),baseline_definition_id uuid NOT NULL REFERENCES metric_definitions(id),
 threshold double precision NOT NULL CHECK(threshold>0),criteria jsonb NOT NULL,source_ref text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),approved_by uuid REFERENCES users(id),approved_at timestamptz,retired_at timestamptz
);
CREATE TRIGGER immutable_comparison_definition BEFORE UPDATE OF object_id,name,current_definition_id,baseline_definition_id,threshold,criteria,source_ref,created_by ON comparison_definitions FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TABLE comparison_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),definition_id uuid NOT NULL REFERENCES comparison_definitions(id),
 current_ids uuid[] NOT NULL,baseline_ids uuid[] NOT NULL,state text NOT NULL,advance_days integer,current_date_label text,baseline_date_label text,
 limitations jsonb NOT NULL,input_hash char(64) NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(definition_id,input_hash)
);
CREATE TRIGGER immutable_comparison_result BEFORE UPDATE OR DELETE ON comparison_results FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
