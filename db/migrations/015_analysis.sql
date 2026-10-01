CREATE TABLE metric_definitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),point_id uuid NOT NULL REFERENCES points(id),
 name text NOT NULL,version integer NOT NULL,specification jsonb NOT NULL,source_ref text NOT NULL,
 approved_by uuid REFERENCES users(id),approved_at timestamptz,retired_at timestamptz,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(object_id,name,version)
);
CREATE TABLE metric_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),definition_id uuid NOT NULL REFERENCES metric_definitions(id),
 definition_version integer NOT NULL,window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,calculated_at timestamptz NOT NULL DEFAULT now(),
 value double precision,observed_value double precision,unit text NOT NULL,status text NOT NULL CHECK(status IN ('usable','insufficient','incomparable')),
 coverage double precision,limitations jsonb NOT NULL,evidence_ids uuid[] NOT NULL,input_hash char(64) NOT NULL,version integer NOT NULL,
 UNIQUE(definition_id,window_start,window_end,input_hash)
);
CREATE TABLE weather_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),kind text NOT NULL CHECK(kind IN ('actual','forecast','warning','baseline')),
 source text NOT NULL,source_version text NOT NULL,station_ref text NOT NULL,published_at timestamptz NOT NULL,valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL,
 content jsonb NOT NULL,comparison_basis jsonb NOT NULL,request_key text NOT NULL,content_hash char(64) NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(created_by,request_key),CHECK(valid_to>valid_from)
);
CREATE TRIGGER immutable_metrics BEFORE UPDATE OR DELETE ON metric_results FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_metric_definition BEFORE UPDATE OF object_id,point_id,name,version,specification,source_ref ON metric_definitions FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_weather BEFORE UPDATE OR DELETE ON weather_records FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
