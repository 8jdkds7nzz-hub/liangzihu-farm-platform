CREATE TABLE resource_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), object_id uuid NOT NULL REFERENCES objects(id),
 resource_type text NOT NULL, resource_id uuid NOT NULL, from_at timestamptz, to_at timestamptz,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(to_at IS NULL OR from_at IS NULL OR to_at>from_at)
);
CREATE INDEX resource_grants_scope ON resource_grants(user_id,object_id,resource_type,resource_id);
CREATE TABLE boundary_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), object_id uuid NOT NULL REFERENCES objects(id), object_version integer NOT NULL,
 boundary geometry(MultiPolygon,4326) NOT NULL, source_crs integer NOT NULL, source text NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','verified')), confirmed_by uuid REFERENCES users(id), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(object_id,object_version), CHECK(status<>'verified' OR confirmed_by IS NOT NULL)
);
CREATE INDEX object_boundary_space ON objects USING gist(boundary);
CREATE TABLE device_positions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id uuid NOT NULL REFERENCES devices(id), object_id uuid NOT NULL REFERENCES objects(id),
 version integer NOT NULL, position geometry(Point,4326) NOT NULL, source text NOT NULL, verified boolean NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(device_id,version)
);
CREATE TRIGGER immutable_boundaries BEFORE UPDATE OR DELETE ON boundary_versions FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_positions BEFORE UPDATE OR DELETE ON device_positions FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
