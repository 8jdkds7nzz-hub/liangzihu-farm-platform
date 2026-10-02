CREATE TABLE terrain_scenes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),flight_id uuid REFERENCES flights(id),
 name text NOT NULL,version integer NOT NULL,supersedes_id uuid UNIQUE REFERENCES terrain_scenes(id),root_path text NOT NULL,
 captured_at timestamptz,source_crs text NOT NULL,survey_crs text NOT NULL,vertical_datum text NOT NULL,conversion_ref text NOT NULL,source_ref text NOT NULL,
 surface_state text NOT NULL CHECK(surface_state IN('unknown','bare_ground','canopy','water','mixed')),
 patches jsonb NOT NULL,repairs_declared boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'validating' CHECK(state IN('validating','ready','failed','withdrawn')),validation jsonb,error_code text,
 created_by uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,request_key text NOT NULL,input_hash char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,withdrawn_at timestamptz,withdraw_reason text,
 UNIQUE(object_id,name,version),UNIQUE(created_by,request_key)
);
CREATE TABLE terrain_resources (
 scene_id uuid NOT NULL REFERENCES terrain_scenes(id),path text NOT NULL,asset_id uuid NOT NULL REFERENCES media_assets(id),
 checksum char(64) NOT NULL,byte_length bigint NOT NULL,mime text NOT NULL,PRIMARY KEY(scene_id,path)
);
CREATE TABLE terrain_surveys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scene_id uuid NOT NULL REFERENCES terrain_scenes(id),object_id uuid NOT NULL REFERENCES objects(id),
 point_key text NOT NULL,version integer NOT NULL,supersedes_id uuid UNIQUE REFERENCES terrain_surveys(id),
 purpose text NOT NULL CHECK(purpose IN('control','check')),independent boolean NOT NULL,position geometry(Point,4326) NOT NULL,
 survey_e double precision NOT NULL,survey_n double precision NOT NULL,survey_h double precision NOT NULL,
 model_e double precision NOT NULL,model_n double precision NOT NULL,model_h double precision NOT NULL,
 horizontal_crs text NOT NULL,vertical_datum text NOT NULL,measured_at timestamptz NOT NULL,source_ref text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),request_key text NOT NULL,input_hash char(64) NOT NULL,
 UNIQUE(scene_id,point_key,version),UNIQUE(created_by,request_key)
);
CREATE TABLE terrain_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scene_id uuid NOT NULL REFERENCES terrain_scenes(id),object_id uuid NOT NULL REFERENCES objects(id),
 input_hash char(64) NOT NULL,decision text NOT NULL CHECK(decision IN('accepted','display_only')),tolerances jsonb NOT NULL,statistics jsonb NOT NULL,
 purpose text NOT NULL,evidence text NOT NULL,review_due_at timestamptz NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),request_key text NOT NULL,content_hash char(64) NOT NULL,UNIQUE(created_by,request_key)
);
CREATE TABLE device_elevations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id uuid NOT NULL REFERENCES devices(id),position_id uuid NOT NULL REFERENCES device_positions(id),
 object_id uuid NOT NULL REFERENCES objects(id),version integer NOT NULL,survey_height double precision NOT NULL,ellipsoid_height double precision,
 vertical_datum text NOT NULL,reference_point text NOT NULL,conversion_ref text NOT NULL,measured_at timestamptz NOT NULL,source_ref text NOT NULL,
 verified boolean NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),request_key text NOT NULL,input_hash char(64) NOT NULL,UNIQUE(device_id,version),UNIQUE(created_by,request_key)
);
CREATE TABLE hydraulic_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scene_id uuid NOT NULL REFERENCES terrain_scenes(id),object_id uuid NOT NULL REFERENCES objects(id),
 to_object_id uuid NOT NULL REFERENCES objects(id),name text NOT NULL,version integer NOT NULL,supersedes_id uuid UNIQUE REFERENCES hydraulic_links(id),
 direction text NOT NULL CHECK(direction IN('forward','bidirectional')),evidence text NOT NULL,verified boolean NOT NULL,
 review_due_at timestamptz NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_at timestamptz,withdraw_reason text,request_key text NOT NULL,input_hash char(64) NOT NULL,CHECK(object_id<>to_object_id),UNIQUE(scene_id,name,version),UNIQUE(created_by,request_key)
);
CREATE TRIGGER immutable_terrain_input BEFORE UPDATE OF object_id,flight_id,name,version,supersedes_id,root_path,captured_at,source_crs,survey_crs,vertical_datum,conversion_ref,source_ref,surface_state,patches,repairs_declared,created_by,auth_version,request_key,input_hash ON terrain_scenes FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_terrain_resources BEFORE UPDATE OR DELETE ON terrain_resources FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_terrain_surveys BEFORE UPDATE OR DELETE ON terrain_surveys FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_terrain_reviews BEFORE UPDATE OR DELETE ON terrain_reviews FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_device_elevations BEFORE UPDATE OR DELETE ON device_elevations FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_hydraulic_input BEFORE UPDATE OF scene_id,object_id,to_object_id,name,version,supersedes_id,direction,evidence,verified,review_due_at,created_by,request_key,input_hash ON hydraulic_links FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE INDEX terrain_scene_scope ON terrain_scenes(object_id,created_at);
