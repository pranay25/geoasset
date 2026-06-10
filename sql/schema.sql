-- ============================================================
-- GeoAsset Cloud — Schema v3 (Correct Hierarchy)
-- Circle → Division → Sub-Division → Sub-Station → Feeders → Assets
-- Run FULL file in Supabase SQL Editor after dropping all tables
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. organisations ─────────────────────────────────────────
CREATE TABLE organisations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  circle     TEXT,
  division   TEXT NOT NULL,
  city       TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'Rajasthan',
  lat        DECIMAL(10,6) DEFAULT 24.5963,
  lng        DECIMAL(10,6) DEFAULT 76.1690,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. divisions ─────────────────────────────────────────────
CREATE TABLE divisions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  code       TEXT,
  city       TEXT,
  lat        DECIMAL(10,6),
  lng        DECIMAL(10,6),
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, name)
);

-- ── 3. subdivisions ──────────────────────────────────────────
CREATE TABLE subdivisions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID REFERENCES organisations(id) ON DELETE CASCADE,
  division_id UUID REFERENCES divisions(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT true,
  UNIQUE(org_id, code)
);

-- ── 4. substations ───────────────────────────────────────────
CREATE TABLE substations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  subdivision_id  UUID REFERENCES subdivisions(id),
  name            TEXT NOT NULL,
  code            TEXT,
  voltage_ratio   TEXT DEFAULT '33/11kV',
  capacity_mva    DECIMAL(8,3),
  num_feeders     INTEGER DEFAULT 0,
  num_consumers   INTEGER DEFAULT 0,
  present_load_mva DECIMAL(8,3),
  switchgear_type TEXT,
  num_vcb         INTEGER DEFAULT 0,
  num_pcb         INTEGER DEFAULT 0,
  village         TEXT,
  tehsil          TEXT,
  jen_office      TEXT,
  district        TEXT,
  latitude        DECIMAL(10,6),
  longitude       DECIMAL(10,6),
  survey_accuracy_m DECIMAL(6,2),
  remarks         TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. profiles ──────────────────────────────────────────────
CREATE TABLE profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id         UUID REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id    TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  mobile         TEXT,
  role           TEXT NOT NULL CHECK (role IN ('admin','sdo','ao','je','feeder_incharge')),
  subdivision_id UUID REFERENCES subdivisions(id),
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. feeders ───────────────────────────────────────────────
CREATE TABLE feeders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID REFERENCES organisations(id) ON DELETE CASCADE,
  substation_id       UUID REFERENCES substations(id) ON DELETE SET NULL,
  subdivision_id      UUID REFERENCES subdivisions(id),
  code                TEXT NOT NULL,
  name                TEXT NOT NULL,
  voltage_kv          DECIMAL(5,2) DEFAULT 11,
  sanctioned_load_kva INTEGER DEFAULT 0,
  ht_length_km        DECIMAL(8,3) DEFAULT 0,
  lt_length_km        DECIMAL(8,3) DEFAULT 0,
  remarks             TEXT,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, code)
);

