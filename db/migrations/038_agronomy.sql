CREATE TABLE crop_analyses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),asset_id uuid NOT NULL REFERENCES media_assets(id),
 flight_id uuid REFERENCES flights(id),captured_at timestamptz,checksum char(64) NOT NULL,model_version text NOT NULL,evaluation_mode boolean NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','complete','failed','blocked')),result jsonb,error_code text,execution_token uuid,
 created_by uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz
);
CREATE TABLE crop_labels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),analysis_id uuid NOT NULL REFERENCES crop_analyses(id),
 label text NOT NULL CHECK(label IN('canopy','lodging','waterlogging','bare','unknown')),evidence text NOT NULL,observed_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crop_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),device_id uuid NOT NULL REFERENCES devices(id),
 interval_minutes integer NOT NULL CHECK(interval_minutes BETWEEN 15 AND 10080),enabled boolean NOT NULL,next_at timestamptz NOT NULL,
 evaluation_mode boolean NOT NULL,source_ref text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crop_capture_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),schedule_id uuid NOT NULL REFERENCES crop_schedules(id),
 window_at timestamptz NOT NULL,camera_read_id uuid REFERENCES camera_reads(id),analysis_id uuid REFERENCES crop_analyses(id),
 state text NOT NULL CHECK(state IN('waiting','queued','blocked','unknown','failed')),error_code text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(schedule_id,window_at)
);
CREATE TABLE spectral_products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),asset_id uuid NOT NULL REFERENCES media_assets(id),raw_asset_ids uuid[] NOT NULL,
 flight_id uuid REFERENCES flights(id),captured_at timestamptz NOT NULL,source_ref text NOT NULL,processor text NOT NULL,calibration jsonb NOT NULL,
 bands jsonb NOT NULL,breaks jsonb NOT NULL,index_kind text NOT NULL CHECK(index_kind IN('NDVI','NDRE')),checksum char(64) NOT NULL,
 version integer NOT NULL,algorithm_version text NOT NULL,state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','complete','failed','blocked')),
 result jsonb,preview_asset_id uuid REFERENCES media_assets(id),index_asset_id uuid REFERENCES media_assets(id),error_code text,execution_token uuid,
 created_by uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(asset_id,index_kind,version)
);
ALTER TABLE prescription_maps ADD CONSTRAINT prescription_spectral_source FOREIGN KEY(source_analysis_id) REFERENCES spectral_products(id);
CREATE TABLE agronomy_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),title text NOT NULL,agency text NOT NULL,source_ref text NOT NULL,
 published_at timestamptz NOT NULL,valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,crop text NOT NULL,region text NOT NULL,body text NOT NULL,
 version integer NOT NULL,supersedes_id uuid UNIQUE REFERENCES agronomy_notices(id),state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','approved','withdrawn')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,review_note text,
 CHECK(valid_until>valid_from)
);
CREATE TABLE flow_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),device_id uuid REFERENCES devices(id),point_id uuid REFERENCES points(id),
 from_at timestamptz NOT NULL,to_at timestamptz NOT NULL,value numeric(20,6),unit text NOT NULL CHECK(unit IN('m3/s','m3')),
 source_kind text NOT NULL CHECK(source_kind IN('measured','calibrated','model')),basis_ref text NOT NULL,basis_version text NOT NULL,applicability text NOT NULL,
 valid_until timestamptz NOT NULL,reviewed_by uuid REFERENCES users(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(to_at>=from_at)
);
CREATE TABLE control_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),device_id uuid NOT NULL REFERENCES devices(id),version integer NOT NULL,
 permission text NOT NULL CHECK(permission IN('unknown','allowed','denied')),mode text NOT NULL CHECK(mode IN('unknown','manual','remote')),
 protection text NOT NULL CHECK(protection IN('unknown','active','clear')),load_type text NOT NULL,offline_behavior text NOT NULL,power_loss_behavior text NOT NULL,
 power_return_behavior text NOT NULL,protocol_ref text NOT NULL,feedback_ref text NOT NULL,valid_until timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(device_id,version)
);
CREATE TABLE control_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),device_id uuid NOT NULL REFERENCES devices(id),version integer NOT NULL,
 purpose text NOT NULL,species text NOT NULL,stage text NOT NULL,conditions text NOT NULL,source_ref text NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','approved','withdrawn')),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,review_note text,UNIQUE(device_id,version)
);
CREATE TABLE control_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),device_id uuid NOT NULL REFERENCES devices(id),
 profile_id uuid REFERENCES control_profiles(id),rule_id uuid REFERENCES control_rules(id),purpose text NOT NULL,authorization_ref text NOT NULL,conditions text NOT NULL,
 state text NOT NULL DEFAULT 'blocked' CHECK(state='blocked'),dispatched boolean NOT NULL DEFAULT false CHECK(NOT dispatched),blocked_reasons jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE control_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),request_id uuid NOT NULL REFERENCES control_requests(id),
 layer text NOT NULL CHECK(layer IN('request','device_received','electrical','mechanical','effect')),
 result text NOT NULL CHECK(result IN('observed','not_observed','unknown')),value text,source text NOT NULL CHECK(source IN('platform_record','vendor_receipt','field_observation')),
 observed_at timestamptz NOT NULL,evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE control_takeovers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),device_id uuid NOT NULL REFERENCES devices(id),request_id uuid REFERENCES control_requests(id),
 person text NOT NULL,manual_device text NOT NULL,conditions text NOT NULL,occurred_at timestamptz NOT NULL,evidence text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_crop_input BEFORE UPDATE OF object_id,asset_id,flight_id,captured_at,checksum,model_version,evaluation_mode,created_by,auth_version ON crop_analyses FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_spectral_input BEFORE UPDATE OF object_id,asset_id,raw_asset_ids,flight_id,captured_at,source_ref,processor,calibration,bands,breaks,index_kind,checksum,version,algorithm_version,created_by,auth_version ON spectral_products FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_notice_input BEFORE UPDATE OF object_id,title,agency,source_ref,published_at,valid_from,valid_until,crop,region,body,version,supersedes_id,created_by ON agronomy_notices FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_control_rule BEFORE UPDATE OF object_id,device_id,version,purpose,species,stage,conditions,source_ref,created_by ON control_rules FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_crop_schedule BEFORE UPDATE OF object_id,device_id,interval_minutes,evaluation_mode,source_ref,created_by,auth_version ON crop_schedules FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crop_labels','flow_observations','control_profiles','control_requests','control_feedback','control_takeovers']
 LOOP EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION preserve_measurement()',t,t); END LOOP;
END $$;

