CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,business_key text NOT NULL UNIQUE,payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','retry_wait','awaiting_receipt','done','failed')),
  priority integer NOT NULL DEFAULT 0,due_at timestamptz NOT NULL,attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,lease_until timestamptz,worker_id text,external_started_at timestamptz,
  error_code text,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
CREATE INDEX jobs_due ON jobs(kind,priority DESC,due_at) WHERE state IN ('queued','retry_wait');
CREATE TABLE job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES jobs(id),lease_token uuid NOT NULL UNIQUE,
  worker_id text NOT NULL,started_at timestamptz NOT NULL,finished_at timestamptz,outcome text,error_code text,
  processing_version integer NOT NULL DEFAULT 1
);
CREATE TABLE domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text NOT NULL,version integer NOT NULL DEFAULT 1,
  object_id uuid REFERENCES objects(id),occurred_at timestamptz NOT NULL DEFAULT now(),recorded_at timestamptz NOT NULL DEFAULT now(),payload jsonb NOT NULL
);
CREATE TABLE consumer_offsets (consumer text NOT NULL,event_id uuid NOT NULL REFERENCES domain_events(id),processed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(consumer,event_id));
