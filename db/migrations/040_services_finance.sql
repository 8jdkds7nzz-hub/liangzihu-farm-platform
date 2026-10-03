CREATE TABLE machinery_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),provider text NOT NULL,
 account_ref text,fields_ref text,export_ref text,migration_ref text,exit_ref text,valid_until timestamptz NOT NULL,source_ref text NOT NULL,
 version integer NOT NULL CHECK(version>0),supersedes_id uuid UNIQUE REFERENCES machinery_contracts(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE machinery_contract_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),seq bigint GENERATED ALWAYS AS IDENTITY,object_id uuid NOT NULL REFERENCES objects(id),contract_id uuid NOT NULL REFERENCES machinery_contracts(id),
 action text NOT NULL CHECK(action IN('approve','withdraw')),evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE machinery_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),machine_device_id uuid NOT NULL REFERENCES devices(id),terminal_device_id uuid NOT NULL REFERENCES devices(id),
 valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,evidence text NOT NULL,revoked_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(valid_from<valid_until),CHECK(machine_device_id<>terminal_device_id)
);
CREATE TABLE machinery_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),contract_id uuid NOT NULL REFERENCES machinery_contracts(id),binding_id uuid NOT NULL REFERENCES machinery_bindings(id),
 title text NOT NULL,operation text NOT NULL,boundary jsonb NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,quantity numeric(20,6) NOT NULL CHECK(quantity>0),unit text NOT NULL CHECK(unit IN('mu','ha','hour','job')),
 source_ref text NOT NULL,state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','dispatched','cancelled')),dispatched_by uuid REFERENCES users(id),dispatched_at timestamptz,dispatch_evidence text,
 supersedes_id uuid UNIQUE REFERENCES machinery_orders(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(starts_at<ends_at)
);
CREATE TABLE machinery_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),order_id uuid NOT NULL REFERENCES machinery_orders(id),kind text NOT NULL CHECK(kind IN('track','work_order','arrival','spotcheck')),
 passed boolean NOT NULL,occurred_at timestamptz NOT NULL,evidence text NOT NULL,asset_ids uuid[] NOT NULL,track jsonb NOT NULL,version integer NOT NULL CHECK(version>0),supersedes_id uuid UNIQUE REFERENCES machinery_evidence(id),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(order_id,kind,version)
);
CREATE TABLE machinery_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),seq bigint GENERATED ALWAYS AS IDENTITY,object_id uuid NOT NULL REFERENCES objects(id),order_id uuid NOT NULL REFERENCES machinery_orders(id),
 action text NOT NULL CHECK(action IN('accept','withdraw')),evidence_ids uuid[] NOT NULL,evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE machinery_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),contract_id uuid NOT NULL REFERENCES machinery_contracts(id),source_ref text NOT NULL,
 input_rows jsonb NOT NULL,result_rows jsonb NOT NULL,input_hash char(64) NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE machinery_import_rows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),contract_id uuid NOT NULL REFERENCES machinery_contracts(id),source_ref text NOT NULL,external_id text NOT NULL,
 input_hash char(64) NOT NULL,evidence_id uuid NOT NULL REFERENCES machinery_evidence(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(contract_id,source_ref,external_id)
);
CREATE TABLE business_expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),category text NOT NULL CHECK(category IN('material','service','remediation','research','other')),
 quantity numeric(20,6),unit text,unit_price numeric(18,2),amount_cny numeric(18,2),payer text NOT NULL,payee text NOT NULL,voucher text NOT NULL,identity_key char(64) NOT NULL,occurred_at timestamptz NOT NULL,
 link_kind text NOT NULL CHECK(link_kind IN('manual','input_purchase','protection_execution','machine_order','research_protocol','research_result')),link_id uuid,evidence text NOT NULL,
 supersedes_id uuid UNIQUE REFERENCES business_expenses(id),version integer NOT NULL CHECK(version>0),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(quantity IS NULL OR quantity>0),CHECK(unit_price IS NULL OR unit_price>=0),CHECK(amount_cny IS NULL OR amount_cny>=0),CHECK((link_kind='manual')=(link_id IS NULL)),UNIQUE(identity_key,version)
);
CREATE TABLE expense_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),seq bigint GENERATED ALWAYS AS IDENTITY,object_id uuid NOT NULL REFERENCES objects(id),expense_id uuid NOT NULL REFERENCES business_expenses(id),
 action text NOT NULL CHECK(action IN('approve','withdraw')),evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE expense_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),expense_id uuid NOT NULL REFERENCES business_expenses(id),direction text NOT NULL CHECK(direction IN('pay','reverse')),
 amount_cny numeric(18,2) NOT NULL CHECK(amount_cny>0),voucher text NOT NULL,occurred_at timestamptz NOT NULL,evidence text NOT NULL,reverses_id uuid UNIQUE REFERENCES expense_payments(id),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK((direction='reverse')=(reverses_id IS NOT NULL)),UNIQUE(object_id,voucher)
);
CREATE TABLE subsidy_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),category text NOT NULL CHECK(category IN('purchase','replacement','service')),
 policy_ref text NOT NULL,policy_version text NOT NULL,beneficiary text NOT NULL,period_from timestamptz NOT NULL,period_to timestamptz NOT NULL,amount_cny numeric(18,2) NOT NULL CHECK(amount_cny>0),
 evidence text NOT NULL,state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','reviewed','submitted','awarded','rejected','withdrawn')),awarded_cny numeric(18,2),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(period_from<period_to),CHECK(awarded_cny IS NULL OR awarded_cny BETWEEN 0 AND amount_cny)
);
CREATE TABLE subsidy_expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),claim_id uuid NOT NULL REFERENCES subsidy_claims(id),expense_id uuid NOT NULL REFERENCES business_expenses(id),active boolean NOT NULL DEFAULT true,UNIQUE(claim_id,expense_id)
);
CREATE UNIQUE INDEX subsidy_exclusive_expense ON subsidy_expenses(expense_id) WHERE active;
CREATE TABLE subsidy_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),seq bigint GENERATED ALWAYS AS IDENTITY,object_id uuid NOT NULL REFERENCES objects(id),claim_id uuid NOT NULL REFERENCES subsidy_claims(id),
 action text NOT NULL CHECK(action IN('review','submit','award','received','refund','reject','withdraw')),amount_cny numeric(18,2),external_ref text,evidence text NOT NULL,reverses_id uuid UNIQUE REFERENCES subsidy_events(id),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(amount_cny IS NULL OR amount_cny>=0),CHECK((action='refund')=(reverses_id IS NOT NULL))
);
CREATE UNIQUE INDEX subsidy_receipt_identity ON subsidy_events(object_id,external_ref) WHERE action IN('received','refund');
CREATE TRIGGER immutable_machine_binding_input BEFORE UPDATE OF object_id,machine_device_id,terminal_device_id,valid_from,valid_until,evidence,created_by ON machinery_bindings FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_machine_order_input BEFORE UPDATE OF object_id,contract_id,binding_id,title,operation,boundary,starts_at,ends_at,quantity,unit,source_ref,supersedes_id,created_by ON machinery_orders FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_subsidy_input BEFORE UPDATE OF object_id,category,policy_ref,policy_version,beneficiary,period_from,period_to,amount_cny,evidence,created_by ON subsidy_claims FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_subsidy_expense_input BEFORE UPDATE OF object_id,claim_id,expense_id ON subsidy_expenses FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['machinery_contracts','machinery_contract_reviews','machinery_evidence','machinery_reviews','machinery_imports','machinery_import_rows','business_expenses','expense_reviews','expense_payments','subsidy_events']
 LOOP EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION preserve_measurement()',t,t); END LOOP;
END $$;
