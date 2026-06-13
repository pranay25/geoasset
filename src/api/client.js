import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = 'https://elrdndstgsosbjgrxeqt.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVscmRuZHN0Z3Nvc2JqZ3J4ZXF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MDE1MzIsImV4cCI6MjA5NjQ3NzUzMn0.7B-E9SbUuZGLltLbt4CMuZrNLuI_v2MD_SnvgOgf6rE'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

// ── Auth ──────────────────────────────────────────────────────
export const authApi = {
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.includes('Email not confirmed'))
        throw new Error('Email not confirmed — go to Supabase → Auth → Providers → Email → disable "Confirm email"')
      if (error.message.includes('Invalid login credentials'))
        throw new Error('Wrong email or password')
      throw new Error(error.message)
    }
    return data
  },
  async logout() {
    await supabase.auth.signOut()
  },
  async getSession() {
    const { data } = await supabase.auth.getSession()
    return data.session
  },
  async getProfile(userId) {
    // Fetch profile — RLS allows this via read_own_profile policy (id = auth.uid())
    const { data: profile, error } = await supabase
      .from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!profile) {
      // Profile missing — could be RLS or genuinely missing
      // Try with explicit user id match
      const { data: retry } = await supabase
        .from('profiles').select('*').filter('id', 'eq', userId).limit(1)
      const p = Array.isArray(retry) ? retry[0] : null
      if (!p) throw new Error('Profile not found — contact admin')
      return getProfileWithOrg(p)
    }
    return getProfileWithOrg(profile)

    async function getProfileWithOrg(p) {
      const { data: orgArr } = await supabase
        .from('organisations').select('*').eq('id', p.org_id).limit(1)
      const org = Array.isArray(orgArr) ? orgArr[0] : orgArr

      let subdiv = null
      if (p.subdivision_id) {
        const { data: sdArr } = await supabase
          .from('subdivisions').select('code,name').eq('id', p.subdivision_id).limit(1)
        subdiv = Array.isArray(sdArr) ? sdArr[0] : sdArr
      }
      return { ...p, organisations: org || null, subdivisions: subdiv }
    }
  },
  async setup({ org, adminUser }) {
    // Step 1: Sign up
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: adminUser.email,
      password: adminUser.password,
    })

    // 422 = email already exists — try signing in directly instead
    let userId
    if (authErr && (authErr.status === 422 || authErr.message?.includes('already'))) {
      const { data: existing, error: existErr } = await supabase.auth.signInWithPassword({
        email: adminUser.email, password: adminUser.password,
      })
      if (existErr) throw new Error('Email already registered with a different password. Delete the user in Supabase Auth and try again.')
      userId = existing.user?.id
      if (!userId) throw new Error('Could not retrieve user ID')
      // Check if profile already exists
      const { data: existingProfile } = await supabase.from('profiles').select('id').eq('id', userId).single()
      if (existingProfile) throw new Error('This account is already set up. Please login instead.')
    } else {
      if (authErr) throw new Error(authErr.message)
      if (!authData?.user) throw new Error('Signup failed — no user returned')
      userId = authData.user.id

      // Sign in to get session
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: adminUser.email, password: adminUser.password,
      })
      if (signInErr || !signInData?.session) {
        throw new Error('Login after signup failed. Go to Supabase → Authentication → Providers → Email → turn OFF "Confirm email" → then try again.')
      }
    }

    // Step 2: Call setup RPC — creates org, divisions, subdivisions, profile, counters
    const { data: result, error: rpcErr } = await supabase.rpc('setup_organisation', {
      p_org_name:     org.name,
      p_circle:       org.circle || '',
      p_division:     org.division,
      p_city:         org.city,
      p_state:        org.state || 'Rajasthan',
      p_lat:          parseFloat(org.lat) || 24.5963,
      p_lng:          parseFloat(org.lng) || 76.169,
      p_subdivisions: JSON.stringify(org.subdivisions || []),
      p_user_id:      userId,
      p_employee_id:  adminUser.employeeId,
      p_user_name:    adminUser.name,
      p_mobile:       adminUser.mobile || null,
    })
    if (rpcErr) throw new Error('Setup failed: ' + rpcErr.message)
    return { org_id: result.org_id, userId }
  },
}

