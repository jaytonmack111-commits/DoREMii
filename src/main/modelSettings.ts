import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { ACE_STEP_DIR, UV_EXE } from './paths.js'
import { getSetting, setSetting } from './database.js'
import type { EngineSettings, LocalModelInfo, LmModelId } from '../shared/types.js'

// Reference parity: ACE's own launcher ships with the 0.6B songwriter LM,
// which is what produced the known-good lyrics. Larger LMs stay selectable
// in Settings -> Models, but they are opt-in, not the default.
const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  preferredLmModel: 'acestep-5Hz-lm-0.6B',
  lmBackend: 'pt',
  lmOffloadToCpu: true,
  experimentalForce4B: false,
  writerRoomModel: 'qwen3:4b',
  lyricWriterModel: 'qwen3:8b',
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
  }
  // One-time migration: the old build force-defaulted the experimental 4B LM.
  // Reset those installs to the reference 0.6B; explicit user picks (made
  // after this flag clears) are respected.
  if (merged.experimentalForce4B) {
    const migrated: EngineSettings = { ...merged, preferredLmModel: 'acestep-5Hz-lm-0.6B', lyricWriterModel: 'qwen3:8b', experimentalForce4B: false }
    return setSetting('engine', migrated)
  }
  if (merged.lyricWriterModel === 'qwen3:14b') {
    return setSetting('engine', { ...merged, lyricWriterModel: 'qwen3:8b' })
  }
  return merged
}

export function updateEngineSettings(patch: Partial<EngineSettings>): EngineSettings {
  const next = { ...getEngineSettings(), ...patch }
  return setSetting('engine', next)
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
