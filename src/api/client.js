import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your Vercel environment variables.')
}

export const supabase = createClient(SUPABASE_URL || '', SUPABASE_ANON || '')

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
 async getProfile(userId) {
    const { data: profile, error: profErr } = await supabase
      .from('profiles').select('*').eq('id', userId).single()
    if (profErr) throw new Error(profErr.message)
    const { data: org } = await supabase
      .from('organisations').select('*').eq('id', profile.org_id).single()
    let subdiv = null
    if (profile.subdivision_id) {
      const { data: sd } = await supabase
        .from('subdivisions').select('code,name').eq('id', profile.subdivision_id).single()
      subdiv = sd
    }
    return { ...profile, organisations: org, subdivisions: subdiv }
  },
      .eq('id', userId).single()
    if (error) throw new Error(error.message)
    return data
  },
  async setup({ org, adminUser }) {
    // Step 1: Create auth user
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: adminUser.email,
      password: adminUser.password,
      options: { emailRedirectTo: window.location.origin }
    })
    if (authErr) throw new Error(authErr.message)
    const userId = authData.user.id

    // Step 2: Sign in immediately to get a valid session for RPC call
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: adminUser.email,
      password: adminUser.password,
    })
    if (signInErr) throw new Error('Could not sign in after signup — make sure "Confirm email" is DISABLED in Supabase → Auth → Providers → Email')

    // Step 3: Call SECURITY DEFINER function — bypasses RLS entirely
    // This creates org + subdivisions + profile atomically in one SQL transaction
    const { data: result, error: rpcErr } = await supabase.rpc('setup_organisation', {
      p_org_name:     org.name,
      p_circle:       org.circle || '',
      p_division:     org.division,
      p_city:         org.city,
      p_state:        org.state,
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

// ── Feeders ──────────────────────────────────────────────────
export const feedersApi = {
  async list() {
    const { data, error } = await supabase.from('feeders')
      .select('*').eq('org_id', _orgId).order('code')
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
    // Sign up new user — email confirm should be OFF in Supabase settings
    const { data: auth, error: authErr } = await supabase.auth.signUp({ email, password })
    if (authErr) throw new Error(authErr.message)
    if (!auth.user) throw new Error('User creation failed — check Supabase Auth settings')
    // Insert profile row for the new user
    const { error: profErr } = await supabase.from('profiles').insert({
      id: auth.user.id, org_id: _orgId, ...profile,
    })
    if (profErr) throw new Error(profErr.message)
    return auth.user
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