// ── Helper: get my org_id ─────────────────────────────────────
let _orgId = null
export function setOrgId(id) { _orgId = id }
export function getOrgId() { return _orgId }

// ── Assets ───────────────────────────────────────────────────
export const assetsApi = {
  async list() {
    const { data, error } = await supabase
      .from('assets').select('*, feeders(code,name), profiles(name)')
      .eq('org_id', _orgId).order('created_at', { ascending: false })
    if (error) throw error
    return data
  },
  async create(payload) {
    const seq = await supabase.rpc('next_counter', { p_org_id: _orgId, p_name: 'asset' })
    const prefix = { pole:'P', dtr:'D', meter:'M', line:'L', pillar:'FP', iso:'I' }[payload.asset_type] || 'A'
    const asset_code = `${prefix}-${String(seq.data).padStart(4,'0')}`
    const { data, error } = await supabase.from('assets')
      .insert({ ...payload, org_id: _orgId, asset_code })
      .select().single()
    if (error) throw error
    return data
  },
  async update(id, updates) {
    const { data, error } = await supabase.from('assets')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) throw error
    return data
  },
  async delete(id) {
    // First nullify any patrol_observations that reference this asset
    await supabase.from('patrol_observations')
      .update({ asset_id: null }).eq('asset_id', id)
    const { error } = await supabase.from('assets').delete().eq('id', id)
    if (error) throw error
  },
  async importRecovery(records) {
    const results = { matched: 0, notFound: 0, total: 0, notFoundList: [] }
    const { data: meters } = await supabase.from('assets')
      .select('id,name,details').eq('org_id', _orgId).eq('asset_type', 'meter')
    for (const rec of records) {
      const kno = String(rec.k_number || rec.k_no || '').trim()
      if (!kno) continue
      const meter = meters?.find(m =>
        m.name === kno || m.details?.k_number === kno ||
        m.name?.replace(/\s/g,'') === kno.replace(/\s/g,'')
      )
      if (meter) {
        const out = parseFloat(rec.outstanding_amount || rec.outstanding || 0) || 0
        await supabase.from('assets').update({
          outstanding_amount: out,
          last_payment_date: rec.last_payment_date || null,
          mobile: rec.mobile ? rec.mobile.replace(/\D/g,'').slice(-10) : undefined,
          updated_at: new Date().toISOString(),
        }).eq('id', meter.id)
        results.matched++; results.total += out
      } else {
        results.notFound++
        if (results.notFoundList.length < 20) results.notFoundList.push(kno)
      }
    }
    return results
  },
}

