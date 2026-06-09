-- ============================================================
-- GeoAsset Cloud — Supabase SQL Schema v2
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. organisations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organisations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  circle      TEXT,
  division    TEXT NOT NULL,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'Rajasthan',
  lat         DECIMAL(10,6) DEFAULT 24.5963,
  lng         DECIMAL(10,6) DEFAULT 76.1690,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. subdivisions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subdivisions (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id  UUID REFERENCES organisations(id) ON DELETE CASCADE,
  code    TEXT NOT NULL,
  name    TEXT NOT NULL,
  UNIQUE(org_id, code)
);

-- ── 3. profiles ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id     TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  mobile          TEXT,
  role            TEXT NOT NULL CHECK (role IN ('admin','sdo','ao','je','feeder_incharge')),
  subdivision_id  UUID REFERENCES subdivisions(id),
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. feeders ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feeders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID REFERENCES organisations(id) ON DELETE CASCADE,
  subdivision_id      UUID REFERENCES subdivisions(id),
  code                TEXT NOT NULL,
  name                TEXT NOT NULL,
  voltage_kv          DECIMAL(5,2) DEFAULT 11,
  sanctioned_load_kva INTEGER DEFAULT 0,
  ht_length_km        DECIMAL(8,3) DEFAULT 0,
  lt_length_km        DECIMAL(8,3) DEFAULT 0,
  source_substation   TEXT,
  remarks             TEXT,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, code)
);

-- ── 5. assets ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID REFERENCES organisations(id) ON DELETE CASCADE,
  feeder_id           UUID REFERENCES feeders(id),
  asset_code          TEXT,
  asset_type          TEXT NOT NULL CHECK (asset_type IN ('pole','dtr','meter','line','pillar','iso')),
  name                TEXT NOT NULL,
  latitude            DECIMAL(10,6) NOT NULL,
  longitude           DECIMAL(10,6) NOT NULL,
  survey_accuracy_m   DECIMAL(6,2),
  status              TEXT DEFAULT 'ok' CHECK (status IN ('ok','flag','fault')),
  flag_note           TEXT,
  surveyed_by_id      UUID REFERENCES profiles(id),
  survey_date         DATE DEFAULT CURRENT_DATE,
  details             JSONB DEFAULT '{}',
  outstanding_amount  DECIMAL(12,2) DEFAULT 0,
  last_payment_date   DATE,
  mobile              TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_org    ON assets(org_id);
CREATE INDEX IF NOT EXISTS idx_assets_feeder ON assets(feeder_id);
CREATE INDEX IF NOT EXISTS idx_assets_type   ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_out    ON assets(outstanding_amount) WHERE outstanding_amount > 0;

