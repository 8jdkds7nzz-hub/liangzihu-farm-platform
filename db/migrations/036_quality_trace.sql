CREATE TABLE quality_samples (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),lot_id uuid NOT NULL REFERENCES stock_lots(id),
 sample_code text NOT NULL,stage text NOT NULL CHECK(stage IN('raw','finished')),sampled_at timestamptz NOT NULL,source text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(object_id,sample_code)
);
CREATE TABLE quality_tests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),sample_id uuid NOT NULL REFERENCES quality_samples(id),
 method text NOT NULL,result text NOT NULL CHECK(result IN('pass','fail','inconclusive')),report_ref text NOT NULL,
 tested_at timestamptz NOT NULL,valid_until timestamptz NOT NULL,supersedes_id uuid UNIQUE REFERENCES quality_tests(id),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(valid_until>tested_at)
);
CREATE TABLE quality_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),lot_id uuid NOT NULL REFERENCES stock_lots(id),
 kind text NOT NULL CHECK(kind IN('certificate','certification','brand')),subject text NOT NULL,product text NOT NULL,
 valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,evidence text NOT NULL,verified boolean NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(valid_until>valid_from)
);
CREATE TABLE quality_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),lot_id uuid NOT NULL REFERENCES stock_lots(id),
 from_state text NOT NULL,to_state text NOT NULL,version integer NOT NULL,test_ids uuid[] NOT NULL,credential_ids uuid[] NOT NULL,
 evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(lot_id,version)
);
CREATE TABLE trace_queries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),root_lot_id uuid NOT NULL REFERENCES stock_lots(id),
 direction text NOT NULL CHECK(direction IN('forward','backward')),version integer NOT NULL,snapshot jsonb NOT NULL,input_hash char(64) NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(root_lot_id,direction,created_by,version)
);
CREATE TABLE quality_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),lot_id uuid NOT NULL REFERENCES stock_lots(id),
 title text NOT NULL,target_quantity numeric(20,6) NOT NULL CHECK(target_quantity>0),evidence text NOT NULL,state text NOT NULL DEFAULT 'open' CHECK(state IN('open','closed')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quality_case_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),case_id uuid NOT NULL REFERENCES quality_cases(id),
 action text NOT NULL CHECK(action IN('notice','recover','dispose','close')),quantity numeric(20,6),occurred_at timestamptz NOT NULL,evidence text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(quantity IS NULL OR quantity>0)
);
CREATE TABLE public_trace_cards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),lot_id uuid NOT NULL REFERENCES stock_lots(id),
 version integer NOT NULL,code text NOT NULL UNIQUE,content jsonb NOT NULL,credential_ids uuid[] NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','approved','revoked')),valid_until timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),reviewed_by uuid REFERENCES users(id),
 reviewed_at timestamptz,review_note text,UNIQUE(lot_id,version)
);
CREATE TRIGGER immutable_quality_case BEFORE UPDATE OF object_id,lot_id,title,target_quantity,evidence,created_by ON quality_cases FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_trace_card BEFORE UPDATE OF object_id,lot_id,version,code,content,credential_ids,valid_until,created_by ON public_trace_cards FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['quality_samples','quality_tests','quality_credentials','quality_decisions','trace_queries','quality_case_events']
 LOOP EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION preserve_measurement()',t,t); END LOOP;
END $$;
CREATE INDEX quality_sample_lot ON quality_samples(lot_id);
CREATE INDEX quality_case_lot ON quality_cases(lot_id);

