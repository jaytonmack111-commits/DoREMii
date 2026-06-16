import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { ACE_STEP_DIR, UV_EXE } from './paths.js'
import { getSetting, setSetting } from './database.js'
import type { EngineSettings, LocalModelInfo, LmModelId, ModelHealthProbe, ResourceMode } from '../shared/types.js'

// Reference parity: ACE's own launcher ships with the 0.6B songwriter LM,
// which is what produced the known-good lyrics. Larger LMs stay selectable
// in Settings -> Models, but they are opt-in, not the default.
const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  preferredLmModel: 'acestep-5Hz-lm-0.6B',
  lmBackend: 'pt',
  lmOffloadToCpu: true,
  experimentalForce4B: false,
  // Fast-by-default: qwen3:4b fits alongside ACE without paging, so a blueprint
  // is ~1-2 calls instead of 20-40. Bigger models / deeper cook are opt-in.
  writerRoomModel: 'qwen3:4b',
  lyricWriterModel: 'qwen3:4b',
  ideaWriterModel: 'qwen3:4b',
  hookWriterModel: 'qwen3:4b',
  sectionWriterModel: 'qwen3:4b',
  criticModel: 'qwen3:4b',
  prosodyModel: 'qwen3:4b',
  finalCompilerModel: 'qwen3:4b',
  ollamaContextPreset: 'standard',
  lyricCookMode: 'fast',
  writerPipelineV2: true,
  resourceMode: 'keep_usable',
  fluxBackendPath: '',
  coverResolution: '768',
  coverStylePreset: 'auto',
  genreFusionEnabled: false,
  randomIdeaWeirdness: 35,
  lyricPlanningStrictness: 'strict',
}

const KNOWN_LM_MODELS: LmModelId[] = [
  'acestep-5Hz-lm-0.6B',
  'acestep-5Hz-lm-1.7B',
  'acestep-5Hz-lm-4B',
]

function checkpointsDir() {
  return path.join(ACE_STEP_DIR, 'checkpoints')
}

export function getEngineSettings(): EngineSettings {
  const settings = getSetting<EngineSettings>('engine', DEFAULT_ENGINE_SETTINGS)
  const merged: EngineSettings = {
    ...DEFAULT_ENGINE_SETTINGS,
    ...settings,
    preferredLmModel: KNOWN_LM_MODELS.includes(settings.preferredLmModel) ? settings.preferredLmModel : DEFAULT_ENGINE_SETTINGS.preferredLmModel,
    lmBackend: ['vllm', 'pt', 'mlx'].includes(settings.lmBackend) ? settings.lmBackend : DEFAULT_ENGINE_SETTINGS.lmBackend,
    writerRoomModel: settings.writerRoomModel || DEFAULT_ENGINE_SETTINGS.writerRoomModel,
    lyricWriterModel: settings.lyricWriterModel || DEFAULT_ENGINE_SETTINGS.lyricWriterModel,
    ideaWriterModel: settings.ideaWriterModel || settings.lyricWriterModel || DEFAULT_ENGINE_SETTINGS.ideaWriterModel,
    hookWriterModel: settings.hookWriterModel || DEFAULT_ENGINE_SETTINGS.hookWriterModel,
    sectionWriterModel: settings.sectionWriterModel || settings.lyricWriterModel || DEFAULT_ENGINE_SETTINGS.sectionWriterModel,
    criticModel: settings.criticModel || DEFAULT_ENGINE_SETTINGS.criticModel,
    prosodyModel: settings.prosodyModel || settings.lyricWriterModel || DEFAULT_ENGINE_SETTINGS.prosodyModel,
    finalCompilerModel: settings.finalCompilerModel || settings.lyricWriterModel || DEFAULT_ENGINE_SETTINGS.finalCompilerModel,
    ollamaContextPreset: ['standard', 'long', 'experimental'].includes(settings.ollamaContextPreset ?? '') ? settings.ollamaContextPreset : DEFAULT_ENGINE_SETTINGS.ollamaContextPreset,
    lyricCookMode: ['fast', 'standard', 'deep', 'unbounded'].includes(settings.lyricCookMode ?? '') ? settings.lyricCookMode : DEFAULT_ENGINE_SETTINGS.lyricCookMode,
    resourceMode: ['keep_usable', 'balanced', 'max_quality', 'manual'].includes(settings.resourceMode) ? settings.resourceMode : DEFAULT_ENGINE_SETTINGS.resourceMode,
    fluxBackendPath: settings.fluxBackendPath || DEFAULT_ENGINE_SETTINGS.fluxBackendPath,
    coverResolution: ['512', '768', '1024'].includes(settings.coverResolution) ? settings.coverResolution : DEFAULT_ENGINE_SETTINGS.coverResolution,
    coverStylePreset: ['auto', 'cinematic', 'graphic_poster', 'portrait', 'abstract', 'object_still_life'].includes(settings.coverStylePreset) ? settings.coverStylePreset : DEFAULT_ENGINE_SETTINGS.coverStylePreset,
    genreFusionEnabled: Boolean(settings.genreFusionEnabled),
    randomIdeaWeirdness: Math.max(0, Math.min(100, Number(settings.randomIdeaWeirdness ?? DEFAULT_ENGINE_SETTINGS.randomIdeaWeirdness))),
    lyricPlanningStrictness: ['relaxed', 'normal', 'strict', 'pro'].includes(settings.lyricPlanningStrictness) ? settings.lyricPlanningStrictness : DEFAULT_ENGINE_SETTINGS.lyricPlanningStrictness,
  }
  // One-time migration: older installs saved the slow pipeline (unbounded cook,
  // 14b critic/hook, 32k context) which made blueprints take 30+ minutes.
  // Reset the whole writer block to the fast-by-default pipeline once.
  if (!('writerPipelineV2' in (settings as unknown as Record<string, unknown>))) {
    const migrated: EngineSettings = {
      ...merged,
      writerRoomModel: 'qwen3:4b',
      lyricWriterModel: 'qwen3:4b',
      ideaWriterModel: 'qwen3:4b',
      hookWriterModel: 'qwen3:4b',
      sectionWriterModel: 'qwen3:4b',
      criticModel: 'qwen3:4b',
      prosodyModel: 'qwen3:4b',
      finalCompilerModel: 'qwen3:4b',
      ollamaContextPreset: 'standard',
      lyricCookMode: 'fast',
      experimentalForce4B: false,
      writerPipelineV2: true,
    }
    return setSetting('engine', migrated)
  }
  return merged
}

