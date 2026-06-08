import { create } from 'zustand'
import { supabase, authApi, assetsApi, feedersApi, woApi, mbApi, usersApi, groupsApi, setOrgId } from '../api/client.js'

// ── Auth Store ────────────────────────────────────────────────
export const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  org: null,
  loading: true,

  init: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      try {
        const profile = await authApi.getProfile(session.user.id)
        setOrgId(profile.org_id)
        set({ user: session.user, profile, org: profile.organisations, loading: false })
      } catch {
        set({ loading: false })
      }
    } else {
      set({ loading: false })
    }
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const profile = await authApi.getProfile(session.user.id)
        setOrgId(profile.org_id)
        set({ user: session.user, profile, org: profile.organisations })
      }
      if (event === 'SIGNED_OUT') {
        set({ user: null, profile: null, org: null })
      }
    })
  },

  login: async (email, password) => {
    const data = await authApi.login(email, password)
    const profile = await authApi.getProfile(data.user.id)
    if (!profile.is_active) throw new Error('Account is deactivated')
    setOrgId(profile.org_id)
    set({ user: data.user, profile, org: profile.organisations })
    return profile
  },

  logout: async () => {
    await authApi.logout()
    set({ user: null, profile: null, org: null })
  },

  canSurvey: () => {
    const r = get().profile?.role
    return r === 'admin' || r === 'sdo' || r === 'je' || r === 'feeder_incharge'
  },

  canManageUsers: () => {
    const r = get().profile?.role
    return r === 'admin' || r === 'sdo'
  },

  canApprove: () => {
    const r = get().profile?.role
    return r === 'admin' || r === 'sdo' || r === 'ao'
  },

  isAdmin: () => get().profile?.role === 'admin',
}))

// ── Asset Store ───────────────────────────────────────────────
export const useAssetStore = create((set, get) => ({
  assets: [],
  loading: false,

  fetch: async () => {
    set({ loading: true })
    const data = await assetsApi.list()
    set({ assets: data || [], loading: false })
  },

  add: (asset) => set(s => ({ assets: [asset, ...s.assets] })),

  update: (id, updates) => set(s => ({
    assets: s.assets.map(a => a.id === id ? { ...a, ...updates } : a)
  })),

  remove: (id) => set(s => ({ assets: s.assets.filter(a => a.id !== id) })),

  getByFeeder: (feederId) => get().assets.filter(a => a.feeder_id === feederId),

  getMeters: () => get().assets.filter(a => a.asset_type === 'meter'),

  getHighOutstanding: (min = 10000) =>
    get().assets.filter(a => a.asset_type === 'meter' && (a.outstanding_amount || 0) >= min)
      .sort((a,b) => (b.outstanding_amount||0) - (a.outstanding_amount||0)),

  totalOutstanding: () =>
    get().assets.filter(a=>a.asset_type==='meter').reduce((s,a)=>s+(a.outstanding_amount||0), 0),
}))

// ── Feeder Store ──────────────────────────────────────────────
export const useFeederStore = create((set, get) => ({
  feeders: [],
  loading: false,

  fetch: async () => {
    set({ loading: true })
    const data = await feedersApi.list()
    set({ feeders: data || [], loading: false })
  },

  add: (f) => set(s => ({ feeders: [...s.feeders, f] })),
  update: (id, u) => set(s => ({ feeders: s.feeders.map(f => f.id===id ? {...f,...u} : f) })),
  remove: (id) => set(s => ({ feeders: s.feeders.filter(f => f.id!==id) })),
}))

// ── WO Store ──────────────────────────────────────────────────
export const useWOStore = create((set) => ({
  wos: [],
  loading: false,

  fetch: async () => {
    set({ loading: true })
    const data = await woApi.list()
    set({ wos: data || [], loading: false })
  },

  add: (wo) => set(s => ({ wos: [wo, ...s.wos] })),
  update: (id, u) => set(s => ({ wos: s.wos.map(w => w.id===id ? {...w,...u} : w) })),
}))

// ── MB Store ──────────────────────────────────────────────────
export const useMBStore = create((set) => ({
  mbs: [],
  loading: false,

  fetch: async () => {
    set({ loading: true })
    const data = await mbApi.list()
    set({ mbs: data || [], loading: false })
  },

  add: (mb) => set(s => ({ mbs: [mb, ...s.mbs] })),
  update: (id, u) => set(s => ({ mbs: s.mbs.map(m => m.id===id ? {...m,...u} : m) })),
}))

// ── User Store ────────────────────────────────────────────────
export const useUserStore = create((set) => ({
  users: [],
  loading: false,

  fetch: async () => {
    set({ loading: true })
    const data = await usersApi.list()
    set({ users: data || [], loading: false })
  },

  add: (u) => set(s => ({ users: [...s.users, u] })),
  update: (id, u) => set(s => ({ users: s.users.map(x => x.id===id ? {...x,...u} : x) })),
}))

// ── Group Store ───────────────────────────────────────────────
export const useGroupStore = create((set) => ({
  groups: [],
  loading: false,

  fetch: async () => {
    set({ loading: true })
    const data = await groupsApi.list()
    set({ groups: data || [], loading: false })
  },

  add: (g) => set(s => ({ groups: [g, ...s.groups] })),
  update: (id, u) => set(s => ({ groups: s.groups.map(g => g.id===id ? {...g,...u} : g) })),
  remove: (id) => set(s => ({ groups: s.groups.filter(g => g.id!==id) })),
}))

// ── UI Store (toasts, active tab, etc.) ──────────────────────
export const useUIStore = create((set) => ({
  activeTab: 'map',
  toasts: [],

  setTab: (tab) => set({ activeTab: tab }),

  toast: (msg, type = 'ok') => {
    const id = Date.now()
    set(s => ({ toasts: [...s.toasts, { id, msg, type }] }))
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3500)
  },

  // GPS state
  gpsCoords: null,
  gpsAcc: null,
  setGPS: (coords, acc) => set({ gpsCoords: coords, gpsAcc: acc }),
  clearGPS: () => set({ gpsCoords: null, gpsAcc: null }),
}))
