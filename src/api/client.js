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
let _profile = null
export function setOrgId(id) { _orgId = id }
export function getOrgId() { return _orgId }
export function setProfileScope(profile) { _profile = profile }

// ── Role-based data scope ────────────────────────────────────
// Returns filtered feeder IDs for the current user's scope
// Used to filter assets, WOs, MBs that don't have direct scope FKs
let _scopedFeederIds = null   // cached feeder ids in scope
let _scopedSubstationIds = null

async function getScopedFeederIds() {
  if (!_profile) return null
  const role = _profile.role
  if (['admin','se','ao'].includes(role)) return null  // no filter = see all
  if (_scopedFeederIds) return _scopedFeederIds

  let query = supabase.from('feeders').select('id').eq('org_id', _orgId)

  if (role === 'feeder_incharge' && _profile.feeder_id) {
    _scopedFeederIds = [_profile.feeder_id]
    return _scopedFeederIds
  }
  if (role === 'je' && _profile.substation_id) {
    query = query.eq('substation_id', _profile.substation_id)
  }
  if (role === 'sdo' && _profile.subdivision_id) {
    query = query.eq('subdivision_id', _profile.subdivision_id)
  }
  if (role === 'ee' && _profile.division_id) {
    // Get all subdivisions in this division
    const { data: subs } = await supabase.from('subdivisions')
      .select('id').eq('division_id', _profile.division_id)
    const subIds = (subs||[]).map(s => s.id)
    if (subIds.length) query = query.in('subdivision_id', subIds)
    else { _scopedFeederIds = []; return [] }
  }

  const { data } = await query
  _scopedFeederIds = (data||[]).map(f => f.id)
  return _scopedFeederIds
}

async function getScopedSubstationIds() {
  if (!_profile) return null
  const role = _profile.role
  if (['admin','se','ao'].includes(role)) return null
  if (_scopedSubstationIds) return _scopedSubstationIds

  let query = supabase.from('substations').select('id').eq('org_id', _orgId)

  if (role === 'feeder_incharge') {
    // FI can see the substation their feeder belongs to
    if (_profile.substation_id) _scopedSubstationIds = [_profile.substation_id]
    else _scopedSubstationIds = []
    return _scopedSubstationIds
  }
  if (role === 'je' && _profile.substation_id) {
    _scopedSubstationIds = [_profile.substation_id]
    return _scopedSubstationIds
  }
  if (role === 'sdo' && _profile.subdivision_id) {
    query = query.eq('subdivision_id', _profile.subdivision_id)
  }
  if (role === 'ee' && _profile.division_id) {
    const { data: subs } = await supabase.from('subdivisions')
      .select('id').eq('division_id', _profile.division_id)
    const subIds = (subs||[]).map(s => s.id)
    if (subIds.length) query = query.in('subdivision_id', subIds)
    else { _scopedSubstationIds = []; return [] }
  }

  const { data } = await query
  _scopedSubstationIds = (data||[]).map(s => s.id)
  return _scopedSubstationIds
}

// Reset scope cache on login/logout
export function clearScopeCache() {
  _scopedFeederIds = null
  _scopedSubstationIds = null
}

