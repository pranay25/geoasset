import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

// ── Auth ──────────────────────────────────────────────────────
export const authApi = {
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
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
    const { data, error } = await supabase
      .from('profiles').select('*, subdivisions(code,name), organisations(*)')
      .eq('id', userId).single()
    if (error) throw new Error(error.message)
    return data
  },
  async setup({ org, adminUser }) {
    // 1. Create auth user
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: adminUser.email,
      password: adminUser.password,
    })
    if (authErr) throw new Error(authErr.message)
    const userId = authData.user.id

    // 2. Create organisation
    const { data: orgData, error: orgErr } = await supabase
      .from('organisations').insert({
        name: org.name, circle: org.circle, division: org.division,
        city: org.city, state: org.state, lat: org.lat, lng: org.lng,
      }).select().single()
    if (orgErr) throw new Error(orgErr.message)

    // 3. Create subdivisions
    if (org.subdivisions?.length) {
      await supabase.from('subdivisions').insert(
        org.subdivisions.map(s => ({ org_id: orgData.id, code: s.code, name: s.name }))
      )
    }

    // 4. Create admin profile
    const { error: profErr } = await supabase.from('profiles').insert({
      id: userId, org_id: orgData.id,
      employee_id: adminUser.employeeId,
      name: adminUser.name,
      mobile: adminUser.mobile,
      role: 'admin',
    })
    if (profErr) throw new Error(profErr.message)

    return { org: orgData, userId }
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
    const year = new Date().getFullYear()
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
    const { data: auth, error: authErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (authErr) throw new Error(authErr.message)
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
    const { count } = await supabase.from('organisations').select('id', { count: 'exact', head: true })
    return (count || 0) > 0
  },
}