export function updateEngineSettings(patch: Partial<EngineSettings>): EngineSettings {
  const next = { ...getEngineSettings(), ...patch }
  return setSetting('engine', next)
}

export function setResourceMode(mode: ResourceMode): EngineSettings {
  return updateEngineSettings({ resourceMode: mode })
}

function directorySize(root: string) {
  try {
    if (!fs.existsSync(root)) return 0
    let total = 0
    const stack = [root]
    while (stack.length) {
      const dir = stack.pop()!
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else total += fs.statSync(full).size
      }
    }
    return total
  } catch {
    return 0
  }
}

function sizeLabel(bytes: number) {
  if (!bytes) return 'Not found'
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

function modelPath(model: string) {
  return path.join(checkpointsDir(), model)
}

export function listLocalModels(loadedModel: string | null, loadedLmModel: string | null): LocalModelInfo[] {
  const settings = getEngineSettings()
  const lmPath = modelPath(settings.preferredLmModel)
  const ditModel = loadedModel || 'acestep-v15-turbo'
  const rows: LocalModelInfo[] = [
    {
      id: 'songwriter-lm',
      role: 'Songwriter / Lyric Planner',
      currentModel: loadedLmModel || 'Not loaded yet',
      preferredModel: settings.preferredLmModel,
      loaded: Boolean(loadedLmModel),
      diskPath: lmPath,
      exists: fs.existsSync(lmPath),
      sizeLabel: sizeLabel(directorySize(lmPath)),
      backend: settings.lmBackend,
      device: 'auto',
      offload: settings.lmOffloadToCpu ? 'CPU offload enabled' : 'GPU only',
      affects: 'Lyrics, prompt expansion, blueprint metadata, thinking mode planning',
      editable: true,
      warning: settings.preferredLmModel.includes('4B') ? 'Largest LM. It may load slowly and may fall back if ACE refuses it.' : null,
    },
    {
      id: 'dit',
      role: 'Audio Generator / DiT',
      currentModel: ditModel,
      preferredModel: ditModel,
      loaded: Boolean(loadedModel),
      diskPath: modelPath(ditModel),
      exists: fs.existsSync(modelPath(ditModel)),
      sizeLabel: sizeLabel(directorySize(modelPath(ditModel))),
      backend: 'PyTorch',
      device: 'auto',
      offload: settings.lmOffloadToCpu ? 'Auto offload available' : 'Default',
      affects: 'Main beat, arrangement, vocals, instruments, and final audio generation',
      editable: false,
      warning: null,
    },
    {
      id: 'text-encoder',
      role: 'Text Encoder',
      currentModel: 'Qwen3-Embedding-0.6B',
      preferredModel: 'Qwen3-Embedding-0.6B',
      loaded: fs.existsSync(modelPath('Qwen3-Embedding-0.6B')),
      diskPath: modelPath('Qwen3-Embedding-0.6B'),
      exists: fs.existsSync(modelPath('Qwen3-Embedding-0.6B')),
      sizeLabel: sizeLabel(directorySize(modelPath('Qwen3-Embedding-0.6B'))),
      backend: 'PyTorch',
      device: 'auto',
      offload: 'Engine managed',
      affects: 'Turns captions and lyrics into conditioning embeddings',
      editable: false,
      warning: null,
    },
    {
      id: 'vae',
      role: 'Audio VAE / Tokenizer',
      currentModel: 'vae',
      preferredModel: 'vae',
      loaded: fs.existsSync(modelPath('vae')),
      diskPath: modelPath('vae'),
      exists: fs.existsSync(modelPath('vae')),
      sizeLabel: sizeLabel(directorySize(modelPath('vae'))),
      backend: 'PyTorch',
      device: 'auto',
      offload: 'Engine managed',
      affects: 'Audio latent encoding and decoding',
      editable: false,
      warning: null,
    },
    {
      id: 'lora-training',
      role: 'LoRA / Style Adapters',
      currentModel: 'No adapter selected',
      preferredModel: null,
      loaded: false,
      diskPath: path.join(ACE_STEP_DIR, 'loras'),
      exists: fs.existsSync(path.join(ACE_STEP_DIR, 'loras')),
      sizeLabel: 'Optional',
      backend: 'Training tools',
      device: 'GPU / CPU offload',
      offload: 'Separate adapters only',
      affects: 'Future personal style tuning without overwriting base models',
      editable: true,
      warning: 'Training features should save adapters separately from base checkpoints.',
    },
  ]
  return rows
}

export async function openModelFolder(modelId: string) {
  const settings = getEngineSettings()
  const target = modelId === 'songwriter-lm' ? modelPath(settings.preferredLmModel) : modelPath(modelId)
  await shell.openPath(fs.existsSync(target) ? target : checkpointsDir())
}

export function downloadModel(modelId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(UV_EXE, ['run', '--no-sync', 'acestep-download', '--model', modelId], {
      cwd: ACE_STEP_DIR,
      windowsHide: true,
      env: process.env,
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(output.trim() || `${modelId} download/check completed.`)
      else reject(new Error(output.trim() || `${modelId} download failed with code ${code}`))
    })
  })
}

