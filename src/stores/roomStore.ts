import { create } from 'zustand'
import type { RoomAgent, RoomMessage } from '../shared/types'
import { buildSongIntent, useStudioStore } from './studioStore'
import { useUiStore } from './uiStore'

interface RoomStore {
  open: boolean
  minimized: boolean
  busy: boolean
  agents: RoomAgent[]
  messages: RoomMessage[]
  error: string | null
  openRoom: () => Promise<void>
  send: (text: string) => Promise<void>
  applyFinal: (lyrics: string) => void
  closeRoom: () => Promise<void>
  minimizeRoom: () => void
  restoreRoom: () => void
  receiveMessage: (message: RoomMessage) => void
  receiveAgents: (agents: RoomAgent[]) => void
  activeAgent: RoomAgent | null
  receiveTyping: (agent: RoomAgent | null) => void
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  open: false,
  minimized: false,
  busy: false,
  agents: [],
  messages: [],
  error: null,
  activeAgent: null,

  openRoom: async () => {
    const s = useStudioStore.getState()
    set({ error: null, busy: true })
    try {
      const intent = buildSongIntent(s)
      const state = await window.doReMi.startWritersRoom({
        idea: intent.idea,
        tags: [...s.pickedGenres, ...s.pickedVibes, ...s.pickedVocals, ...s.pickedCustomTags],
        lyrics: s.blueprint?.lyrics || s.lyrics,
        caption: s.blueprint?.caption || '',
        intent,
      })
      set({
        open: true,
        minimized: false,
        agents: state.agents,
        messages: [{
          id: 'welcome',
          at: new Date().toISOString(),
          agentId: 'room',
          name: 'Room',
          emoji: '🎛️',
          kind: 'status',
          content: `The Producer is at the desk (${state.model}). Tell the room what you want — they can bring in specialists, search the web, and pitch lines until you're happy.`,
        }],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ error: message })
      useUiStore.getState().toast(message)
    } finally {
      set({ busy: false })
    }
  },

  send: async (text) => {
    if (!text.trim() || get().busy) return
    set({ busy: true, error: null })
    try {
      await window.doReMi.sendToWritersRoom(text.trim())
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ busy: false })
    }
  },

  applyFinal: (lyrics) => {
    const studio = useStudioStore.getState()
    if (studio.blueprint) {
      studio.patchBlueprint({ lyrics })
      void useStudioStore.getState().analyzeBlueprintLyrics()
    } else {
      studio.set({ lyrics, lyricsTab: 'write', vocalMode: 'vocals' })
      void useStudioStore.getState().analyzeBlueprintLyrics()
    }
    useUiStore.getState().toast('Room lyrics applied - review the quality check')
  },

  closeRoom: async () => {
    try { await window.doReMi.endWritersRoom() } catch { /* ignore */ }
    set({ open: false, minimized: false, agents: [], messages: [], busy: false, error: null, activeAgent: null })
  },
  minimizeRoom: () => set({ minimized: true }),
  restoreRoom: () => set({ open: true, minimized: false }),

  receiveMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  receiveAgents: (agents) => set({ agents }),
  receiveTyping: (agent) => set({ activeAgent: agent }),
}))
