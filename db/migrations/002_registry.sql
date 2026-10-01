CREATE TABLE objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES objects(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('farm','pond','field','channel','facility')),
  boundary_status text NOT NULL DEFAULT 'unknown' CHECK(boundary_status IN ('unknown','draft','verified')),
  boundary geometry(Geometry,4326),
  source text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(parent_id IS NOT NULL OR kind='farm'),
  CHECK(boundary_status <> 'verified' OR boundary IS NOT NULL)
);
CREATE TABLE object_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id uuid NOT NULL REFERENCES objects(id),
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(object_id,version)
);
CREATE TABLE production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id uuid NOT NULL REFERENCES objects(id),
  code text NOT NULL UNIQUE,
  species text NOT NULL,
  variety text,
  stage text NOT NULL,
  source text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  supersedes_id uuid UNIQUE REFERENCES production_batches(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ended_at IS NULL OR ended_at>started_at)
);
CREATE TABLE data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id uuid NOT NULL REFERENCES objects(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  provider text NOT NULL,
  contract_ref text,
  verified boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id)
);
CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id uuid NOT NULL REFERENCES objects(id),
  source_id uuid NOT NULL REFERENCES data_sources(id),
  external_id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('physical','gateway','camera_channel')),
  parent_device_id uuid REFERENCES devices(id),
  model text,
  serial_number text,
  source text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id,external_id),
  CHECK(kind <> 'camera_channel' OR parent_device_id IS NOT NULL)
);
CREATE TABLE points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  metric text NOT NULL,
  unit text NOT NULL,
  max_age_ms integer CHECK(max_age_ms>0),
  max_gap_ms integer CHECK(max_gap_ms>0),
  timing_source text,
  created_by uuid NOT NULL REFERENCES users(id),
  CHECK((max_age_ms IS NULL AND max_gap_ms IS NULL AND timing_source IS NULL)
    OR (max_age_ms IS NOT NULL AND max_gap_ms IS NOT NULL AND timing_source IS NOT NULL))
);
CREATE TABLE point_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  point_id uuid NOT NULL REFERENCES points(id),
  object_id uuid NOT NULL REFERENCES objects(id),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  verified boolean NOT NULL DEFAULT false,
  evidence text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE INDEX bindings_period ON point_bindings(point_id,valid_from,valid_to);
ALTER TABLE grants ADD CONSTRAINT grants_object_fk FOREIGN KEY(object_id) REFERENCES objects(id) NOT VALID;
ALTER TABLE integration_tokens ADD CONSTRAINT integration_object_fk FOREIGN KEY(object_id) REFERENCES objects(id) NOT VALID;
