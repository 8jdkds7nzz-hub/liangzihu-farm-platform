CREATE TABLE inventory_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),
 created_by uuid NOT NULL REFERENCES users(id),kind text NOT NULL,request_key text NOT NULL,input_hash char(64) NOT NULL,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(created_by,kind,request_key)
);
CREATE TABLE stock_locations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),code text NOT NULL,name text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(object_id,code)
);
CREATE TABLE stock_lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),code text NOT NULL UNIQUE,
 product text NOT NULL,kind text NOT NULL CHECK(kind IN('input','harvest','processed')),unit text NOT NULL CHECK(unit IN('kg','L','piece')),
 basis text NOT NULL CHECK(basis IN('as_is','wet','dry')),production_batch_id uuid REFERENCES production_batches(id),
 identities jsonb NOT NULL,source text NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','available','returned','recalled','blocked')),
 version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(unit='kg' OR basis='as_is')
);
CREATE TABLE stock_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),kind text NOT NULL,
 occurred_at timestamptz NOT NULL,evidence text NOT NULL,metadata jsonb NOT NULL,reverses_id uuid UNIQUE REFERENCES stock_documents(id),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stock_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES stock_documents(id),
 lot_id uuid NOT NULL REFERENCES stock_lots(id),location_id uuid NOT NULL REFERENCES stock_locations(id),
 delta numeric(20,6) NOT NULL CHECK(delta<>0),UNIQUE(document_id,lot_id,location_id)
);
CREATE INDEX stock_entry_balance ON stock_entries(lot_id,location_id);
CREATE TABLE input_purchases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),lot_id uuid NOT NULL REFERENCES stock_lots(id),
 supplier text NOT NULL,voucher text NOT NULL,quantity numeric(20,6) NOT NULL CHECK(quantity>0),occurred_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE input_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),lot_id uuid NOT NULL REFERENCES stock_lots(id),
 issue_document_id uuid NOT NULL REFERENCES stock_documents(id),farm_record_id uuid REFERENCES farm_records(id),
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),occurred_at timestamptz NOT NULL,evidence text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stock_transformations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),code text NOT NULL,kind text NOT NULL,source_ref text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(object_id,code)
);
CREATE TABLE stock_lineage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transformation_id uuid NOT NULL REFERENCES stock_transformations(id),
 document_id uuid NOT NULL REFERENCES stock_documents(id),input_lot_id uuid NOT NULL REFERENCES stock_lots(id),output_lot_id uuid NOT NULL REFERENCES stock_lots(id),
 CHECK(input_lot_id<>output_lot_id),UNIQUE(document_id,input_lot_id,output_lot_id)
);
CREATE INDEX stock_lineage_input ON stock_lineage(input_lot_id);
CREATE INDEX stock_lineage_output ON stock_lineage(output_lot_id);
CREATE TABLE stock_packages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),code text NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stock_package_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),package_id uuid NOT NULL REFERENCES stock_packages(id),
 lot_id uuid NOT NULL REFERENCES stock_lots(id),action text NOT NULL CHECK(action IN('add','remove')),quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 occurred_at timestamptz NOT NULL,evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stock_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),lot_id uuid NOT NULL REFERENCES stock_lots(id),
 dispatch_id uuid REFERENCES stock_handoffs(id),direction text NOT NULL CHECK(direction IN('dispatch','receipt')),
 party text NOT NULL,quantity numeric(20,6) NOT NULL CHECK(quantity>0),occurred_at timestamptz NOT NULL,evidence text NOT NULL,
 document_id uuid UNIQUE REFERENCES stock_documents(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((direction='dispatch' AND dispatch_id IS NULL AND document_id IS NOT NULL) OR (direction='receipt' AND dispatch_id IS NOT NULL AND document_id IS NULL))
);
CREATE TRIGGER immutable_stock_lot BEFORE UPDATE OF object_id,code,product,kind,unit,basis,production_batch_id,identities,source,created_by ON stock_lots FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['inventory_requests','stock_locations','stock_documents','stock_entries','input_purchases','input_applications','stock_transformations','stock_lineage','stock_packages','stock_package_events','stock_handoffs']
 LOOP EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION preserve_measurement()',t,t); END LOOP;
END $$;

