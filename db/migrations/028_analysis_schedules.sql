ALTER TABLE briefing_schedules ADD COLUMN period text NOT NULL DEFAULT 'daily' CHECK(period IN('daily','weekly','monthly'));
ALTER TABLE briefing_schedules ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE briefing_schedules ADD COLUMN last_window_end timestamptz;
UPDATE briefing_schedules SET last_window_end=last_day::timestamp AT TIME ZONE 'Asia/Shanghai' WHERE last_day IS NOT NULL;
ALTER TABLE briefing_schedules DROP CONSTRAINT briefing_schedules_object_id_key;
ALTER TABLE briefing_schedules ADD UNIQUE(object_id,period);
CREATE TABLE analysis_calculations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),definition_id uuid NOT NULL REFERENCES metric_definitions(id),
 actor_id uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 business_key text NOT NULL UNIQUE,reason text NOT NULL,state text NOT NULL DEFAULT 'queued',result_id uuid REFERENCES metric_results(id),error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz
);
CREATE TABLE scheduled_briefings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),schedule_id uuid NOT NULL REFERENCES briefing_schedules(id),schedule_version integer NOT NULL,
 object_id uuid NOT NULL REFERENCES objects(id),actor_id uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,
 period text NOT NULL,window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,calculation_ids uuid[] NOT NULL,
 business_key text NOT NULL UNIQUE,state text NOT NULL DEFAULT 'queued',briefing_id uuid REFERENCES briefings(id),error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz
);
CREATE TRIGGER immutable_calculation_input BEFORE UPDATE OF object_id,definition_id,actor_id,auth_version,window_start,window_end,business_key,reason ON analysis_calculations FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_scheduled_briefing_input BEFORE UPDATE OF schedule_id,schedule_version,object_id,actor_id,auth_version,period,window_start,window_end,calculation_ids,business_key ON scheduled_briefings FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
ALTER TABLE briefing_reminders ADD COLUMN auth_version integer;
ALTER TABLE briefing_reminders ADD COLUMN attempt_started_at timestamptz;
ALTER TABLE briefing_reminders ADD COLUMN receipt jsonb;
ALTER TABLE briefing_reminders ADD COLUMN error_code text;
