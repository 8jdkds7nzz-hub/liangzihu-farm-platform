CREATE TABLE ezviz_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),source_id uuid NOT NULL UNIQUE REFERENCES data_sources(id),
 version integer NOT NULL DEFAULT 1,settings jsonb NOT NULL,processor_id uuid NOT NULL REFERENCES users(id),processor_auth_version integer NOT NULL,
 readonly_confirmed boolean NOT NULL DEFAULT false,reminder_handover_confirmed boolean NOT NULL DEFAULT false,enabled boolean NOT NULL DEFAULT false,
 evidence text NOT NULL,configured_by uuid NOT NULL REFERENCES users(id),configured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ezviz_connection_versions (
 connection_id uuid NOT NULL REFERENCES ezviz_connections(id),version integer NOT NULL,snapshot jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(connection_id,version)
);
CREATE TABLE ezviz_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),connection_id uuid NOT NULL REFERENCES ezviz_connections(id),configuration_version integer NOT NULL,
 object_id uuid NOT NULL REFERENCES objects(id),source_id uuid NOT NULL REFERENCES data_sources(id),source_contract_ref text NOT NULL,
 processor_id uuid NOT NULL REFERENCES users(id),processor_auth_version integer NOT NULL,message_id text NOT NULL,message_type text NOT NULL,
 device_serial text NOT NULL,channel_no integer,pushed_at timestamptz,signature_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 raw_sha256 char(64) NOT NULL,content_hash char(64) NOT NULL,encrypted_message text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processed','awaiting_contract','blocked','failed')),
 camera_event_id uuid REFERENCES camera_events(id),image_state text NOT NULL DEFAULT 'pending' CHECK(image_state IN ('pending','none','queued','encrypted','disabled','failed')),
 image_error text,error_code text,processed_at timestamptz,UNIQUE(connection_id,message_id)
);
CREATE INDEX ezviz_receipts_by_object ON ezviz_receipts(object_id,received_at DESC);
CREATE TRIGGER immutable_ezviz_versions BEFORE UPDATE OR DELETE ON ezviz_connection_versions FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_ezviz_receipt_input BEFORE UPDATE OF connection_id,configuration_version,object_id,source_id,source_contract_ref,processor_id,processor_auth_version,message_id,message_type,device_serial,channel_no,pushed_at,signature_at,received_at,raw_sha256,content_hash,encrypted_message ON ezviz_receipts FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