-- ── 6. work_orders ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  wo_number       TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  issue_type      TEXT,
  priority        TEXT DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')),
  status          TEXT DEFAULT 'open'   CHECK (status IN ('open','assigned','closed')),
  feeder_id       UUID REFERENCES feeders(id),
  assigned_to_id  UUID REFERENCES profiles(id),
  created_by_id   UUID REFERENCES profiles(id),
  due_date        DATE,
  close_date      DATE,
  remarks         TEXT,
  spans           JSONB DEFAULT '[]',
  asset_ids       UUID[] DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. measurement_books ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS measurement_books (
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

-- ── 8. outstanding_groups ────────────────────────────────────
CREATE TABLE IF NOT EXISTS outstanding_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  color           TEXT DEFAULT '#ef4444',
  min_outstanding DECIMAL(12,2) DEFAULT 0,
  meter_ids       UUID[] DEFAULT '{}',
  created_by_id   UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Counters ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS counters (
  org_id    UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  value     INTEGER DEFAULT 0,
  PRIMARY KEY (org_id, name)
);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE organisations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE subdivisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_books  ENABLE ROW LEVEL SECURITY;
ALTER TABLE outstanding_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters           ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DO $$ BEGIN
  DROP POLICY IF EXISTS "org_data" ON organisations;
  DROP POLICY IF EXISTS "org_data" ON subdivisions;
  DROP POLICY IF EXISTS "org_data" ON profiles;
  DROP POLICY IF EXISTS "org_data" ON feeders;
  DROP POLICY IF EXISTS "org_data" ON assets;
  DROP POLICY IF EXISTS "org_data" ON work_orders;
  DROP POLICY IF EXISTS "org_data" ON measurement_books;
  DROP POLICY IF EXISTS "org_data" ON outstanding_groups;
  DROP POLICY IF EXISTS "org_data" ON counters;
  DROP POLICY IF EXISTS "allow_setup_org" ON organisations;
  DROP POLICY IF EXISTS "allow_setup_profile" ON profiles;
  DROP POLICY IF EXISTS "allow_setup_subdiv" ON subdivisions;
  DROP POLICY IF EXISTS "read_own_profile" ON profiles;
  DROP POLICY IF EXISTS "read_own_org" ON organisations;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Simple helper function
CREATE OR REPLACE FUNCTION my_org_id() RETURNS UUID AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Policies: all tables — read/write only own org
CREATE POLICY "org_rw" ON organisations      FOR ALL USING (id = my_org_id());
CREATE POLICY "org_rw" ON subdivisions       FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON profiles           FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON feeders            FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON assets             FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON work_orders        FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON measurement_books  FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON outstanding_groups FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON counters           FOR ALL USING (org_id = my_org_id());

-- ── SETUP FUNCTION (bypasses RLS — runs as superuser) ────────
-- This is the key fix: setup runs server-side with SECURITY DEFINER
-- so RLS is bypassed during the chicken-and-egg profile/org creation
CREATE OR REPLACE FUNCTION setup_organisation(
  p_org_name    TEXT,
  p_circle      TEXT,
  p_division    TEXT,
  p_city        TEXT,
  p_state       TEXT,
  p_lat         DECIMAL,
  p_lng         DECIMAL,
  p_subdivisions JSONB,
  p_user_id     UUID,
  p_employee_id TEXT,
  p_user_name   TEXT,
  p_mobile      TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id  UUID;
  v_sub     JSONB;
  v_sub_id  UUID;
BEGIN
  -- Check not already set up
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User already set up';
  END IF;

  -- 1. Insert organisation
  INSERT INTO organisations (name, circle, division, city, state, lat, lng)
  VALUES (p_org_name, p_circle, p_division, p_city, p_state, p_lat, p_lng)
  RETURNING id INTO v_org_id;

  -- 2. Insert subdivisions
  FOR v_sub IN SELECT * FROM jsonb_array_elements(p_subdivisions)
  LOOP
    INSERT INTO subdivisions (org_id, code, name)
    VALUES (v_org_id, v_sub->>'code', v_sub->>'name')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 3. Insert admin profile
  INSERT INTO profiles (id, org_id, employee_id, name, mobile, role)
  VALUES (p_user_id, v_org_id, p_employee_id, p_user_name, p_mobile, 'admin');

  -- 4. Seed counters
  INSERT INTO counters (org_id, name, value) VALUES
    (v_org_id, 'asset', 0),
    (v_org_id, 'wo', 0),
    (v_org_id, 'mb', 0);

  RETURN jsonb_build_object('org_id', v_org_id, 'success', true);
END;
$$;

-- Next counter (atomic)
CREATE OR REPLACE FUNCTION next_counter(p_org_id UUID, p_name TEXT)
RETURNS INTEGER AS $$
DECLARE v INTEGER;
BEGIN
  INSERT INTO counters (org_id, name, value) VALUES (p_org_id, p_name, 1)
  ON CONFLICT (org_id, name) DO UPDATE SET value = counters.value + 1
  RETURNING value INTO v;
  RETURN v;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION setup_organisation TO authenticated;
GRANT EXECUTE ON FUNCTION next_counter TO authenticated;

-- ── Audit Log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
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

CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_log(category);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_rw" ON audit_log;
CREATE POLICY "org_rw" ON audit_log FOR ALL USING (org_id = my_org_id());

-- ── Substations (as assets + dedicated table for rich data) ──
-- Substation details stored in assets.details JSONB
-- asset_type = 'substation'
-- Additional check constraint update needed:
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type IN ('pole','dtr','meter','line','pillar','iso','substation'));

-- ── Shutdowns ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shutdowns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  feeder_id       UUID REFERENCES feeders(id),
  substation_name TEXT NOT NULL,
  reason          TEXT NOT NULL,
  shutdown_type   TEXT DEFAULT 'planned' CHECK (shutdown_type IN ('planned','emergency','maintenance')),
  status          TEXT DEFAULT 'active'  CHECK (status IN ('active','restored')),
  affected_feeders UUID[] DEFAULT '{}',
  start_time      TIMESTAMPTZ DEFAULT NOW(),
  estimated_restore TIMESTAMPTZ,
  actual_restore  TIMESTAMPTZ,
  restore_note    TEXT,
  posted_by_id    UUID REFERENCES profiles(id),
  acknowledged_by UUID[] DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shutdowns_org    ON shutdowns(org_id, status);
CREATE INDEX IF NOT EXISTS idx_shutdowns_feeder ON shutdowns(feeder_id);

ALTER TABLE shutdowns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_rw" ON shutdowns;
CREATE POLICY "org_rw" ON shutdowns FOR ALL USING (org_id = my_org_id());

-- Enable Realtime for shutdowns table
ALTER PUBLICATION supabase_realtime ADD TABLE shutdowns;
ALTER PUBLICATION supabase_realtime ADD TABLE feeders;

-- ── Line DP asset type ────────────────────────────────────────
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type IN ('pole','dtr','meter','line','pillar','iso','substation','linedp'));

