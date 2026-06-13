import { create } from 'zustand'
import type { ConductorState, EngineStatus, SetupCheckResult, SongVersion } from '../shared/types'
import { useUiStore } from './uiStore'

const defaultEngine: EngineStatus = {
  state: 'stopped',
  pid: null,
  port: 8001,
  health: 'unknown',
  loadedModel: null,
  loadedLmModel: null,
  queueSize: null,
  lastLogLine: null,
  lastError: null,
  startedByDoReMi: false,
}

interface AppStore {
  engine: EngineStatus
  setup: SetupCheckResult | null
  songs: SongVersion[]
  logs: string[]
  busy: boolean
  conductor: ConductorState
  setSongs: (songs: SongVersion[]) => void
  pushLog: (line: string) => void
  refreshAll: () => Promise<void>
  refreshLibrary: () => Promise<void>
  renameSong: (id: string, title: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  deleteSong: (id: string) => Promise<void>
  showInFolder: (id: string) => Promise<void>
  startEngine: () => Promise<void>
  stopEngine: () => Promise<void>
  restartEngine: () => Promise<void>
}

export const useAppStore = create<AppStore>((set) => ({
  engine: defaultEngine,
  setup: null,
  songs: [],
  logs: [],
  busy: false,
  conductor: 'idle',
  setSongs: (songs) => set({ songs }),
  pushLog: (line) => set((s) => ({ logs: [line, ...s.logs] })),
  refreshAll: async () => {
    const [setup, engine, songs, logs] = await Promise.all([
      window.doReMi.runSetupCheck(),
      window.doReMi.getEngineStatus(),
      window.doReMi.searchLibrary(),
      window.doReMi.getEngineLogs(),
    ])
    set({ setup, engine, songs, logs })
  },
  refreshLibrary: async () => {
    set({ songs: await window.doReMi.searchLibrary() })
  },
  renameSong: async (id, title) => {
    set({ songs: await window.doReMi.renameSong(id, title) })
    useUiStore.getState().toast('Track renamed')
  },
  toggleFavorite: async (id) => {
    set({ songs: await window.doReMi.toggleSongFavorite(id) })
  },
  deleteSong: async (id) => {
    set({ songs: await window.doReMi.deleteSong(id) })
    useUiStore.getState().setDetail(null)
    useUiStore.getState().toast('Track deleted')
  },
  showInFolder: async (id) => {
    await window.doReMi.showSongInFolder(id)
  },
  startEngine: async () => {
    set({ busy: true })
    useUiStore.getState().toast('Starting engine - loading local models in the background...')
    try {
      const status = await window.doReMi.startEngine()
      set({ engine: status, logs: await window.doReMi.getEngineLogs() })
      if (status.state === 'error') useUiStore.getState().toast(status.lastError || 'Engine failed to start - see logs')
    } finally {
      set({ busy: false })
    }
  },
  stopEngine: async () => {
    set({ busy: true })
    try {
      set({ engine: await window.doReMi.stopEngine(), logs: await window.doReMi.getEngineLogs() })
    } finally {
      set({ busy: false })
    }
  },
  restartEngine: async () => {
    set({ busy: true })
    useUiStore.getState().toast('Restarting the engine - killing any stuck process and booting fresh...')
    try {
      const status = await window.doReMi.restartEngine()
      set({ engine: status, logs: await window.doReMi.getEngineLogs() })
      if (status.state === 'error') useUiStore.getState().toast(status.lastError || 'Engine restart failed - see logs')
    } finally {
      set({ busy: false })
    }
  },
}))

let engineWatcher: number | undefined

export function initApp() {
  const store = useAppStore.getState()
  void store.refreshAll().then(() => {
    const { engine } = useAppStore.getState()
    if (engine.state === 'stopped' || engine.health === 'unknown' || engine.health === 'unreachable') {
      void useAppStore.getState().startEngine()
    }
  })
  window.clearInterval(engineWatcher)
  engineWatcher = window.setInterval(() => {
    void window.doReMi.getEngineStatus().then((engine) => useAppStore.setState({ engine }))
  }, 4000)

  // VRAM conductor: reflect which AI brain is active.
  void window.doReMi.getConductorState().then((conductor) => useAppStore.setState({ conductor }))
  window.doReMi.onConductorState((conductor) => useAppStore.setState({ conductor }))
}
