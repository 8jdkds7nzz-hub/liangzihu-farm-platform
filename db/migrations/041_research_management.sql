CREATE TABLE research_protocols (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),title text NOT NULL,question text NOT NULL,baseline text NOT NULL,
 plots jsonb NOT NULL,metrics jsonb NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,testing_plan text NOT NULL,stop_rules text NOT NULL,source_ref text NOT NULL,
 version integer NOT NULL CHECK(version>0),supersedes_id uuid UNIQUE REFERENCES research_protocols(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(starts_at<ends_at)
);
CREATE TABLE research_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),seq bigint GENERATED ALWAYS AS IDENTITY,object_id uuid NOT NULL REFERENCES objects(id),protocol_id uuid NOT NULL REFERENCES research_protocols(id),
 action text NOT NULL CHECK(action IN('approve','withdraw')),evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),protocol_id uuid NOT NULL REFERENCES research_protocols(id),plot_object_id uuid NOT NULL REFERENCES objects(id),
 metric text NOT NULL,sample_key text NOT NULL,value numeric(20,6),unit text NOT NULL,observed_at timestamptz NOT NULL,method text NOT NULL,
 kind text NOT NULL CHECK(kind IN('field','lab_report')),agency text,report_ref text,missing_reason text,evidence text NOT NULL,asset_ids uuid[] NOT NULL,
 version integer NOT NULL CHECK(version>0),supersedes_id uuid UNIQUE REFERENCES research_observations(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(protocol_id,plot_object_id,metric,sample_key,version),CHECK(value IS NOT NULL OR missing_reason IS NOT NULL),CHECK(kind<>'lab_report' OR (agency IS NOT NULL AND report_ref IS NOT NULL AND cardinality(asset_ids)>0))
);
CREATE TABLE research_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),protocol_id uuid NOT NULL REFERENCES research_protocols(id),title text NOT NULL,
 claim text NOT NULL,claim_level text NOT NULL CHECK(claim_level IN('verifiable','official','self_reported')),source_ref text NOT NULL,inputs jsonb NOT NULL,summary jsonb NOT NULL,input_hash char(64) NOT NULL,
 version integer NOT NULL CHECK(version>0),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(protocol_id,version)
);
CREATE TABLE research_result_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),seq bigint GENERATED ALWAYS AS IDENTITY,object_id uuid NOT NULL REFERENCES objects(id),result_id uuid NOT NULL REFERENCES research_results(id),
 action text NOT NULL CHECK(action IN('approve','withdraw')),evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE management_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),from_at timestamptz NOT NULL,to_at timestamptz NOT NULL,source_ref text NOT NULL,
 definition_version text NOT NULL,state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','complete','failed')),job_id uuid UNIQUE REFERENCES jobs(id),execution_token uuid,
 inputs jsonb,result jsonb,input_hash char(64),error_code text,auth_version integer NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz,
 CHECK(from_at<to_at),CHECK(state<>'complete' OR (inputs IS NOT NULL AND result IS NOT NULL AND input_hash IS NOT NULL))
);
CREATE TRIGGER immutable_management_input BEFORE UPDATE OF object_id,from_at,to_at,source_ref,definition_version,auth_version,created_by ON management_reports FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE FUNCTION preserve_finished_management() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.state='complete' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Completed report snapshot is immutable' USING ERRCODE='55000'; END IF; RETURN NEW; END;
$$;
CREATE TRIGGER immutable_management_result BEFORE UPDATE ON management_reports FOR EACH ROW EXECUTE FUNCTION preserve_finished_management();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['research_protocols','research_reviews','research_observations','research_results','research_result_reviews']
 LOOP EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION preserve_measurement()',t,t); END LOOP;
END $$;