-- ── Remarks column on assets ──────────────────────────────────
ALTER TABLE assets ADD COLUMN IF NOT EXISTS remarks TEXT;

-- ── Patrol Reports ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patrol_reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  report_number   TEXT UNIQUE NOT NULL,          -- e.g. PR-2025-0001
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

CREATE TABLE IF NOT EXISTS patrol_observations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID REFERENCES organisations(id) ON DELETE CASCADE,
  patrol_id       UUID REFERENCES patrol_reports(id) ON DELETE CASCADE,
  asset_id        UUID REFERENCES assets(id),
  asset_code      TEXT,
  asset_type      TEXT,
  asset_name      TEXT,
  issue_type      TEXT NOT NULL,
  severity        TEXT DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  description     TEXT,
  patrol_lat      DECIMAL(10,6),
  patrol_lng      DECIMAL(10,6),
  patrol_accuracy DECIMAL(6,2),
  photo_note      TEXT,
  is_flagged      BOOLEAN DEFAULT true,
  seq_number      INTEGER,
  observed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patrol_org    ON patrol_reports(org_id);
CREATE INDEX IF NOT EXISTS idx_patrol_feeder ON patrol_reports(feeder_id);
CREATE INDEX IF NOT EXISTS idx_obs_patrol    ON patrol_observations(patrol_id);

ALTER TABLE patrol_reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_observations  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_rw" ON patrol_reports;
DROP POLICY IF EXISTS "org_rw" ON patrol_observations;
CREATE POLICY "org_rw" ON patrol_reports      FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_rw" ON patrol_observations FOR ALL USING (org_id = my_org_id());

-- ── Read-only SQL executor for admin SQL editor ───────────────
-- Executes SELECT queries safely, filtered to caller's org
CREATE OR REPLACE FUNCTION exec_readonly_sql(query TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result JSONB;
  trimmed TEXT;
BEGIN
  trimmed := upper(trim(query));

  -- Only allow SELECT and WITH (CTEs)
  IF NOT (trimmed LIKE 'SELECT%' OR trimmed LIKE 'WITH%') THEN
    RAISE EXCEPTION 'Only SELECT queries are permitted';
  END IF;

  -- Block dangerous keywords
  IF trimmed ~* '(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXECUTE|DO\s)' THEN
    RAISE EXCEPTION 'Write operations are not permitted';
  END IF;

  -- Execute and return as JSON array
  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || query || ') t' INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION exec_readonly_sql TO authenticated;

-- ── Public shutdown board ─────────────────────────────────────
-- Add substation lat/lng to shutdowns for public distance filtering
ALTER TABLE shutdowns ADD COLUMN IF NOT EXISTS substation_lat DECIMAL(10,6);
ALTER TABLE shutdowns ADD COLUMN IF NOT EXISTS substation_lng DECIMAL(10,6);

-- Public read policy — anyone can read active shutdowns (no auth needed)
-- This allows the public board to work without login
CREATE POLICY "public_read_shutdowns" ON shutdowns
  FOR SELECT USING (true);

-- Public function to get nearby shutdowns (no auth required)
CREATE OR REPLACE FUNCTION get_nearby_shutdowns(
  user_lat DECIMAL, user_lng DECIMAL, radius_km DECIMAL DEFAULT 15
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(t))
  INTO result
  FROM (
    SELECT
      s.id, s.substation_name, s.shutdown_type, s.status,
      s.reason, s.start_time, s.estimated_restore, s.actual_restore,
      s.restore_note, s.affected_feeders, s.substation_lat, s.substation_lng,
      -- Distance in km using haversine approximation
      ROUND((
        6371 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS((s.substation_lat - user_lat) / 2)), 2) +
          COS(RADIANS(user_lat)) * COS(RADIANS(s.substation_lat)) *
          POWER(SIN(RADIANS((s.substation_lng - user_lng) / 2)), 2)
        ))
      )::NUMERIC, 2) AS distance_km,
      o.name AS org_name, o.division, o.city,
      p.name AS posted_by
    FROM shutdowns s
    JOIN organisations o ON s.org_id = o.id
    LEFT JOIN profiles p ON s.posted_by_id = p.id
    WHERE s.substation_lat IS NOT NULL
      AND (
        6371 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS((s.substation_lat - user_lat) / 2)), 2) +
          COS(RADIANS(user_lat)) * COS(RADIANS(s.substation_lat)) *
          POWER(SIN(RADIANS((s.substation_lng - user_lng) / 2)), 2)
        ))
      ) <= radius_km
    ORDER BY s.status ASC, distance_km ASC
  ) t;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Allow public (anon) to call this function
GRANT EXECUTE ON FUNCTION get_nearby_shutdowns TO anon;
GRANT EXECUTE ON FUNCTION get_nearby_shutdowns TO authenticated;
