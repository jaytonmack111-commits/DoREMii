import { create } from 'zustand'
import type { SongVersion } from '../shared/types'

export type RouteId = 'home' | 'explore' | 'studio' | 'library' | 'favorites' | 'labs' | 'settings'

interface UiState {
  route: RouteId
  collapsed: boolean
  showThemes: boolean
  showSetup: boolean
  showLogs: boolean
  detail: SongVersion | null
  toastMsg: string | null
  setRoute: (route: RouteId) => void
  toggleCollapsed: () => void
  setShowThemes: (open: boolean) => void
  setShowSetup: (open: boolean) => void
  toggleLogs: () => void
  setDetail: (song: SongVersion | null) => void
  toast: (message: string) => void
  soon: (name: string) => void
}

let toastTimer: number | undefined

export const useUiStore = create<UiState>((set) => ({
  route: 'home',
  collapsed: false,
  showThemes: false,
  showSetup: false,
  showLogs: false,
  detail: null,
  toastMsg: null,
  setRoute: (route) => set({ route }),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
  setShowThemes: (showThemes) => set({ showThemes }),
  setShowSetup: (showSetup) => set({ showSetup }),
  toggleLogs: () => set((s) => ({ showLogs: !s.showLogs })),
  setDetail: (detail) => set({ detail }),
  toast: (message) => {
    set({ toastMsg: message })
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => set({ toastMsg: null }), 2400)
  },
  soon: (name) => {
    set({ toastMsg: `${name} — coming in a later pass` })
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => set({ toastMsg: null }), 2400)
  },
}))
