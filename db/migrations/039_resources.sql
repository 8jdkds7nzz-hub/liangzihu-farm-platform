CREATE TABLE energy_meters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),device_id uuid NOT NULL REFERENCES devices(id),
 name text NOT NULL,purpose text NOT NULL CHECK(purpose IN('generation','load','storage')),capacity_kwh numeric(20,6) CHECK(capacity_kwh>0),
 max_gap_seconds integer NOT NULL CHECK(max_gap_seconds BETWEEN 1 AND 604800),oxygen_point_id uuid REFERENCES points(id),source_ref text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),supersedes_id uuid UNIQUE REFERENCES energy_meters(id),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(device_id,purpose,version)
);
CREATE TABLE energy_meter_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),seq bigint GENERATED ALWAYS AS IDENTITY,meter_id uuid NOT NULL REFERENCES energy_meters(id),object_id uuid NOT NULL REFERENCES objects(id),
 action text NOT NULL CHECK(action IN('approve','withdraw')),evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE energy_readings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),meter_id uuid NOT NULL REFERENCES energy_meters(id),
 metric text NOT NULL CHECK(metric IN('generation_kwh','consumption_kwh','charge_kwh','discharge_kwh','power_kw','soc_pct','soh_pct')),
 value numeric(20,6) CHECK(value>=0),observed_at timestamptz NOT NULL,quality text NOT NULL CHECK(quality IN('valid','suspect','missing')),
 reset boolean NOT NULL DEFAULT false,source_kind text NOT NULL CHECK(source_kind IN('manual','file')),evidence text NOT NULL,
 operating_state text NOT NULL CHECK(operating_state IN('charging','discharging','idle','unknown')),alarm_note text,
 version integer NOT NULL CHECK(version>0),supersedes_id uuid UNIQUE REFERENCES energy_readings(id),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(meter_id,metric,observed_at,version),
 CHECK(quality<>'valid' OR value IS NOT NULL),CHECK(metric NOT IN('soc_pct','soh_pct') OR value<=100)
);
CREATE INDEX energy_reading_window ON energy_readings(meter_id,metric,observed_at);
CREATE TABLE circular_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),lot_id uuid NOT NULL UNIQUE REFERENCES stock_lots(id),
 material_kind text NOT NULL CHECK(material_kind IN('silt','manure','straw','mushroom','compost','other')),origin_ref text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE circular_weighings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),lot_id uuid NOT NULL REFERENCES stock_lots(id),document_id uuid NOT NULL UNIQUE REFERENCES stock_documents(id),
 gross_kg numeric(20,6) NOT NULL CHECK(gross_kg>0),tare_kg numeric(20,6) NOT NULL CHECK(tare_kg>=0),net_kg numeric(20,6) NOT NULL CHECK(net_kg>0),
 moisture_pct numeric(9,6) CHECK(moisture_pct BETWEEN 0 AND 100),dry_kg numeric(20,6),basis text NOT NULL CHECK(basis IN('wet','dry','as_is')),
 voucher text NOT NULL,occurred_at timestamptz NOT NULL,evidence text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(gross_kg-tare_kg=net_kg),UNIQUE(object_id,voucher)
);
CREATE TABLE circular_processes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),object_id uuid NOT NULL REFERENCES objects(id),document_id uuid NOT NULL UNIQUE REFERENCES stock_documents(id),
 process_kind text NOT NULL CHECK(process_kind IN('treatment','screening','rework')),evidence text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['energy_meters','energy_meter_reviews','energy_readings','circular_batches','circular_weighings','circular_processes']
 LOOP EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION preserve_measurement()',t,t); END LOOP;
END $$;
