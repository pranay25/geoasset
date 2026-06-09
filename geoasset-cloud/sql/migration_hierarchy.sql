-- ============================================================
-- GeoAsset Cloud — Migration: Hierarchy Expansion
-- Run this in Supabase SQL Editor AFTER the base schema
-- Adds: divisions table, links subdivisions to divisions
-- ============================================================

-- ── 1. Add divisions table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS divisions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT,
  city        TEXT,
  lat         DECIMAL(10,6),
  lng         DECIMAL(10,6),
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, name)
);

ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_rw" ON divisions;
CREATE POLICY "org_rw" ON divisions FOR ALL USING (org_id = my_org_id());

-- ── 2. Add division_id to subdivisions ───────────────────────
ALTER TABLE subdivisions ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES divisions(id);
ALTER TABLE subdivisions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- ── 3. Seed: create a default division from org.division ─────
-- This migrates existing data — creates one division per org
-- using the existing organisation.division text field
INSERT INTO divisions (org_id, name, code)
SELECT id, division, 'DIV-01'
FROM organisations
ON CONFLICT DO NOTHING;

-- Link existing subdivisions to that default division
UPDATE subdivisions s
SET division_id = d.id
FROM divisions d
WHERE s.org_id = d.org_id
AND s.division_id IS NULL;

-- ── 4. Grant execute on hierarchy RPC ────────────────────────
-- Updated setup_organisation to handle new hierarchy
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
  v_div_id  UUID;
  v_sub     JSONB;
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User already set up';
  END IF;

  -- 1. Create organisation
  INSERT INTO organisations (name, circle, division, city, state, lat, lng)
  VALUES (p_org_name, p_circle, p_division, p_city, p_state, p_lat, p_lng)
  RETURNING id INTO v_org_id;

  -- 2. Create default division
  INSERT INTO divisions (org_id, name, code, city)
  VALUES (v_org_id, p_division, 'DIV-01', p_city)
  RETURNING id INTO v_div_id;

  -- 3. Create subdivisions
  FOR v_sub IN SELECT * FROM jsonb_array_elements(p_subdivisions)
  LOOP
    INSERT INTO subdivisions (org_id, division_id, code, name)
    VALUES (v_org_id, v_div_id, v_sub->>'code', v_sub->>'name')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 4. Create admin profile
  INSERT INTO profiles (id, org_id, employee_id, name, mobile, role)
  VALUES (p_user_id, v_org_id, p_employee_id, p_user_name, p_mobile, 'admin');

  -- 5. Seed counters
  INSERT INTO counters (org_id, name, value) VALUES
    (v_org_id, 'asset', 0),
    (v_org_id, 'wo', 0),
    (v_org_id, 'mb', 0);

  RETURN jsonb_build_object('org_id', v_org_id, 'div_id', v_div_id, 'success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION setup_organisation TO authenticated;
