-- Complete A02's legacy-reference audit; never fabricate missing business objects.
ALTER TABLE grants VALIDATE CONSTRAINT grants_object_fk;
ALTER TABLE integration_tokens VALIDATE CONSTRAINT integration_object_fk;
CREATE INDEX jobs_expired_lease ON jobs(lease_until) WHERE state='running';
CREATE INDEX active_rules_point ON rule_bindings(point_id,object_id) WHERE enabled;
CREATE INDEX notification_alert_phase ON notification_intents(alert_id,roster_id,phase,level,created_at);
CREATE INDEX audit_work_order_request ON audit_events(actor_id,(details->>'requestKey')) WHERE event_type='work_order_updated';
