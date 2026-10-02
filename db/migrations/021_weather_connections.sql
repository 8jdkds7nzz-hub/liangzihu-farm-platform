ALTER TABLE weather_records ALTER COLUMN published_at DROP NOT NULL;
ALTER TABLE weather_records ADD COLUMN received_at timestamptz;
CREATE TABLE weather_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),source_id uuid NOT NULL REFERENCES data_sources(id),
 version integer NOT NULL DEFAULT 1,settings jsonb NOT NULL,location_evidence text NOT NULL,evidence text NOT NULL,
 readonly_confirmed boolean NOT NULL,enabled boolean NOT NULL DEFAULT false,limit_month_requests integer NOT NULL CHECK(limit_month_requests BETWEEN 1 AND 100000),
 configured_by uuid NOT NULL REFERENCES users(id),configured_at timestamptz NOT NULL DEFAULT now(),UNIQUE(object_id,source_id)
);
CREATE TABLE weather_connection_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),connection_id uuid NOT NULL REFERENCES weather_connections(id),version integer NOT NULL,
 snapshot jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(connection_id,version)
);
CREATE TABLE weather_sync_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),connection_id uuid NOT NULL REFERENCES weather_connections(id),configuration_version integer NOT NULL,
 object_id uuid NOT NULL REFERENCES objects(id),requested_by uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,request_key text NOT NULL,input_hash char(64) NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','no_data','failed','blocked','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,attempted_at timestamptz,completed_at timestamptz,error_code text,
 response_sha256 char(64),encrypted_response text,record_ids uuid[] NOT NULL DEFAULT '{}',UNIQUE(requested_by,request_key)
);
CREATE TABLE weather_source_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),connection_id uuid NOT NULL REFERENCES weather_connections(id),configuration_version integer NOT NULL,
 source_tag text NOT NULL,content_hash char(64) NOT NULL,record_ids uuid[] NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,configuration_version,source_tag)
);
CREATE TRIGGER immutable_weather_configuration_versions BEFORE UPDATE OR DELETE ON weather_connection_versions FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_weather_source_versions BEFORE UPDATE OR DELETE ON weather_source_versions FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_weather_run_identity BEFORE UPDATE OF connection_id,configuration_version,object_id,requested_by,auth_version,request_key,input_hash ON weather_sync_runs FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
