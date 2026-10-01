CREATE TABLE raw_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES data_sources(id),
  received_at timestamptz NOT NULL, body bytea NOT NULL, sha256 char(64) NOT NULL,
  synthetic boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE observation_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_hash char(64) NOT NULL UNIQUE,
  point_id uuid NOT NULL REFERENCES points(id), canonical_id uuid, conflicted boolean NOT NULL DEFAULT false
);
CREATE TABLE observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), head_id uuid REFERENCES observation_heads(id),
  content_hash char(64) NOT NULL, source_id uuid NOT NULL REFERENCES data_sources(id),
  source_record_id text, external_device_id text NOT NULL, point_id uuid NOT NULL REFERENCES points(id),
  object_id uuid REFERENCES objects(id), binding_id uuid REFERENCES point_bindings(id),
  metric text NOT NULL, sampled_at timestamptz, reported_at timestamptz, received_at timestamptz NOT NULL,
  sequence text, raw_value jsonb NOT NULL, value numeric, unit text NOT NULL,
  quality text NOT NULL CHECK(quality IN ('valid','suspect','invalid')), reasons text[] NOT NULL,
  origin text NOT NULL CHECK(origin IN ('live','history','manual')), raw_ref uuid NOT NULL REFERENCES raw_receipts(id),
  UNIQUE(head_id,content_hash)
);
ALTER TABLE observation_heads ADD CONSTRAINT head_canonical_fk FOREIGN KEY(canonical_id) REFERENCES observations(id);
CREATE INDEX observations_history ON observations(point_id,object_id,sampled_at,id);
CREATE TABLE observation_receipts (observation_id uuid REFERENCES observations(id),raw_ref uuid REFERENCES raw_receipts(id),PRIMARY KEY(observation_id,raw_ref));
CREATE TABLE measurement_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), head_id uuid NOT NULL REFERENCES observation_heads(id),
  first_id uuid NOT NULL REFERENCES observations(id), other_id uuid NOT NULL REFERENCES observations(id),
  detected_at timestamptz NOT NULL, UNIQUE(head_id,other_id)
);
CREATE TABLE quarantined_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),raw_ref uuid NOT NULL REFERENCES raw_receipts(id),
  input jsonb NOT NULL,reasons text[] NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE point_current (
  point_id uuid PRIMARY KEY REFERENCES points(id),observation_id uuid NOT NULL REFERENCES observations(id),
  sampled_at timestamptz NOT NULL,quality text NOT NULL, reasons text[] NOT NULL
);
CREATE TABLE ingestion_cursors (source_id uuid PRIMARY KEY REFERENCES data_sources(id),cursor text,updated_at timestamptz NOT NULL);
CREATE TABLE source_health (
  source_id uuid PRIMARY KEY REFERENCES data_sources(id),last_attempt_at timestamptz NOT NULL,
  last_success_at timestamptz,error_code text,state text NOT NULL CHECK(state IN ('ok','unavailable','unauthorized','rate_limited','unknown'))
);
CREATE FUNCTION preserve_measurement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Raw evidence is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER immutable_raw BEFORE UPDATE OR DELETE ON raw_receipts FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_observations BEFORE UPDATE OR DELETE ON observations FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
