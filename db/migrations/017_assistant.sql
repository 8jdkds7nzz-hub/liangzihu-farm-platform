CREATE TABLE assistant_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,object_ids uuid[] NOT NULL,
 question text NOT NULL,request_key text NOT NULL,input_hash char(64) NOT NULL,prompt_version text NOT NULL,retrieval_version text NOT NULL,
 state text NOT NULL DEFAULT 'queued',model text,context jsonb,result jsonb,started_at timestamptz,completed_at timestamptz,error_code text,
 usage jsonb,elapsed_ms double precision,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(actor_id,request_key)
);
CREATE TABLE model_policies (
 object_id uuid PRIMARY KEY REFERENCES objects(id),external_enabled boolean NOT NULL DEFAULT false,allow_backup boolean NOT NULL DEFAULT false,
 max_month_tokens bigint NOT NULL CHECK(max_month_tokens>0),max_month_calls integer NOT NULL CHECK(max_month_calls>0),
 input_price_per_million numeric,output_price_per_million numeric,price_source text,approved_scope text NOT NULL,updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),CHECK(input_price_per_million IS NULL OR input_price_per_million>=0),CHECK(output_price_per_million IS NULL OR output_price_per_million>=0)
);
CREATE TABLE model_reservations (
 run_id uuid NOT NULL REFERENCES assistant_runs(id),object_id uuid NOT NULL REFERENCES objects(id),month date NOT NULL,
 reserved_tokens bigint NOT NULL,reserved_calls integer NOT NULL DEFAULT 2,actual_calls integer,reserved_cost numeric,actual_tokens bigint,state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','settled','unknown','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(run_id,object_id)
);
CREATE TABLE briefings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_by uuid NOT NULL REFERENCES users(id),request_key text NOT NULL,input_hash char(64) NOT NULL,
 period text NOT NULL CHECK(period IN ('daily','weekly','monthly')),from_at timestamptz NOT NULL,to_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending_review',created_at timestamptz NOT NULL DEFAULT now(),review_due_at timestamptz NOT NULL,UNIQUE(created_by,request_key)
);
CREATE TABLE briefing_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),briefing_id uuid NOT NULL REFERENCES briefings(id),object_id uuid NOT NULL REFERENCES objects(id),
 kind text NOT NULL,fact_refs jsonb NOT NULL,source_refs jsonb NOT NULL,original_text text NOT NULL,limitations jsonb NOT NULL,
 decision text NOT NULL DEFAULT 'draft' CHECK(decision IN ('draft','adopted','modified','rejected')),reviewed_text text,review_reason text,
 reviewer_id uuid REFERENCES users(id),reviewed_at timestamptz,task_id uuid REFERENCES field_tasks(id),version integer NOT NULL DEFAULT 1
);
CREATE TABLE briefing_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_id uuid NOT NULL REFERENCES briefing_items(id),decision text NOT NULL,text text NOT NULL,
 reason text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),request_key text NOT NULL,content_hash char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(actor_id,request_key)
);
CREATE TABLE briefing_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),briefing_id uuid NOT NULL REFERENCES briefings(id),recipient_id uuid NOT NULL REFERENCES users(id),
 role_version text NOT NULL CHECK(role_version IN ('owner','worker','expert','technician')),item_ids uuid[] NOT NULL,
 confirmed_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
 snapshot jsonb NOT NULL,expires_at timestamptz NOT NULL,request_key text NOT NULL,content_hash char(64) NOT NULL,UNIQUE(confirmed_by,request_key)
);
CREATE TABLE briefing_reminders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),briefing_id uuid NOT NULL REFERENCES briefings(id),recipient_id uuid NOT NULL REFERENCES users(id),state text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(briefing_id,recipient_id));
CREATE TRIGGER immutable_briefing_origin BEFORE UPDATE OF briefing_id,object_id,kind,fact_refs,source_refs,original_text,limitations ON briefing_items FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_briefing_reviews BEFORE UPDATE OR DELETE ON briefing_reviews FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
