import { app, BrowserWindow, ipcMain, net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { engineManager } from './engineManager.js'
import { runSetupCheck } from './setup.js'
import { deleteSong, getDatabase, listLicenses, listPresets, listSongs, renameSong, showSongInFolder, toggleSongFavorite } from './database.js'
import { createBlueprint, createGeneration, formatWithEngine, pollGeneration } from './generationService.js'
import { downloadModel, getEngineSettings, listLocalModels, openModelFolder, updateEngineSettings } from './modelSettings.js'
import { analyzeLyrics, craftLyrics, enhanceText, generateConcept, generateConceptIdea, generateStyleForIdea, isWriterAvailable, listWriterModels, pullOllamaModel, rewriteLyrics, suggestTitle } from './ollamaService.js'
import { endRoom, sendToRoom, startRoom } from './writersRoomService.js'
import { beginEngineJob, endEngineJob, getConductorState, sleepOllama, withWriter } from './aiConductor.js'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
let quitCleanupStarted = false

app.setName('DoReMi')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'doremi-media',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true },
  },
])

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 760,
    title: 'DoReMii',
    backgroundColor: '#10131a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL!)
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer:gone] ${details.reason}`)
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[renderer:load-failed] ${code} ${description} ${url}`)
  })
}

app.whenReady().then(async () => {
  getDatabase()
  await runSetupCheck()

  protocol.handle('doremi-media', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.searchParams.get('path') ?? '')
    return net.fetch(pathToFileURL(filePath).toString())
  })

  ipcMain.handle('setup:runCheck', () => runSetupCheck())
  ipcMain.handle('engine:status', () => engineManager.refreshHealth())
  ipcMain.handle('engine:start', () => engineManager.start())
  ipcMain.handle('engine:stop', () => engineManager.stop())
  ipcMain.handle('engine:restart', () => engineManager.forceRestart())
  ipcMain.handle('engine:cleanupWorkers', () => engineManager.shutdown())
  ipcMain.handle('engine:logs', () => engineManager.getLogs())
  ipcMain.handle('engine:settings:get', () => getEngineSettings())
  ipcMain.handle('engine:settings:update', (_event, patch) => updateEngineSettings(patch))
  ipcMain.handle('engine:models:list', () => {
    const status = engineManager.getStatus()
    return listLocalModels(status.loadedModel, status.loadedLmModel)
  })
  ipcMain.handle('engine:lm:reload', () => engineManager.reloadPreferredLm())
  ipcMain.handle('engine:model:openFolder', (_event, modelId) => openModelFolder(modelId))
  ipcMain.handle('engine:model:download', (_event, modelId) => downloadModel(modelId))
  ipcMain.handle('library:search', () => listSongs())
  ipcMain.handle('library:rename', (_event, id, title) => renameSong(id, title))
  ipcMain.handle('library:favorite', (_event, id) => toggleSongFavorite(id))
  ipcMain.handle('library:delete', (_event, id) => deleteSong(id))
  ipcMain.handle('library:showInFolder', (_event, id) => showSongInFolder(id))
  ipcMain.handle('presets:list', () => listPresets())
  ipcMain.handle('licenses:list', () => listLicenses())
  // Generation owns the GPU: sleep Ollama first, release it when a poll ends.
  ipcMain.handle('generation:create', async (_event, request) => {
    await beginEngineJob()
    try {
      return await createGeneration(request)
    } catch (error) {
      endEngineJob()
      throw error
    }
  })
  ipcMain.handle('generation:blueprint', (_event, request) => withWriter(() => createBlueprint(request)))
  ipcMain.handle('generation:formatInput', (_event, input) => formatWithEngine(input))
  ipcMain.handle('generation:poll', async (_event, aceTaskId, meta) => {
    const result = await pollGeneration(aceTaskId, meta)
    if (result.status === 'succeeded' || result.status === 'failed') endEngineJob()
    return result
  })
  ipcMain.handle('generation:releaseEngineJob', () => endEngineJob())
  ipcMain.handle('writer:availability', () => isWriterAvailable())
  ipcMain.handle('writer:models', () => listWriterModels())
  ipcMain.handle('writer:pullModel', (_event, model) => pullOllamaModel(model))
  ipcMain.handle('writer:analyzeLyrics', (_event, input) => withWriter(() => analyzeLyrics(input)))
  ipcMain.handle('writer:rewriteLyrics', (_event, input) => withWriter(() => rewriteLyrics(input)))
  ipcMain.handle('room:start', (_event, input) => startRoom(input))
  ipcMain.handle('room:send', (event, text) => sendToRoom(event.sender, text))
  ipcMain.handle('room:end', () => endRoom())
  ipcMain.handle('writer:craftLyrics', (_event, input) => withWriter(() => craftLyrics(input)))
  ipcMain.handle('writer:enhanceText', (_event, input) => withWriter(() => enhanceText(input)))
  ipcMain.handle('writer:suggestTitle', (_event, input) => withWriter(() => suggestTitle(input)))
  ipcMain.handle('writer:generateConcept', (_event, input) => withWriter(() => generateConcept(input)))
  ipcMain.handle('writer:generateConceptIdea', (_event, input) => withWriter(() => generateConceptIdea(input)))
  ipcMain.handle('writer:generateStyleForIdea', (_event, input) => withWriter(() => generateStyleForIdea(input)))
  ipcMain.handle('conductor:state', () => getConductorState())

  createWindow()

  // Model loading takes a minute or more, so warm the engine up immediately at
  // launch instead of waiting for the user to press a button and then wait.
  void engineManager.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitCleanupStarted) return
  quitCleanupStarted = true
  event.preventDefault()
  void Promise.resolve()
    .then(() => sleepOllama())
    .then(() => engineManager.shutdown())
    .finally(() => app.quit())
})