async function probeOllama(model: string): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model,
        prompt: 'Reply with READY only.',
        stream: false,
        keep_alive: '30s',
        options: { num_predict: 8, temperature: 0 },
      }),
    })
    if (!response.ok) return { ok: false, message: `Ollama HTTP ${response.status}` }
    const body = await response.json() as { response?: string; error?: string }
    if (body.error) return { ok: false, message: body.error }
    return { ok: true, message: body.response?.trim() || 'Model responded.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function test4BModels(loadedLmModel: string | null): Promise<ModelHealthProbe[]> {
  const acePath = modelPath('acestep-5Hz-lm-4B')
  const aceInstalled = fs.existsSync(acePath)
  const qwen = await probeOllama('qwen3:4b')
  const qwen25 = await probeOllama('qwen2.5:1.5b')
  return [
    {
      id: 'acestep-5Hz-lm-4B',
      role: 'ACE 5Hz music planner LM',
      installed: aceInstalled,
      loadable: aceInstalled,
      currentlyLoaded: loadedLmModel === 'acestep-5Hz-lm-4B',
      failedLastRun: !aceInstalled,
      fallbackActive: loadedLmModel !== null && loadedLmModel !== 'acestep-5Hz-lm-4B',
      message: aceInstalled
        ? loadedLmModel === 'acestep-5Hz-lm-4B'
          ? '4B is currently loaded by ACE.'
          : '4B is on disk. Reload/restart ACE to test actual load.'
        : `Missing folder: ${acePath}`,
    },
    {
      id: 'qwen3:4b',
      role: 'Ollama lightweight chat/planning model',
      installed: qwen.ok || !/not found|pull/i.test(qwen.message),
      loadable: qwen.ok,
      currentlyLoaded: qwen.ok,
      failedLastRun: !qwen.ok,
      fallbackActive: !qwen.ok,
      message: qwen.ok ? 'qwen3:4b responded to a live probe.' : qwen.message,
    },
    {
      id: 'qwen2.5:1.5b',
      role: 'Ollama tiny helper / fallback writer',
      installed: qwen25.ok || !/not found|pull/i.test(qwen25.message),
      loadable: qwen25.ok,
      currentlyLoaded: qwen25.ok,
      failedLastRun: !qwen25.ok,
      fallbackActive: !qwen25.ok,
      message: qwen25.ok ? 'qwen2.5:1.5b responded to a live probe.' : qwen25.message,
    },
  ]
}
