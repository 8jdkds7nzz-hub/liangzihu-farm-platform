CREATE TABLE media_assets (
 id uuid PRIMARY KEY,object_id uuid NOT NULL REFERENCES objects(id),submission_key text NOT NULL,request_key text NOT NULL,
 content_hash char(64) NOT NULL,checksum char(64) NOT NULL,byte_length integer NOT NULL CHECK(byte_length>0 AND byte_length<=20971520),
 name text NOT NULL,mime text NOT NULL,storage_key text NOT NULL UNIQUE,backup_key text,preview_of uuid REFERENCES media_assets(id),
 captured_at timestamptz,metadata jsonb NOT NULL DEFAULT '{}',version text NOT NULL DEFAULT '1',source text NOT NULL,
 ingest_state text NOT NULL DEFAULT 'pending' CHECK(ingest_state IN ('pending','complete','failed')),
 backup_state text NOT NULL DEFAULT 'pending' CHECK(backup_state IN ('pending','verified','failed')),backup_error text,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(created_by,request_key)
);
CREATE TABLE farm_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),object_version integer NOT NULL,
 batch_id uuid REFERENCES production_batches(id),kind text NOT NULL,occurred_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 author_id uuid NOT NULL REFERENCES users(id),submission_id text NOT NULL,content_hash char(64) NOT NULL,content jsonb NOT NULL,
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','reviewed')),version integer NOT NULL DEFAULT 1,
 supersedes_id uuid UNIQUE REFERENCES farm_records(id),correction_reason text,UNIQUE(author_id,submission_id),
 CHECK(supersedes_id IS NULL OR correction_reason IS NOT NULL)
);
CREATE TABLE record_attachments(record_id uuid NOT NULL REFERENCES farm_records(id),asset_id uuid NOT NULL REFERENCES media_assets(id),PRIMARY KEY(record_id,asset_id));
CREATE TABLE record_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),record_id uuid NOT NULL REFERENCES farm_records(id),reviewer_id uuid NOT NULL REFERENCES users(id),note text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER immutable_farm_values BEFORE UPDATE OF object_id,object_version,batch_id,kind,occurred_at,author_id,content,version,supersedes_id,submission_id ON farm_records FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_media_identity BEFORE UPDATE OF object_id,checksum,byte_length,storage_key,preview_of,captured_at,metadata,created_by ON media_assets FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_record_reviews BEFORE UPDATE OR DELETE ON record_reviews FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE INDEX farm_records_object_time ON farm_records(object_id,occurred_at);
CREATE INDEX media_asset_scope ON media_assets(object_id,ingest_state,backup_state);
