CREATE TABLE briefing_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),author_id uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,
 hour integer NOT NULL CHECK(hour BETWEEN 0 AND 23),minute integer NOT NULL CHECK(minute BETWEEN 0 AND 59),
 enabled boolean NOT NULL DEFAULT false,evidence text NOT NULL,last_day date,substitute_id uuid REFERENCES users(id),created_by uuid NOT NULL REFERENCES users(id),
 UNIQUE(object_id)
);
