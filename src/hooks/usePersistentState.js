import { useState, useEffect, useCallback } from 'react'

/**
 * Like useState but persists to localStorage.
 * State survives tab switches, page refreshes, and app restarts.
 * Call clear() to wipe it — typically on save or discard.
 */
export function usePersistentState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return initialValue
      return JSON.parse(raw)
    } catch {
      return initialValue
    }
  })

  // Sync to localStorage on every change
  useEffect(() => {
    try {
      if (state === null || state === undefined ||
          (typeof state === 'object' && !Array.isArray(state) && Object.keys(state).length === 0) ||
          (Array.isArray(state) && state.length === 0 && initialValue !== undefined && !Array.isArray(initialValue))) {
        // Don't persist empty defaults — let them be treated as "no draft"
        // But DO persist empty arrays and objects if they're the initial value
      }
      localStorage.setItem(key, JSON.stringify(state))
    } catch(e) { console.warn('Persist state failed:', e) }
  }, [key, state])

  const clear = useCallback(() => {
    localStorage.removeItem(key)
    setState(initialValue)
  }, [key, initialValue])

  return [state, setState, clear]
}

/**
 * Simpler version — persists a whole session object under one key.
 * Useful for complex multi-field survey state.
 */
export function usePersistentSession(key, defaults) {
  const [session, setSessionRaw] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return { ...defaults, _persisted: false }
      const parsed = JSON.parse(raw)
      return { ...defaults, ...parsed, _persisted: true }
    } catch {
      return { ...defaults, _persisted: false }
    }
  })

  function setSession(updates) {
    setSessionRaw(prev => {
      const next = typeof updates === 'function' ? updates(prev) : { ...prev, ...updates }
      try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
      return next
    })
  }

  function clearSession() {
    localStorage.removeItem(key)
    setSessionRaw({ ...defaults, _persisted: false })
  }

  const hasDraft = session._persisted === true

  return { session, setSession, clearSession, hasDraft }
}
