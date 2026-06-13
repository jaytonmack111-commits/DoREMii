import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { DoReMiApi, RoomAgent, WriterProgressEvent } from '../shared/types.js'

const api: DoReMiApi = {
  setZoom: (factor: number) => {
    try {
      webFrame.setZoomFactor(factor)
    } catch {
      // ignore
    }
  },
  runSetupCheck: () => ipcRenderer.invoke('setup:runCheck'),
  getEngineStatus: () => ipcRenderer.invoke('engine:status'),
  startEngine: () => ipcRenderer.invoke('engine:start'),
  stopEngine: () => ipcRenderer.invoke('engine:stop'),
  restartEngine: () => ipcRenderer.invoke('engine:restart'),
  cleanupLocalWorkers: () => ipcRenderer.invoke('engine:cleanupWorkers'),
  getEngineLogs: () => ipcRenderer.invoke('engine:logs'),
  getEngineSettings: () => ipcRenderer.invoke('engine:settings:get'),
  updateEngineSettings: (settings) => ipcRenderer.invoke('engine:settings:update', settings),
  getLocalModels: () => ipcRenderer.invoke('engine:models:list'),
  reloadPreferredLm: () => ipcRenderer.invoke('engine:lm:reload'),
  openModelFolder: (modelId) => ipcRenderer.invoke('engine:model:openFolder', modelId),
  downloadModel: (modelId) => ipcRenderer.invoke('engine:model:download', modelId),
  searchLibrary: () => ipcRenderer.invoke('library:search'),
  renameSong: (id, title) => ipcRenderer.invoke('library:rename', id, title),
  toggleSongFavorite: (id) => ipcRenderer.invoke('library:favorite', id),
  deleteSong: (id) => ipcRenderer.invoke('library:delete', id),
  showSongInFolder: (id) => ipcRenderer.invoke('library:showInFolder', id),
  getPresets: () => ipcRenderer.invoke('presets:list'),
  getLicenses: () => ipcRenderer.invoke('licenses:list'),
  createGeneration: (request) => ipcRenderer.invoke('generation:create', request),
  createBlueprint: (request) => ipcRenderer.invoke('generation:blueprint', request),
  formatInput: (input) => ipcRenderer.invoke('generation:formatInput', input),
  pollGeneration: (aceTaskId, meta) => ipcRenderer.invoke('generation:poll', aceTaskId, meta),
  getWriterAvailability: () => ipcRenderer.invoke('writer:availability'),
  listWriterModels: () => ipcRenderer.invoke('writer:models'),
  pullOllamaModel: (model) => ipcRenderer.invoke('writer:pullModel', model),
  analyzeLyrics: (input) => ipcRenderer.invoke('writer:analyzeLyrics', input),
  rewriteLyrics: (input) => ipcRenderer.invoke('writer:rewriteLyrics', input),
  startWritersRoom: (input) => ipcRenderer.invoke('room:start', input),
  sendToWritersRoom: (text) => ipcRenderer.invoke('room:send', text),
  endWritersRoom: () => ipcRenderer.invoke('room:end'),
  onRoomMessage: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, message: Parameters<typeof handler>[0]) => handler(message)
    ipcRenderer.on('room:message', listener)
    return () => ipcRenderer.removeListener('room:message', listener)
  },
  onRoomAgents: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, agents: RoomAgent[]) => callback(agents)
    ipcRenderer.on('room:agents', handler)
    return () => { ipcRenderer.off('room:agents', handler) }
  },
  onRoomTyping: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, agent: RoomAgent | null) => callback(agent)
    ipcRenderer.on('room:typing', handler)
    return () => { ipcRenderer.off('room:typing', handler) }
  },
  onWriterProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: string | WriterProgressEvent) => {
      callback(typeof payload === 'string' ? { stage: payload } : payload)
    }
    ipcRenderer.on('writer:progress', handler)
    return () => { ipcRenderer.off('writer:progress', handler) }
  },
  craftLyrics: (input) => ipcRenderer.invoke('writer:craftLyrics', input),
  enhanceText: (input) => ipcRenderer.invoke('writer:enhanceText', input),
  suggestTitle: (input) => ipcRenderer.invoke('writer:suggestTitle', input),
  generateConcept: (input) => ipcRenderer.invoke('writer:generateConcept', input),
  generateConceptIdea: (input) => ipcRenderer.invoke('writer:generateConceptIdea', input),
  generateStyleForIdea: (input) => ipcRenderer.invoke('writer:generateStyleForIdea', input),
  getConductorState: () => ipcRenderer.invoke('conductor:state'),
  onConductorState: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: 'idle' | 'writer' | 'engine') => callback(state)
    ipcRenderer.on('conductor:state', handler)
    return () => { ipcRenderer.off('conductor:state', handler) }
  },
}

contextBridge.exposeInMainWorld('doReMi', api)
