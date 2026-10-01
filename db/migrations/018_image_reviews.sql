CREATE TABLE image_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),camera_event_id uuid NOT NULL REFERENCES camera_events(id),
 asset_id uuid NOT NULL REFERENCES media_assets(id),checksum char(64) NOT NULL,model_version text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','complete','failed')),result jsonb,error_code text,
 created_by uuid NOT NULL REFERENCES users(id),request_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(created_by,request_key)
);
CREATE TABLE image_field_samples (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),device_id uuid NOT NULL REFERENCES devices(id),
 camera_event_id uuid REFERENCES camera_events(id),review_id uuid REFERENCES image_reviews(id),scene text NOT NULL CHECK(scene IN ('day','night','rain_fog')),
 source_ref text NOT NULL,occurred_at timestamptz NOT NULL,target text NOT NULL CHECK(target IN ('person','vehicle','absent','unknown')),
 expected_trigger boolean NOT NULL,camera_triggered boolean,platform_received boolean,person_received boolean,
 human_label text CHECK(human_label IN ('person','vehicle','absent','unknown')),labelled_by uuid REFERENCES users(id),labelled_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),request_key text NOT NULL,UNIQUE(created_by,request_key)
);
CREATE TRIGGER immutable_image_sample_origin BEFORE UPDATE OF object_id,device_id,camera_event_id,review_id,scene,source_ref,occurred_at,target,expected_trigger,camera_triggered,platform_received,person_received ON image_field_samples FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
