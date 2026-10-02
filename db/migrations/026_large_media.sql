ALTER TABLE media_assets DROP CONSTRAINT media_assets_byte_length_check;
DROP TRIGGER immutable_media_identity ON media_assets;
ALTER TABLE media_assets ALTER COLUMN byte_length TYPE bigint;
CREATE TRIGGER immutable_media_identity BEFORE UPDATE OF object_id,checksum,byte_length,storage_key,preview_of,captured_at,metadata,created_by ON media_assets FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
ALTER TABLE media_assets ADD CONSTRAINT media_assets_byte_length_check CHECK(byte_length>0 AND byte_length<=10737418240);
CREATE TABLE media_upload_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),asset_id uuid NOT NULL UNIQUE,object_id uuid NOT NULL REFERENCES objects(id),
 created_by uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,request_key text NOT NULL,input_hash char(64) NOT NULL,
 byte_length bigint NOT NULL,name text NOT NULL,mime text NOT NULL,source text NOT NULL,captured_at timestamptz,expected_checksum char(64),
 state text NOT NULL DEFAULT 'open',execution_token uuid,error_code text,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',completed_at timestamptz,
 UNIQUE(created_by,request_key),CHECK(byte_length>0 AND byte_length<=10737418240)
);
CREATE TABLE media_upload_parts (
 session_id uuid NOT NULL REFERENCES media_upload_sessions(id),part_number integer NOT NULL,byte_length integer NOT NULL,checksum char(64) NOT NULL,
 storage_key text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(session_id,part_number)
);
CREATE TRIGGER immutable_upload_session_input BEFORE UPDATE OF asset_id,object_id,created_by,auth_version,request_key,input_hash,byte_length,name,mime,source,captured_at,expected_checksum ON media_upload_sessions FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_upload_parts BEFORE UPDATE OR DELETE ON media_upload_parts FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
