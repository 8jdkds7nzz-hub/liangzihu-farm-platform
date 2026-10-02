ALTER TABLE image_reviews ADD COLUMN canonical boolean NOT NULL DEFAULT true;
UPDATE image_reviews SET canonical=false;
WITH ranked AS(SELECT id,row_number() OVER(PARTITION BY camera_event_id,checksum,model_version ORDER BY (state='complete') DESC,created_at DESC,id) AS n FROM image_reviews)
UPDATE image_reviews r SET canonical=true FROM ranked x WHERE x.id=r.id AND x.n=1;
CREATE UNIQUE INDEX image_review_one_active ON image_reviews(camera_event_id,checksum,model_version) WHERE canonical AND state IN('queued','running','complete');
CREATE TABLE image_review_requests (
 actor_id uuid NOT NULL REFERENCES users(id),request_key text NOT NULL,review_id uuid NOT NULL REFERENCES image_reviews(id),
 content_hash char(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER immutable_image_review_request BEFORE UPDATE OR DELETE ON image_review_requests FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
ALTER TABLE image_field_samples ADD COLUMN content_hash char(64);
ALTER TABLE image_field_samples ADD COLUMN human_labels text[];
ALTER TABLE image_field_samples DROP CONSTRAINT image_field_samples_human_label_check;
ALTER TABLE image_field_samples ADD CONSTRAINT image_field_samples_human_label_check CHECK(human_label IN('person','vehicle','person_vehicle','absent','unknown'));
UPDATE image_field_samples SET human_labels=CASE human_label WHEN 'person' THEN ARRAY['person'] WHEN 'vehicle' THEN ARRAY['vehicle'] WHEN 'absent' THEN ARRAY[]::text[] ELSE NULL END;
ALTER TABLE image_field_samples ADD CONSTRAINT image_sample_labels_check CHECK(human_labels<@ARRAY['person','vehicle']::text[]);
ALTER TABLE camera_events ADD COLUMN model_queue_error text;
