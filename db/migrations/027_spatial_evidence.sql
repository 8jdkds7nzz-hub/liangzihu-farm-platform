CREATE TABLE flight_coverages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),flight_id uuid NOT NULL REFERENCES flights(id),object_id uuid NOT NULL REFERENCES objects(id),
 version integer NOT NULL,geometry geometry(MultiPolygon,4326) NOT NULL,source_crs integer NOT NULL,source_ref text NOT NULL,
 status text NOT NULL CHECK(status IN('draft','verified')),request_key text NOT NULL,input_hash char(64) NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(flight_id,version),UNIQUE(created_by,request_key)
);
CREATE TRIGGER immutable_flight_coverage BEFORE UPDATE OR DELETE ON flight_coverages FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE INDEX flight_coverage_space ON flight_coverages USING gist(geometry);
ALTER TABLE flight_annotations ADD COLUMN file_id uuid REFERENCES flight_files(id);
ALTER TABLE flight_annotations ADD COLUMN source_ref text;
ALTER TABLE flight_annotations ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE flight_annotations ADD COLUMN supersedes_id uuid UNIQUE REFERENCES flight_annotations(id);
CREATE TABLE flight_rasters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),file_id uuid NOT NULL REFERENCES flight_files(id),flight_id uuid NOT NULL REFERENCES flights(id),object_id uuid NOT NULL REFERENCES objects(id),
 source_asset_id uuid NOT NULL REFERENCES media_assets(id),source_checksum char(64) NOT NULL,bounds jsonb NOT NULL,source_ref text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,request_key text NOT NULL,input_hash char(64) NOT NULL,
 state text NOT NULL DEFAULT 'queued',preview_asset_id uuid REFERENCES media_assets(id),error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,UNIQUE(created_by,request_key)
);
CREATE TRIGGER immutable_raster_input BEFORE UPDATE OF file_id,flight_id,object_id,source_asset_id,source_checksum,bounds,source_ref,created_by,auth_version,request_key,input_hash ON flight_rasters FOR EACH ROW EXECUTE FUNCTION preserve_measurement();

ALTER TABLE flight_annotations ADD COLUMN request_key text;
ALTER TABLE flight_annotations ADD COLUMN input_hash char(64);
ALTER TABLE flight_annotations ADD UNIQUE(created_by,request_key);