// ── Substations ──────────────────────────────────────────────
export const substationsApi = {
  async list() {
    const { data, error } = await supabase.from('substations')
      .select('*, subdivisions(code,name)')
      .eq('org_id', _orgId).order('name')
    if (error) throw error
    return data || []
  },
  async create(payload) {
    const seq = await supabase.rpc('next_counter', { p_org_id: _orgId, p_name: 'substation' })
    const code = 'SS-' + String(seq.data).padStart(4,'0')
    const { data, error } = await supabase.from('substations')
      .insert({ ...payload, org_id: _orgId, code }).select().single()
    if (error) throw error
    return data
  },
  async update(id, updates) {
    const { data, error } = await supabase.from('substations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) throw error
    return data
  },
  async delete(id) {
    const { data: linked } = await supabase.from('feeders')
      .select('id').eq('substation_id', id).limit(1)
    if (linked?.length) throw new Error('Cannot delete — feeders linked to this substation')
    const { error } = await supabase.from('substations').delete().eq('id', id)
    if (error) throw error
  },
}

// ── Feeders ──────────────────────────────────────────────────
export const feedersApi = {
  async list() {
    const { data, error } = await supabase.from('feeders')
      .select('*, substations(id,name,code)').eq('org_id', _orgId).order('code')
    if (error) throw error
    return data
  },
  async create(payload) {
    const { data, error } = await supabase.from('feeders')
      .insert({ ...payload, org_id: _orgId }).select().single()
    if (error) throw error
    return data
  },
  async update(id, updates) {
    const { data, error } = await supabase.from('feeders')
      .update(updates).eq('id', id).select().single()
    if (error) throw error
    return data
  },
  async delete(id) {
    const { data: linked } = await supabase.from('assets').select('id').eq('feeder_id', id).limit(1)
    if (linked?.length) throw new Error('Cannot delete — assets linked to this feeder')
    const { error } = await supabase.from('feeders').delete().eq('id', id)
    if (error) throw error
  },
}

// ── Work Orders ───────────────────────────────────────────────
export const woApi = {
  async list() {
    const { data, error } = await supabase.from('work_orders')
      .select('*, feeders(code,name), profiles!assigned_to_id(name)')
      .eq('org_id', _orgId).order('created_at', { ascending: false })
    if (error) throw error
    return data
  },
  async create(payload) {
    const seq = await supabase.rpc('next_counter', { p_org_id: _orgId, p_name: 'wo' })
    const wo_number = `WO-${new Date().getFullYear()}-${String(seq.data).padStart(4,'0')}`
    const { data, error } = await supabase.from('work_orders')
      .insert({ ...payload, org_id: _orgId, wo_number }).select().single()
    if (error) throw error
    // Flag linked assets
    if (payload.asset_ids?.length) {
      await supabase.from('assets').update({ status: 'flag', flag_note: payload.issue_type })
        .in('id', payload.asset_ids)
    }
    return data
  },
  async close(id, remarks) {
    const { data: wo } = await supabase.from('work_orders').select('asset_ids').eq('id', id).single()
    const { data, error } = await supabase.from('work_orders')
      .update({ status: 'closed', close_date: new Date().toISOString().split('T')[0],
        remarks: remarks || '', updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) throw error
    if (wo?.asset_ids?.length) {
      await supabase.from('assets').update({ status: 'ok', flag_note: null })
        .in('id', wo.asset_ids)
    }
    return data
  },
  async update(id, updates) {
    const { data, error } = await supabase.from('work_orders')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) throw error
    return data
  },
}

// ── Measurement Books ─────────────────────────────────────────
export const mbApi = {
  async list() {
    const { data, error } = await supabase.from('measurement_books')
      .select('*, feeders(code,name), work_orders(wo_number), profiles!prepared_by_id(name)')
      .eq('org_id', _orgId).order('created_at', { ascending: false })
    if (error) throw error
    return data
  },
  async create(payload) {
    const seq = await supabase.rpc('next_counter', { p_org_id: _orgId, p_name: 'mb' })
    const mb_number = `MB-${new Date().getFullYear()}-${String(seq.data).padStart(4,'0')}`
    const total_amount = (payload.items || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
    const { data, error } = await supabase.from('measurement_books')
      .insert({ ...payload, org_id: _orgId, mb_number, total_amount }).select().single()
    if (error) throw error
    return data
  },
  async updateStatus(id, status, approver_id) {
    const updates = { status, updated_at: new Date().toISOString() }
    if (status === 'approved') updates.approved_by_id = approver_id
    const { data, error } = await supabase.from('measurement_books')
      .update(updates).eq('id', id).select().single()
    if (error) throw error
    return data
  },
}

// ── Users (Profiles) ─────────────────────────────────────────
export const usersApi = {
  async list() {
    const { data, error } = await supabase.from('profiles')
      .select('*, subdivisions(code,name)').eq('org_id', _orgId).order('name')
    if (error) throw error
    return data
  },
  async create({ email, password, ...profile }) {
    // Get current org_id from session — _orgId may be stale
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    let orgId = _orgId
    if (!orgId && currentUser) {
      const { data: adminProfile } = await supabase
        .from('profiles').select('org_id').eq('id', currentUser.id).single()
      orgId = adminProfile?.org_id
    }
    if (!orgId) throw new Error('Organisation not found — please re-login')

    // Sign up new user
    const { data: auth, error: authErr } = await supabase.auth.signUp({ email, password })
    if (authErr) throw new Error(authErr.message)
    if (!auth.user) throw new Error('User creation failed — check Supabase Auth settings')
    const isDuplicate = auth.user.identities && auth.user.identities.length === 0
    if (isDuplicate) throw new Error('Email already registered. Use a different email.')

    // Insert profile
    const { data: prof, error: profErr } = await supabase.from('profiles')
      .insert({ id: auth.user.id, org_id: orgId, ...profile })
      .select('*, subdivisions(code,name)')
      .single()
    if (profErr) {
      // Profile insert failed — log detail
      console.error('Profile insert error:', profErr)
      throw new Error('Profile creation failed: ' + profErr.message + ' (code: ' + profErr.code + ')')
    }
    return prof
  },
  async update(id, updates) {
    const { data, error } = await supabase.from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) throw error
    return data
  },
  async toggleActive(id) {
    const { data: curr } = await supabase.from('profiles').select('is_active').eq('id', id).single()
    return usersApi.update(id, { is_active: !curr.is_active })
  },
}

// ── Outstanding Groups ────────────────────────────────────────
export const groupsApi = {
  async list() {
    const { data, error } = await supabase.from('outstanding_groups')
      .select('*').eq('org_id', _orgId).order('created_at', { ascending: false })
    if (error) throw error
    return data
  },
  async create(payload) {
    const { data, error } = await supabase.from('outstanding_groups')
      .insert({ ...payload, org_id: _orgId }).select().single()
    if (error) throw error
    return data
  },
  async update(id, updates) {
    const { data, error } = await supabase.from('outstanding_groups')
      .update(updates).eq('id', id).select().single()
    if (error) throw error
    return data
  },
  async delete(id) {
    const { error } = await supabase.from('outstanding_groups').delete().eq('id', id)
    if (error) throw error
  },
}

// ── Config ───────────────────────────────────────────────────
// ── Patrol Reports API ───────────────────────────────────────
export const patrolApi = {
  async listReports() {
    const { data, error } = await supabase.from('patrol_reports')
      .select('*, feeders(code,name), profiles!patrolled_by_id(name,employee_id)')
      .eq('org_id', _orgId).order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  async getReport(id) {
    const { data: report, error } = await supabase.from('patrol_reports')
      .select('*, feeders(code,name), profiles!patrolled_by_id(name,employee_id)')
      .eq('id', id).single()
    if (error) throw error
    const { data: obs } = await supabase.from('patrol_observations')
      .select('*').eq('patrol_id', id).order('seq_number')
    return { ...report, observations: obs || [] }
  },

  async startPatrol(feederId, profileId) {
    const seq = await supabase.rpc('next_counter', { p_org_id: _orgId, p_name: 'patrol' })
    const report_number = 'PR-' + new Date().getFullYear() + '-' + String(seq.data).padStart(4,'0')
    const { data, error } = await supabase.from('patrol_reports')
      .insert({ org_id: _orgId, report_number, feeder_id: feederId,
        patrolled_by_id: profileId, status: 'active' })
      .select().single()
    if (error) throw error
    return data
  },

  async addObservation(patrolId, obs) {
    const { data, error } = await supabase.from('patrol_observations')
      .insert({ ...obs, org_id: _orgId, patrol_id: patrolId }).select().single()
    if (error) throw error
    // Flag the asset
    if (obs.asset_id) {
      await supabase.from('assets').update({
        status: 'flag',
        flag_note: obs.issue_type,
        updated_at: new Date().toISOString(),
      }).eq('id', obs.asset_id)
    }
    return data
  },

  async completePatrol(id, totalAssets, totalIssues, remarks) {
    const { data, error } = await supabase.from('patrol_reports')
      .update({ status: 'completed', end_time: new Date().toISOString(),
        total_assets: totalAssets, total_issues: totalIssues, remarks: remarks || '' })
      .eq('id', id).select().single()
    if (error) throw error
    return data
  },
}

// ── Shutdown Alert API ───────────────────────────────────────
export const shutdownApi = {
  async list() {
    const { data, error } = await supabase.from('shutdowns')
      .select('*, substations(id,name,code,voltage_ratio), profiles!posted_by_id(name,employee_id)')
      .eq('org_id', _orgId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return data || []
  },

  async listActive() {
    const { data, error } = await supabase.from('shutdowns')
      .select('*, substations(id,name,code,voltage_ratio), profiles!posted_by_id(name,employee_id)')
      .eq('org_id', _orgId).eq('status', 'active')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  async create(payload) {
    const { data, error } = await supabase.from('shutdowns')
      .insert({ ...payload, org_id: _orgId }).select('*, profiles!posted_by_id(name,employee_id)').single()
    if (error) throw error
    return data
  },

  async restore(id, note) {
    const { data, error } = await supabase.from('shutdowns')
      .update({
        status: 'restored',
        actual_restore: new Date().toISOString(),
        restore_note: note || '',
        updated_at: new Date().toISOString(),
      }).eq('id', id).select().single()
    if (error) throw error
    return data
  },

  async acknowledge(id, userId) {
    // Add userId to acknowledged_by array
    const { data: current } = await supabase.from('shutdowns')
      .select('acknowledged_by').eq('id', id).single()
    const acked = current?.acknowledged_by || []
    if (acked.includes(userId)) return
    const { data, error } = await supabase.from('shutdowns')
      .update({ acknowledged_by: [...acked, userId] })
      .eq('id', id).select().single()
    if (error) throw error
    return data
  },

  // Subscribe to real-time shutdown events
  subscribe(orgId, onInsert, onUpdate) {
    // Subscribe without filter — filter client-side by org_id
    // Supabase Realtime filter on non-indexed columns can miss events
    const channel = supabase.channel('shutdowns-realtime-' + orgId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'shutdowns',
      }, payload => {
        if (payload.new?.org_id === orgId) onInsert(payload.new)
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'shutdowns',
      }, payload => {
        if (payload.new?.org_id === orgId) onUpdate(payload.new)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Shutdown realtime subscribed for org:', orgId)
        }
      })
    return channel
  },

  async delete(id) {
    const { error } = await supabase.from('shutdowns').delete().eq('id', id)
    if (error) throw error
  },

  async archive(id) {
    const { data, error } = await supabase.from('shutdowns')
      .update({ status: 'restored', restore_note: 'Archived by admin', actual_restore: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) throw error
    return data
  },

  unsubscribe(channel) {
    if (channel) supabase.removeChannel(channel)
  },

  // Public — no auth needed
  async getNearby(lat, lng, radiusKm = 15) {
    const { data, error } = await supabase.rpc('get_nearby_shutdowns', {
      user_lat: lat, user_lng: lng, radius_km: radiusKm
    })
    if (error) throw error
    return Array.isArray(data) ? data : (data || [])
  },
}

// ── Audit Log ────────────────────────────────────────────────
export const auditApi = {
  async log({ action, category, severity = 'info', description, meta = {} }) {
    try {
      await supabase.from('audit_log').insert({
        org_id: _orgId,
        user_id: (await supabase.auth.getUser()).data.user?.id,
        action, category, severity, description,
        meta: { ...meta, ts: new Date().toISOString() },
      })
    } catch(e) { console.warn('Audit log failed:', e.message) }
  },

  async list({ category, limit = 100 } = {}) {
    let q = supabase.from('audit_log')
      .select('*, profiles(name, employee_id, role)')
      .eq('org_id', _orgId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (category && category !== 'all') q = q.eq('category', category)
    const { data, error } = await q
    if (error) throw error
    return data || []
  },
}

// ── Nearby Assets ─────────────────────────────────────────────
export const nearbyApi = {
  async query(lat, lng, radiusM = 20) {
    // Fetch all assets in org and filter client-side using haversine
    // (PostGIS not guaranteed on all Supabase plans)
    const { data, error } = await supabase.from('assets')
      .select('id, name, asset_type, asset_code, latitude, longitude, status')
      .eq('org_id', _orgId)
    if (error) throw error
    if (!data) return []

    const R = 6371000
    const toR = d => d * Math.PI / 180
    return data
      .map(a => {
        const dLat = toR(parseFloat(a.latitude) - lat)
        const dLng = toR(parseFloat(a.longitude) - lng)
        const sinA = Math.sin(dLat/2), sinB = Math.sin(dLng/2)
        const c = sinA*sinA + Math.cos(toR(lat))*Math.cos(toR(parseFloat(a.latitude)))*sinB*sinB
        const dist = R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1-c))
        return { ...a, distance_m: Math.round(dist) }
      })
      .filter(a => a.distance_m <= radiusM)
      .sort((a, b) => a.distance_m - b.distance_m)
  },
}

// ── Hierarchy (Divisions + Subdivisions) ─────────────────────
export const hierarchyApi = {
  // Divisions
  async listDivisions() {
    const { data, error } = await supabase.from('divisions')
      .select('*, subdivisions(*)').eq('org_id', _orgId).order('name')
    if (error) throw error
    return data || []
  },
  async createDivision(payload) {
    const { data, error } = await supabase.from('divisions')
      .insert({ ...payload, org_id: _orgId }).select().single()
    if (error) throw error
    return data
  },
  async updateDivision(id, updates) {
    const { data, error } = await supabase.from('divisions')
      .update(updates).eq('id', id).select().single()
    if (error) throw error
    return data
  },
  async deleteDivision(id) {
    const { data: subs } = await supabase.from('subdivisions')
      .select('id').eq('division_id', id).limit(1)
    if (subs?.length) throw new Error('Cannot delete — subdivisions exist under this division')
    const { error } = await supabase.from('divisions').delete().eq('id', id)
    if (error) throw error
  },
  // Subdivisions
  async createSubdivision(payload) {
    const { data, error } = await supabase.from('subdivisions')
      .insert({ ...payload, org_id: _orgId }).select().single()
    if (error) throw error
    return data
  },
  async updateSubdivision(id, updates) {
    const { data, error } = await supabase.from('subdivisions')
      .update(updates).eq('id', id).select().single()
    if (error) throw error
    return data
  },
  async deleteSubdivision(id) {
    const { data: linked } = await supabase.from('feeders')
      .select('id').eq('subdivision_id', id).limit(1)
    if (linked?.length) throw new Error('Cannot delete — feeders linked to this subdivision')
    const { error } = await supabase.from('subdivisions').delete().eq('id', id)
    if (error) throw error
  },
}

export const configApi = {
  async get(orgId) {
    const { data, error } = await supabase.from('organisations')
      .select('*, subdivisions(*)').eq('id', orgId).single()
    if (error) return null
    return data
  },
  async update(id, updates) {
    const { data, error } = await supabase.from('organisations')
      .update(updates).eq('id', id).select().single()
    if (error) throw error
    return data
  },
  async isSetupDone() {
    // Use auth.users count via a public RPC or just attempt to read
    try {
      const { count, error } = await supabase
        .from('organisations')
        .select('id', { count: 'exact', head: true })
      if (error) return false  // RLS blocked = no org yet = not set up
      return (count || 0) > 0
    } catch { return false }
  },
}
