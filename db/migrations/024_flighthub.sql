CREATE TABLE dji_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),source_id uuid NOT NULL UNIQUE REFERENCES data_sources(id),
 dock_device_id uuid NOT NULL REFERENCES devices(id),project_uuid uuid NOT NULL,version integer NOT NULL DEFAULT 1,enabled boolean NOT NULL DEFAULT false,
 readonly_confirmed boolean NOT NULL DEFAULT false,evidence text NOT NULL,limit_month_requests integer NOT NULL CHECK(limit_month_requests>=2),
 configured_by uuid NOT NULL REFERENCES users(id),configured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dji_connection_versions(connection_id uuid NOT NULL REFERENCES dji_connections(id),version integer NOT NULL,snapshot jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(connection_id,version));
CREATE TABLE dji_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),connection_id uuid NOT NULL REFERENCES dji_connections(id),configuration_version integer NOT NULL,
 object_id uuid NOT NULL REFERENCES objects(id),source_contract_ref text NOT NULL,purpose text NOT NULL CHECK(purpose IN('sync','file')),task_uuid uuid,resource_id uuid,
 requested_by uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,request_key text NOT NULL,input_hash char(64) NOT NULL,
 reserved_asset_id uuid NOT NULL UNIQUE,asset_id uuid REFERENCES media_assets(id),state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','succeeded','empty','failed','blocked','unknown')),
 execution_token uuid,http_attempts integer NOT NULL DEFAULT 0,attempt_log jsonb NOT NULL DEFAULT '[]',attempted_at timestamptz,archive jsonb NOT NULL DEFAULT '[]',error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,UNIQUE(requested_by,request_key),
 CHECK((purpose='sync' AND task_uuid IS NOT NULL AND resource_id IS NULL) OR(purpose='file' AND resource_id IS NOT NULL AND task_uuid IS NULL))
);
CREATE TABLE dji_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL UNIQUE REFERENCES dji_runs(id),connection_id uuid NOT NULL REFERENCES dji_connections(id),configuration_version integer NOT NULL,
 object_id uuid NOT NULL REFERENCES objects(id),source_id uuid NOT NULL REFERENCES data_sources(id),task_uuid uuid NOT NULL,metadata jsonb NOT NULL,metadata_hash char(64) NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),flight_id uuid REFERENCES flights(id),confirmed_by uuid REFERENCES users(id),confirmation_evidence text
);
CREATE TABLE dji_resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),snapshot_id uuid NOT NULL REFERENCES dji_snapshots(id),external_id uuid NOT NULL,metadata jsonb NOT NULL,encrypted_url text,
 asset_id uuid REFERENCES media_assets(id),UNIQUE(snapshot_id,external_id)
);
ALTER TABLE dji_runs ADD CONSTRAINT dji_resource_fk FOREIGN KEY(resource_id) REFERENCES dji_resources(id);
CREATE UNIQUE INDEX dji_file_pending ON dji_runs(resource_id) WHERE purpose='file' AND state IN('queued','running');
CREATE INDEX dji_snapshot_objects ON dji_snapshots(object_id,received_at DESC);
CREATE TRIGGER immutable_dji_versions BEFORE UPDATE OR DELETE ON dji_connection_versions FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_dji_snapshot_input BEFORE UPDATE OF run_id,connection_id,configuration_version,object_id,source_id,task_uuid,metadata,metadata_hash,received_at ON dji_snapshots FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_dji_resource_input BEFORE UPDATE OF snapshot_id,external_id,metadata,encrypted_url ON dji_resources FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_dji_run_input BEFORE UPDATE OF connection_id,configuration_version,object_id,source_contract_ref,purpose,task_uuid,resource_id,requested_by,auth_version,request_key,input_hash,reserved_asset_id,created_at ON dji_runs FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
