CREATE TABLE remote_media_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),source_id uuid NOT NULL REFERENCES data_sources(id),
 source_contract_ref text NOT NULL,source_provider text NOT NULL,
 target_kind text NOT NULL CHECK(target_kind IN ('camera_event','flight_file')),
 camera_event_id uuid REFERENCES camera_events(id),flight_file_id uuid REFERENCES flight_files(id),
 encrypted_url text NOT NULL,url_hash char(64) NOT NULL,host text NOT NULL,metadata jsonb NOT NULL,evidence text NOT NULL,
 requested_by uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,request_key text NOT NULL,input_hash char(64) NOT NULL,
 reserved_asset_id uuid NOT NULL UNIQUE,asset_id uuid REFERENCES media_assets(id),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','complete','failed','blocked','unknown')),
 execution_token uuid,actual_checksum char(64),byte_length bigint,error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,attempted_at timestamptz,completed_at timestamptz,
 UNIQUE(requested_by,request_key),
 CHECK((target_kind='camera_event' AND camera_event_id IS NOT NULL AND flight_file_id IS NULL) OR(target_kind='flight_file' AND flight_file_id IS NOT NULL AND camera_event_id IS NULL)),
 CHECK(state<>'complete' OR(asset_id IS NOT NULL AND actual_checksum IS NOT NULL AND byte_length>0))
);
CREATE UNIQUE INDEX remote_media_camera_pending ON remote_media_imports(camera_event_id) WHERE state IN ('queued','running');
CREATE UNIQUE INDEX remote_media_flight_pending ON remote_media_imports(flight_file_id) WHERE state IN ('queued','running');
CREATE INDEX remote_media_by_object ON remote_media_imports(object_id,created_at DESC);
CREATE TRIGGER immutable_remote_media_input BEFORE UPDATE OF object_id,source_id,source_contract_ref,source_provider,target_kind,camera_event_id,flight_file_id,encrypted_url,url_hash,host,metadata,evidence,requested_by,auth_version,request_key,input_hash,reserved_asset_id ON remote_media_imports FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
