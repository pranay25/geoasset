-- ============================================================
-- GeoAsset Cloud — Supabase SQL Schema
-- Run this entire file in Supabase SQL Editor (one shot)
-- ============================================================

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. organisations ─────────────────────────────────────────
CREATE TABLE organisations (
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
CREATE TABLE subdivisions (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id  UUID REFERENCES organisations(id) ON DELETE CASCADE,
  code    TEXT NOT NULL,
  name    TEXT NOT NULL,
  UNIQUE(org_id, code)
);

-- ── 3. users (extends Supabase auth.users) ───────────────────
CREATE TABLE profiles (
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
CREATE TABLE feeders (
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
CREATE TABLE assets (
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

CREATE INDEX idx_assets_org    ON assets(org_id);
CREATE INDEX idx_assets_feeder ON assets(feeder_id);
CREATE INDEX idx_assets_type   ON assets(asset_type);
CREATE INDEX idx_assets_out    ON assets(outstanding_amount) WHERE outstanding_amount > 0;

-- ── 6. work_orders ───────────────────────────────────────────
CREATE TABLE work_orders (
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

-- ── 8. outstanding_groups ────────────────────────────────────
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

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE organisations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE subdivisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_books  ENABLE ROW LEVEL SECURITY;
ALTER TABLE outstanding_groups ENABLE ROW LEVEL SECURITY;

-- Helper: get caller's org_id from profiles
CREATE OR REPLACE FUNCTION my_org_id() RETURNS UUID AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION my_role() RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Policies: users can read/write their own org's data only
CREATE POLICY "org_data" ON organisations      FOR ALL USING (id = my_org_id());
CREATE POLICY "org_data" ON subdivisions       FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_data" ON profiles           FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_data" ON feeders            FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_data" ON assets             FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_data" ON work_orders        FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_data" ON measurement_books  FOR ALL USING (org_id = my_org_id());
CREATE POLICY "org_data" ON outstanding_groups FOR ALL USING (org_id = my_org_id());

-- Allow setup: insert org/profile even before email confirmed
CREATE POLICY "allow_setup_org"     ON organisations FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_setup_profile" ON profiles      FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_setup_subdiv"  ON subdivisions  FOR INSERT WITH CHECK (true);

-- Allow reading own profile always (needed right after signup)
CREATE POLICY "read_own_profile" ON profiles FOR SELECT USING (id = auth.uid());

-- Allow reading org if you have a profile in it
CREATE POLICY "read_own_org" ON organisations FOR SELECT
  USING (id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- ── Sequence counters (for WO/MB/Asset numbering) ────────────
CREATE TABLE counters (
  org_id    UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  value     INTEGER DEFAULT 0,
  PRIMARY KEY (org_id, name)
);
ALTER TABLE counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_data" ON counters FOR ALL USING (org_id = my_org_id());

-- Function to get next number atomically
CREATE OR REPLACE FUNCTION next_counter(p_org_id UUID, p_name TEXT) RETURNS INTEGER AS $$
DECLARE v INTEGER;
BEGIN
  INSERT INTO counters (org_id, name, value) VALUES (p_org_id, p_name, 1)
  ON CONFLICT (org_id, name) DO UPDATE SET value = counters.value + 1
  RETURNING value INTO v;
  RETURN v;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
