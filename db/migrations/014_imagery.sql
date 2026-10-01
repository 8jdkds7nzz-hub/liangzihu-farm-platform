ALTER TABLE alerts DROP CONSTRAINT alerts_kind_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_kind_check CHECK(kind IN ('measurement','monitoring_gap','source_unavailable','camera'));
CREATE TABLE camera_capabilities (
 device_id uuid PRIMARY KEY REFERENCES devices(id),contract_version text NOT NULL,evidence text NOT NULL,model text NOT NULL,firmware text NOT NULL,
 verified boolean NOT NULL DEFAULT false,capabilities jsonb NOT NULL,updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE camera_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),device_id uuid NOT NULL REFERENCES devices(id),
 source_id uuid NOT NULL REFERENCES data_sources(id),external_event_id text NOT NULL,contract_version text NOT NULL,
 occurred_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),event_type text NOT NULL,payload jsonb NOT NULL,
 payload_hash char(64) NOT NULL,alert_id uuid NOT NULL REFERENCES alerts(id),asset_id uuid REFERENCES media_assets(id),
 image_state text NOT NULL DEFAULT 'pending' CHECK(image_state IN ('pending','complete','failed')),image_error text,UNIQUE(source_id,external_event_id)
);
CREATE TABLE flights (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),source_id uuid NOT NULL REFERENCES data_sources(id),external_id text NOT NULL,
 started_at timestamptz NOT NULL,finished_at timestamptz NOT NULL,aircraft_model text NOT NULL,dock_model text,provider_version text NOT NULL,
 source_ref text NOT NULL,crs text NOT NULL,capture_conditions jsonb NOT NULL,payloads jsonb NOT NULL,manifest_hash char(64) NOT NULL,
 footprint geometry(MultiPolygon,4326),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source_id,external_id),CHECK(finished_at>=started_at)
);
CREATE TABLE flight_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),flight_id uuid NOT NULL REFERENCES flights(id),external_file_id text NOT NULL,
 name text NOT NULL,kind text NOT NULL,version text NOT NULL,checksum char(64) NOT NULL,parent_external_ids text[] NOT NULL,
 processing_source text,bands jsonb NOT NULL,calibration jsonb NOT NULL,asset_id uuid REFERENCES media_assets(id),UNIQUE(flight_id,external_file_id)
);
CREATE TABLE flight_annotations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),flight_id uuid NOT NULL REFERENCES flights(id),asset_id uuid REFERENCES media_assets(id),note text NOT NULL,
 location jsonb,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_camera_origin BEFORE UPDATE OF object_id,device_id,source_id,external_event_id,contract_version,occurred_at,payload,payload_hash,alert_id ON camera_events FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_flight_origin BEFORE UPDATE OR DELETE ON flights FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_flight_files BEFORE UPDATE OF flight_id,external_file_id,name,kind,version,checksum,parent_external_ids,processing_source,bands,calibration ON flight_files FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_flight_annotations BEFORE UPDATE OR DELETE ON flight_annotations FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
