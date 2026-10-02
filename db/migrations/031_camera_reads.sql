ALTER TABLE camera_capabilities ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE camera_reads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id uuid NOT NULL REFERENCES devices(id),object_id uuid NOT NULL REFERENCES objects(id),
 source_id uuid NOT NULL REFERENCES data_sources(id),source_contract_ref text NOT NULL,configuration_version integer NOT NULL,
 operation text NOT NULL CHECK(operation IN('live','playback','capture')),parameters jsonb NOT NULL,
 requested_by uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,request_key text NOT NULL,input_hash char(64) NOT NULL,
 state text NOT NULL DEFAULT 'queued',encrypted_url text,asset_id uuid REFERENCES media_assets(id),attempted_at timestamptz,error_code text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(requested_by,request_key)
);
CREATE TABLE camera_stream_resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),read_id uuid NOT NULL REFERENCES camera_reads(id),url_hash char(64) NOT NULL,
 encrypted_url text NOT NULL,kind text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(read_id,url_hash)
);
CREATE TRIGGER immutable_camera_read_input BEFORE UPDATE OF device_id,object_id,source_id,source_contract_ref,configuration_version,operation,parameters,requested_by,auth_version,request_key,input_hash ON camera_reads FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_camera_stream_resources BEFORE UPDATE OR DELETE ON camera_stream_resources FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
