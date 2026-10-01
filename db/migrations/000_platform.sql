-- A00 only. Identity and farm domain tables start in the next work items.
CREATE TABLE platform_metadata (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_metadata(key,value)
VALUES ('schema_baseline', '{"version":1,"stage":"A00"}'::jsonb);