-- ── 7. assets ────────────────────────────────────────────────
CREATE TABLE assets (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             UUID REFERENCES organisations(id) ON DELETE CASCADE,
  feeder_id          UUID REFERENCES feeders(id),
  asset_code         TEXT,
  asset_type         TEXT NOT NULL CHECK (asset_type IN
    ('pole','dtr','meter','line','pillar','iso','linedp')),
  name               TEXT NOT NULL,
  latitude           DECIMAL(10,6) NOT NULL,
  longitude          DECIMAL(10,6) NOT NULL,
  survey_accuracy_m  DECIMAL(6,2),
  status             TEXT DEFAULT 'ok' CHECK (status IN ('ok','flag','fault')),
  flag_note          TEXT,
  surveyed_by_id     UUID REFERENCES profiles(id),
  survey_date        DATE DEFAULT CURRENT_DATE,
  details            JSONB DEFAULT '{}',
  outstanding_amount DECIMAL(12,2) DEFAULT 0,
  last_payment_date  DATE,
  mobile             TEXT,
  remarks            TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assets_org    ON assets(org_id);
CREATE INDEX idx_assets_feeder ON assets(feeder_id);
CREATE INDEX idx_assets_type   ON assets(asset_type);
CREATE INDEX idx_assets_out    ON assets(outstanding_amount) WHERE outstanding_amount > 0;

-- ── 8. work_orders ───────────────────────────────────────────
CREATE TABLE work_orders (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID REFERENCES organisations(id) ON DELETE CASCADE,
  wo_number      TEXT UNIQUE NOT NULL,
  title          TEXT NOT NULL,
  issue_type     TEXT,
  priority       TEXT DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')),
  status         TEXT DEFAULT 'open'   CHECK (status IN ('open','assigned','closed')),
  feeder_id      UUID REFERENCES feeders(id),
  assigned_to_id UUID REFERENCES profiles(id),
  created_by_id  UUID REFERENCES profiles(id),
  due_date       DATE,
  close_date     DATE,
  remarks        TEXT,
  spans          JSONB DEFAULT '[]',
  asset_ids      UUID[] DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 9. measurement_books ─────────────────────────────────────
CREATE TABLE measurement_books (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  mb_number       TEXT UNIQUE NOT NULL,
  wo_id           UUID REFERENCES work_orders(id),
  title           TEXT NOT NULL,
  contractor_name TEXT,
  feeder_id       UUID REFERENCES feeders(id),
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  mb_date         DATE DEFAULT CURRENT_DATE,
  prepared_by_id  UUID REFERENCES profiles(id),
  approved_by_id  UUID REFERENCES profiles(id),
  total_amount    DECIMAL(14,2) DEFAULT 0,
  items           JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 10. outstanding_groups ────────────────────────────────────
CREATE TABLE outstanding_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  color           TEXT DEFAULT '#ef4444',
  min_outstanding DECIMAL(12,2) DEFAULT 0,
  meter_ids       UUID[] DEFAULT '{}',
  created_by_id   UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 11. shutdowns ─────────────────────────────────────────────
CREATE TABLE shutdowns (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID REFERENCES organisations(id) ON DELETE CASCADE,
  substation_id     UUID REFERENCES substations(id) ON DELETE SET NULL,
  substation_name   TEXT NOT NULL,
  shutdown_type     TEXT DEFAULT 'planned' CHECK (shutdown_type IN ('planned','emergency','maintenance')),
  status            TEXT DEFAULT 'active'  CHECK (status IN ('active','restored')),
  reason            TEXT NOT NULL,
  affected_feeders  UUID[] DEFAULT '{}',
  start_time        TIMESTAMPTZ DEFAULT NOW(),
  estimated_restore TIMESTAMPTZ,
  actual_restore    TIMESTAMPTZ,
  restore_note      TEXT,
  posted_by_id      UUID REFERENCES profiles(id),
  acknowledged_by   UUID[] DEFAULT '{}',
  substation_lat    DECIMAL(10,6),
  substation_lng    DECIMAL(10,6),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 12. patrol_reports ────────────────────────────────────────
CREATE TABLE patrol_reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  report_number   TEXT UNIQUE NOT NULL,
  feeder_id       UUID REFERENCES feeders(id),
  patrolled_by_id UUID REFERENCES profiles(id),
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','completed')),
  start_time      TIMESTAMPTZ DEFAULT NOW(),
  end_time        TIMESTAMPTZ,
  total_assets    INTEGER DEFAULT 0,
  total_issues    INTEGER DEFAULT 0,
  remarks         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE patrol_observations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  patrol_id       UUID REFERENCES patrol_reports(id) ON DELETE CASCADE,
  asset_id        UUID REFERENCES assets(id) ON DELETE SET NULL,
  asset_code      TEXT,
  asset_type      TEXT,
  asset_name      TEXT,
  issue_type      TEXT NOT NULL,
  severity        TEXT DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  description     TEXT,
  patrol_lat      DECIMAL(10,6),
  patrol_lng      DECIMAL(10,6),
  patrol_accuracy DECIMAL(6,2),
  is_flagged      BOOLEAN DEFAULT true,
  seq_number      INTEGER,
  observed_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 13. audit_log ────────────────────────────────────────────
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID REFERENCES organisations(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES profiles(id),
  action      TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('survey','asset','wo','mb','user','hierarchy','auth','system')),
  severity    TEXT DEFAULT 'info' CHECK (severity IN ('info','warn','critical')),
  description TEXT NOT NULL,
  meta        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 14. counters ─────────────────────────────────────────────
CREATE TABLE counters (
  org_id  UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  value   INTEGER DEFAULT 0,
  PRIMARY KEY (org_id, name)
);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE organisations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE divisions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE subdivisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE substations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_books  ENABLE ROW LEVEL SECURITY;
ALTER TABLE outstanding_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE shutdowns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_reports     ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters           ENABLE ROW LEVEL SECURITY;

-- Helper functions
CREATE OR REPLACE FUNCTION my_org_id() RETURNS UUID AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- RLS Policies
CREATE POLICY "org_rw" ON organisations      FOR ALL USING (id = my_org_id());
CREATE POLICY "org_rw" ON divisions          FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON subdivisions       FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON substations        FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON profiles           FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON feeders            FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON assets             FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON work_orders        FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON measurement_books  FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON outstanding_groups FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON shutdowns          FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON patrol_reports     FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON patrol_observations FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON audit_log          FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON counters           FOR ALL USING (org_id = my_org_id());

-- Setup policies
CREATE POLICY "allow_setup_org"     ON organisations FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_setup_profile" ON profiles      FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_setup_subdiv"  ON subdivisions  FOR INSERT WITH CHECK (true);
CREATE POLICY "public_read_shutdowns" ON shutdowns   FOR SELECT USING (true);

-- ── Setup function ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION setup_organisation(
  p_org_name     TEXT, p_circle       TEXT,
  p_division     TEXT, p_city         TEXT,
  p_state        TEXT, p_lat          DECIMAL,
  p_lng          DECIMAL, p_subdivisions JSONB,
  p_user_id      UUID, p_employee_id  TEXT,
  p_user_name    TEXT, p_mobile       TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id UUID; v_div_id UUID; v_sub JSONB;
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User already set up';
  END IF;
  INSERT INTO organisations (name,circle,division,city,state,lat,lng)
  VALUES (p_org_name,p_circle,p_division,p_city,p_state,p_lat,p_lng)
  RETURNING id INTO v_org_id;
  INSERT INTO divisions (org_id,name,code,city)
  VALUES (v_org_id,p_division,'DIV-01',p_city)
  RETURNING id INTO v_div_id;
  FOR v_sub IN SELECT * FROM jsonb_array_elements(p_subdivisions) LOOP
    INSERT INTO subdivisions (org_id,division_id,code,name)
    VALUES (v_org_id,v_div_id,v_sub->>'code',v_sub->>'name')
    ON CONFLICT DO NOTHING;
  END LOOP;
  INSERT INTO profiles (id,org_id,employee_id,name,mobile,role)
  VALUES (p_user_id,v_org_id,p_employee_id,p_user_name,p_mobile,'admin');
  INSERT INTO counters (org_id,name,value) VALUES
    (v_org_id,'asset',0),(v_org_id,'wo',0),(v_org_id,'mb',0),
    (v_org_id,'patrol',0),(v_org_id,'substation',0);
  RETURN jsonb_build_object('org_id',v_org_id,'div_id',v_div_id,'success',true);
END; $$;

-- ── Counter function ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION next_counter(p_org_id UUID, p_name TEXT)
RETURNS INTEGER AS $$
DECLARE v INTEGER;
BEGIN
  INSERT INTO counters (org_id,name,value) VALUES (p_org_id,p_name,1)
  ON CONFLICT (org_id,name) DO UPDATE SET value = counters.value + 1
  RETURNING value INTO v;
  RETURN v;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Read-only SQL executor (admin SQL editor) ─────────────────
CREATE OR REPLACE FUNCTION exec_readonly_sql(query TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result JSONB; trimmed TEXT;
BEGIN
  trimmed := upper(trim(query));
  IF NOT (trimmed LIKE 'SELECT%' OR trimmed LIKE 'WITH%') THEN
    RAISE EXCEPTION 'Only SELECT queries are permitted';
  END IF;
  IF trimmed ~* '(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXECUTE|DO\s)' THEN
    RAISE EXCEPTION 'Write operations are not permitted';
  END IF;
  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || query || ') t' INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END; $$;

-- ── Public shutdown board ─────────────────────────────────────
CREATE OR REPLACE FUNCTION get_nearby_shutdowns(
  user_lat DECIMAL, user_lng DECIMAL, radius_km DECIMAL DEFAULT 15
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(t)) INTO result FROM (
    SELECT s.id, s.substation_name, s.shutdown_type, s.status,
      s.reason, s.start_time, s.estimated_restore, s.actual_restore,
      s.restore_note, s.affected_feeders, s.substation_lat, s.substation_lng,
      ROUND((6371 * 2 * ASIN(SQRT(
        POWER(SIN(RADIANS((s.substation_lat - user_lat)/2)),2) +
        COS(RADIANS(user_lat))*COS(RADIANS(s.substation_lat))*
        POWER(SIN(RADIANS((s.substation_lng - user_lng)/2)),2)
      )))::NUMERIC,2) AS distance_km,
      o.name AS org_name, o.division, o.city,
      p.name AS posted_by
    FROM shutdowns s
    JOIN organisations o ON s.org_id = o.id
    LEFT JOIN profiles p ON s.posted_by_id = p.id
    WHERE s.substation_lat IS NOT NULL
      AND (6371*2*ASIN(SQRT(
        POWER(SIN(RADIANS((s.substation_lat-user_lat)/2)),2)+
        COS(RADIANS(user_lat))*COS(RADIANS(s.substation_lat))*
        POWER(SIN(RADIANS((s.substation_lng-user_lng)/2)),2)
      ))) <= radius_km
    ORDER BY s.status ASC, distance_km ASC
  ) t;
  RETURN COALESCE(result,'[]'::jsonb);
END; $$;

GRANT EXECUTE ON FUNCTION setup_organisation     TO authenticated;
GRANT EXECUTE ON FUNCTION next_counter           TO authenticated;
GRANT EXECUTE ON FUNCTION exec_readonly_sql      TO authenticated;
GRANT EXECUTE ON FUNCTION get_nearby_shutdowns   TO anon;
GRANT EXECUTE ON FUNCTION get_nearby_shutdowns   TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE shutdowns;
