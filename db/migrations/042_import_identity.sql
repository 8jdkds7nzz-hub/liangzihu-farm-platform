CREATE TABLE protection_import_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),source_ref text NOT NULL,external_id text NOT NULL,
 input_hash char(64) NOT NULL,execution_id uuid NOT NULL REFERENCES protection_executions(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(object_id,source_ref,external_id)
);
CREATE TRIGGER immutable_protection_import_keys BEFORE UPDATE OR DELETE ON protection_import_keys FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