// ── Assets ───────────────────────────────────────────────────
export const assetsApi = {
  async list() {
    const feederIds = await getScopedFeederIds()
    let query = supabase.from('assets')
      .select('*, feeders(code,name), profiles(name)')
      .eq('org_id', _orgId).order('created_at', { ascending: false })
    if (feederIds !== null) {
      if (feederIds.length === 0) return []
      query = query.in('feeder_id', feederIds)
    }
    const { data, error } = await query
    if (error) throw error
    return data
  },
  async create(payload) {
    const seq = await supabase.rpc('next_counter', { p_org_id: _orgId, p_name: 'asset' })
    const prefix = { pole:'P', dtr:'D', meter:'M', line:'L', pillar:'FP', iso:'I', linedp:'LD', stay_11kv:'S1', stay_33kv:'S3', lattice_36:'LT', lattice_42:'LT', ab_cable:'AB', rmu:'RM', cap_bank:'CB', la:'LA', streetlight:'SL', service_conn:'SC', dtr_sp:'DS' }[payload.asset_type] || 'A'
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
    const substationIds = await getScopedSubstationIds()
    let query = supabase.from('substations')
      .select('*, subdivisions(code,name)')
      .eq('org_id', _orgId).order('name')
    if (substationIds !== null) {
      if (substationIds.length === 0) return []
      query = query.in('id', substationIds)
    }
    const { data, error } = await query
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
    const role = _profile?.role
    let query = supabase.from('feeders')
      .select('*, substations(id,name,code)').eq('org_id', _orgId).order('code')
    // Apply scope
    if (!['admin','se','ao'].includes(role)) {
      if (role === 'feeder_incharge' && _profile?.feeder_id)
        query = query.eq('id', _profile.feeder_id)
      else if (role === 'je' && _profile?.substation_id)
        query = query.eq('substation_id', _profile.substation_id)
      else if (role === 'sdo' && _profile?.subdivision_id)
        query = query.eq('subdivision_id', _profile.subdivision_id)
      else if (role === 'ee' && _profile?.division_id) {
        const { data: subs } = await supabase.from('subdivisions')
          .select('id').eq('division_id', _profile.division_id)
        const subIds = (subs||[]).map(s => s.id)
        if (subIds.length) query = query.in('subdivision_id', subIds)
      }
    }
    const { data, error } = await query
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
    const feederIds = await getScopedFeederIds()
    let query = supabase.from('work_orders')
      .select('*, feeders(code,name), profiles!assigned_to_id(name)')
      .eq('org_id', _orgId).order('created_at', { ascending: false })
    if (feederIds !== null) {
      if (feederIds.length === 0) return []
      query = query.in('feeder_id', feederIds)
    }
    const { data, error } = await query
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
    const feederIds = await getScopedFeederIds()
    let query = supabase.from('measurement_books')
      .select('*, feeders(code,name), work_orders(wo_number), profiles!prepared_by_id(name)')
      .eq('org_id', _orgId).order('created_at', { ascending: false })
    if (feederIds !== null) {
      if (feederIds.length > 0) query = query.in('feeder_id', feederIds)
      else return []
    }
    const { data, error } = await query
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
    const role = _profile?.role
    let query = supabase.from('profiles')
      .select('*, subdivisions(code,name)').eq('org_id', _orgId).order('name')
    // SDO sees only their subdivision's users
    if (role === 'sdo' && _profile?.subdivision_id) {
      query = query.eq('subdivision_id', _profile.subdivision_id)
    }
    // EE sees their division's users
    else if (role === 'ee' && _profile?.division_id) {
      const { data: subs } = await supabase.from('subdivisions')
        .select('id').eq('division_id', _profile.division_id)
      const subIds = (subs||[]).map(s => s.id)
      if (subIds.length) query = query.in('subdivision_id', subIds)
    }
    // JE/FI only see themselves
    else if (['je','feeder_incharge'].includes(role)) {
      query = query.eq('id', _profile.id)
    }
    const { data, error } = await query
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
// ── Maintenance Proposal API ─────────────────────────────────
export const maintenanceApi = {

  async list() {
    const role = _profile?.role
    let query = supabase.from('maintenance_proposals')
      .select('*, feeders(code,name), subdivisions(code,name), profiles!created_by_id(name,employee_id,role)')
      .eq('org_id', _orgId)
      .order('created_at', { ascending: false })

    // Role-based filtering — proposals have subdivision_id directly
    if (!['admin','se','ao'].includes(role)) {
      if (role === 'feeder_incharge' && _profile?.feeder_id) {
        query = query.eq('feeder_id', _profile.feeder_id)
      } else if (role === 'je' && _profile?.substation_id) {
        // JE sees proposals for feeders on their substation
        const feederIds = await getScopedFeederIds()
        if (!feederIds?.length) return []
        query = query.in('feeder_id', feederIds)
      } else if (role === 'sdo' && _profile?.subdivision_id) {
        // SDO sees proposals in their subdivision directly
        query = query.eq('subdivision_id', _profile.subdivision_id)
      } else if (role === 'ee' && _profile?.division_id) {
        // EE sees proposals in subdivisions of their division
        const { data: subs } = await supabase.from('subdivisions')
          .select('id').eq('division_id', _profile.division_id)
        const subIds = (subs||[]).map(s=>s.id)
        if (!subIds.length) return []
        query = query.in('subdivision_id', subIds)
      }
    }

    const { data, error } = await query
    if (error) throw error
    return data || []
  },

  async get(id) {
    const { data: proposal, error } = await supabase.from('maintenance_proposals')
      .select('*, feeders(code,name), subdivisions(code,name), profiles!created_by_id(name,employee_id,role)')
      .eq('id', id).single()
    if (error) throw error
    const { data: items } = await supabase.from('maintenance_items')
      .select('*, profiles!tagged_by_id(name,employee_id)')
      .eq('proposal_id', id).order('seq_number')
    return { ...proposal, items: items || [] }
  },

  async generateNumber(feederId, subdivisionId) {
    const year = new Date().getFullYear()
    const seq = await supabase.rpc('next_counter', { p_org_id: _orgId, p_name: 'proposal' })
    const { data: feeder } = await supabase.from('feeders').select('code').eq('id', feederId).single()
    const { data: sd } = await supabase.from('subdivisions').select('code').eq('id', subdivisionId).single()
    const num = String(seq.data).padStart(4,'0')
    return `${feeder?.code||'F'}/${sd?.code||'SD'}/${year}/${num}`
  },

  async create({ feederId, subdivisionId, title, description, priority, createdById }) {
    const proposal_number = await maintenanceApi.generateNumber(feederId, subdivisionId)
    const { data, error } = await supabase.from('maintenance_proposals')
      .insert({
        org_id: _orgId,
        proposal_number,
        feeder_id: feederId,
        subdivision_id: subdivisionId,
        title, description,
        priority: priority || 'normal',
        status: 'draft',
        created_by_id: createdById,
        current_owner_id: createdById,
        ao_budget_status: 'pending',
      }).select().single()
    if (error) throw error
    return data
  },

  async addItem(proposalId, item) {
    const { data: existing } = await supabase.from('maintenance_items')
      .select('seq_number').eq('proposal_id', proposalId)
      .order('seq_number', { ascending: false }).limit(1)
    const seq = (existing?.[0]?.seq_number || 0) + 1
    const { data, error } = await supabase.from('maintenance_items')
      .insert({ ...item, org_id: _orgId, proposal_id: proposalId, seq_number: seq })
      .select().single()
    if (error) throw error
    // Flag the asset
    if (item.asset_id) {
      await supabase.from('assets').update({ status: 'flag', flag_note: item.issue_type }).eq('id', item.asset_id)
    }
    return data
  },

  async removeItem(itemId) {
    const { data: item } = await supabase.from('maintenance_items').select('asset_id').eq('id', itemId).single()
    const { error } = await supabase.from('maintenance_items').delete().eq('id', itemId)
    if (error) throw error
    return item
  },

  // Stage transitions
  async advance(id, nextStatus, remarks, userId) {
    const now = new Date().toISOString()
    const updates = {
      status: nextStatus,
      current_owner_id: userId,
      updated_at: now,
    }
    // Record stage remarks and timestamps
    const statusMap = {
      je_review:  { fi_remarks: remarks, submitted_by_fi_at: now },
      sdo_review: { je_remarks: remarks, submitted_by_je_at: now },
      ee_review:  { sdo_remarks: remarks, submitted_by_sdo_at: now },
      se_review:  { ee_remarks: remarks, submitted_by_ee_at: now },
      approved:   { se_remarks: remarks, approved_at: now, approved_by_id: userId },
      hold:       { se_remarks: remarks },
    }
    Object.assign(updates, statusMap[nextStatus] || {})
    const { data, error } = await supabase.from('maintenance_proposals')
      .update(updates).eq('id', id).select().single()
    if (error) throw error
    return data
  },

  async reject(id, toStatus, reason, userId) {
    const { data, error } = await supabase.from('maintenance_proposals')
      .update({
        status: toStatus,  // send back to previous stage status
        rejected_at_stage: toStatus,
        rejection_reason: reason,
        rejected_by_id: userId,
        current_owner_id: userId,
        updated_at: new Date().toISOString(),
      }).eq('id', id).select().single()
    if (error) throw error
    return data
  },

  async aoReview(id, budgetStatus, note, userId) {
    // AO adds budget note — NOT a terminal action, proposal continues
    const { data, error } = await supabase.from('maintenance_proposals')
      .update({
        ao_budget_status: budgetStatus,
        ao_budget_note: note,
        ao_reviewed_by: userId,
        ao_reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', id).select().single()
    if (error) throw error
    return data
  },

  async jeVerifyItem(itemId, verified, note) {
    const { data, error } = await supabase.from('maintenance_items')
      .update({ je_verified: verified, je_note: note, removed_by_je: !verified })
      .eq('id', itemId).select().single()
    if (error) throw error
    return data
  },
}

// ── Patrol Reports API ───────────────────────────────────────
export const patrolApi = {
  async listReports() {
    const feederIds = await getScopedFeederIds()
    let query = supabase.from('patrol_reports')
      .select('*, feeders(code,name), profiles!patrolled_by_id(name,employee_id)')
      .eq('org_id', _orgId).order('created_at', { ascending: false })
    if (feederIds !== null) {
      if (feederIds.length === 0) return []
      query = query.in('feeder_id', feederIds)
    }
    // FI only sees their own patrols
    if (_profile?.role === 'feeder_incharge') {
      query = query.eq('patrolled_by_id', _profile.id)
    }
    const { data, error } = await query
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
    if (!_orgId) return []
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

// ── Travel Allowance (TA) Journey Tracker ─────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const toR = d => d * Math.PI / 180
  const dLat = toR(lat2 - lat1)
  const dLng = toR(lng2 - lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1))*Math.cos(toR(lat2))*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export const taApi = {
  haversineKm,

  async listJourneys(userId) {
    let query = supabase.from('ta_journeys')
      .select('*, substations(name,code), profiles!user_id(name,employee_id,role)')
      .eq('org_id', _orgId)
      .order('created_at', { ascending: false })
    // Non-admin users see only their own journeys
    if (userId && !['admin','se','ee','ao'].includes(_profile?.role)) {
      query = query.eq('user_id', userId)
    }
    const { data, error } = await query
    if (error) throw error
    return data || []
  },

  async getJourney(id) {
    const { data: journey, error } = await supabase.from('ta_journeys')
      .select('*, substations(name,code), profiles!user_id(name,employee_id,role)')
      .eq('id', id).single()
    if (error) throw error
    const { data: captures } = await supabase.from('ta_captures')
      .select('*').eq('journey_id', id).order('seq_number')
    return { ...journey, captures: captures || [] }
  },

  async generateNumber() {
    const seq = await supabase.rpc('next_counter', { p_org_id: _orgId, p_name: 'ta_journey' })
    const year = new Date().getFullYear()
    return `TA-${year}-${String(seq.data).padStart(4,'0')}`
  },

  async startJourney({ userId, substationId, substationName, substationLat, substationLng, purpose }) {
    const journey_number = await taApi.generateNumber()
    const { data, error } = await supabase.from('ta_journeys')
      .insert({
        org_id: _orgId, journey_number,
        user_id: userId, substation_id: substationId || null,
        substation_name: substationName, substation_lat: substationLat, substation_lng: substationLng,
        purpose, status: 'active',
      }).select().single()
    if (error) throw error
    return data
  },

  async addCapture(journeyId, { lat, lng, acc, note }, substationLat, substationLng) {
    // Get current capture count for seq_number
    const { data: existing } = await supabase.from('ta_captures')
      .select('seq_number').eq('journey_id', journeyId)
      .order('seq_number', { ascending: false }).limit(1)
    const seq = (existing?.[0]?.seq_number || 0) + 1
    const distance_km = (substationLat != null && substationLng != null)
      ? Math.round(haversineKm(substationLat, substationLng, lat, lng) * 100) / 100
      : null
    const { data, error } = await supabase.from('ta_captures')
      .insert({
        org_id: _orgId, journey_id: journeyId, seq_number: seq,
        latitude: lat, longitude: lng, accuracy_m: acc,
        distance_km, note: note || null,
      }).select().single()
    if (error) throw error
    return data
  },

  async completeJourney(id, maxDistanceKm) {
    const { data, error } = await supabase.from('ta_journeys')
      .update({
        status: 'completed',
        end_time: new Date().toISOString(),
        max_distance_km: maxDistanceKm,
        is_eligible: maxDistanceKm >= 15,
      }).eq('id', id).select().single()
    if (error) throw error
    return data
  },

  async deleteJourney(id) {
    const { error } = await supabase.from('ta_journeys').delete().eq('id', id)
    if (error) throw error
  },
}
