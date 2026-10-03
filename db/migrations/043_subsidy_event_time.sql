ALTER TABLE subsidy_events ADD COLUMN occurred_at timestamptz;
ALTER TABLE subsidy_events ADD COLUMN corrects_id uuid REFERENCES subsidy_events(id);
ALTER TABLE subsidy_events DROP CONSTRAINT subsidy_events_action_check;
ALTER TABLE subsidy_events ADD CONSTRAINT subsidy_events_action_check CHECK(action IN('review','submit','award','received','refund','reject','withdraw','correct'));
ALTER TABLE subsidy_events ADD CONSTRAINT subsidy_event_correction CHECK((action='correct')=(corrects_id IS NOT NULL) AND (action<>'correct' OR amount_cny IS NULL));
CREATE INDEX subsidy_correction_sequence ON subsidy_events(corrects_id,seq DESC) WHERE corrects_id IS NOT NULL;
