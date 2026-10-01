CREATE TABLE feedback_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),
  title text NOT NULL,description text NOT NULL,page_path text NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','triaged','resolved')),
  created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),request_key text NOT NULL,
  UNIQUE(created_by,request_key)
);
CREATE TABLE feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),feedback_id uuid NOT NULL REFERENCES feedback_items(id),
  actor_id uuid NOT NULL REFERENCES users(id),state text NOT NULL,note text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),request_key text NOT NULL,UNIQUE(actor_id,request_key)
);
CREATE TRIGGER immutable_feedback_text BEFORE UPDATE OF object_id,title,description,page_path,created_by ON feedback_items FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE TRIGGER immutable_feedback_events BEFORE UPDATE OR DELETE ON feedback_events FOR EACH ROW EXECUTE FUNCTION preserve_measurement();
CREATE INDEX feedback_scope_state ON feedback_items(object_id,state,created_at);
