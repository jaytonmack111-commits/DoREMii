import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  BlueprintResult,
  GenerationPollResult,
  GenerationRequest,
  GenerationTask,
  ModeType,
  PerformancePreset,
  SongVersion,
} from '../shared/types.js'
import { DEFAULT_ENGINE_PORT, getDoReMiPaths } from './paths.js'
import { insertGenerationTask, insertSong, updateGenerationTask } from './database.js'
import { getEngineSettings } from './modelSettings.js'
import { engineManager } from './engineManager.js'

/** Throw a human-readable error instead of letting a raw fetch fail when the
 *  engine isn't up. Every ACE-facing entry point calls this first. */
function requireEngine(action: string) {
  const status = engineManager.getStatus()
  if (status.health === 'ready') return
  const why = status.state === 'starting'
    ? 'it is still warming up - models are loading'
    : status.state === 'error'
      ? `it hit an error (${status.lastError || 'unknown'})`
      : 'it is not running'
  throw new Error(`Can't ${action} yet: the engine isn't ready (${why}). Watch the engine pill up top - click it to restart if it's stuck.`)
}

/** Translate low-level fetch failures into something a musician can read. */
function friendlyEngineError(error: unknown, action: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/fetch failed|ECONNREFUSED|ECONNRESET|socket|network/i.test(message)) {
    return new Error(`Lost the connection to the engine while trying to ${action} - it may have crashed mid-request. Click the engine pill to restart it.`)
  }
  return error instanceof Error ? error : new Error(message)
}

const BASE_URL = `http://127.0.0.1:${DEFAULT_ENGINE_PORT}`

type ApiEnvelope<T> = {
  data?: T
  code?: number
  error?: string | null
  detail?: string
}

type BlueprintApiData = {
  caption?: string
  lyrics?: string
  bpm?: number | null
  keyscale?: string
  key_scale?: string
  duration?: number | null
  timesignature?: string
  time_signature?: string
  vocal_language?: string
  instrumental?: boolean
}

type ReleaseTaskData = {
  task_id?: string
  status?: string
}

type QueryResultEntry = {
  status?: number | string
  progress_text?: string | null
  result?: string
}

type QueryResultBody = ApiEnvelope<QueryResultEntry[]>

type AceResultEntry = {
  file?: string
  progress?: number
  error?: string
  prompt?: string
  lyrics?: string
  metas?: {
    duration?: number
    bpm?: number
    keyscale?: string
  }
}

const taskTypeByMode: Record<ModeType, string> = {
  simple: 'text2music',
  instrumental: 'text2music',
  lyrics: 'text2music',
  remix: 'remix',
  repaint: 'repaint',
  cover: 'cover',
  extend: 'extend',
  complete: 'complete',
  extract: 'extract',
}

const performanceSettings: Record<PerformancePreset, { inference_steps: number; thinking: boolean; audio_duration: number }> = {
  fast_draft: { inference_steps: 8, thinking: false, audio_duration: 60 },
  balanced: { inference_steps: 12, thinking: true, audio_duration: 120 },
  high_quality: { inference_steps: 20, thinking: true, audio_duration: 180 },
  experimental: { inference_steps: 28, thinking: true, audio_duration: 240 },
}

function durationFromRequest(request: GenerationRequest) {
  if (request.durationMode === 'auto') {
    if (request.mode === 'instrumental') return 60
    const sectionCount = Math.max(request.structure.length, 1)
    return Math.min(480, Math.max(30, sectionCount * 35))
  }
  if (Number.isFinite(request.durationMin) && Number.isFinite(request.durationMax)) {
    return Math.max(0.1, (request.durationMin + request.durationMax) / 2)
  }
  return request.duration
}

function aceDurationFromRequest(request: GenerationRequest) {
  return Math.min(480, Math.max(10, durationFromRequest(request)))
}

function normalizeLanguage(request: GenerationRequest) {
  if (request.mode === 'instrumental') return 'en'
  if (request.language === 'custom') return 'en'
  if (request.language === 'instrumental') return 'en'
  return request.language || 'en'
}

function buildAcePayload(request: GenerationRequest) {
  const settings = performanceSettings[request.performancePreset]
  const engineSettings = getEngineSettings()
  const blueprint = request.blueprint
  const instrumentalPrompt = request.mode === 'instrumental'
    ? `${request.prompt}\nInstrumental only. No singing. No spoken vocals.`
    : (blueprint?.caption || request.prompt)

  return {
    prompt: instrumentalPrompt,
    lyrics: request.mode === 'instrumental' ? '[Instrumental]' : (request.lyrics || blueprint?.lyrics || ''),
    track_name: request.title,
    task_type: taskTypeByMode[request.mode],
    vocal_language: normalizeLanguage(request),
    audio_duration: aceDurationFromRequest(request) || settings.audio_duration,
    batch_size: request.batchSize,
    inference_steps: request.inferenceSteps ?? settings.inference_steps,
    guidance_scale: request.guidanceScale ?? undefined,
    thinking: settings.thinking,
    seed: request.seed ?? -1,
    use_random_seed: request.seed == null,
    model: request.model,
    lm_model_path: engineSettings.preferredLmModel,
    lm_backend: engineSettings.lmBackend,
    audio_format: 'mp3',
    use_cot_language: false,
    // Our lyrics are already written, critiqued, and engine-formatted upstream.
    // use_format would hand them to the 0.6B LM to rewrite at the last moment,
    // silently undoing the whole writer pipeline - keep it OFF.
    use_format: false,
    // Keep the caption too: CoT caption rewriting can drift the style away
    // from the blueprint the user approved.
    use_cot_caption: !request.blueprint,
    constrained_decoding: request.constrainedDecoding ?? true,
    // Tame the 5Hz LM's repetition spirals (its default penalty is 1.0 = off).
    lm_repetition_penalty: request.repetitionPenalty ?? 1.15,
    lm_temperature: request.lmTemperature ?? 0.85,
    lm_top_p: request.lmTopP ?? 0.9,
    // Blueprint metadata the user saw and accepted wins over LM auto-fill.
    bpm: blueprint?.bpm ?? undefined,
    key_scale: blueprint?.keyscale || undefined,
    lm_negative_prompt: request.negativePrompt || 'wrong language, muddy mix, distorted vocals, low clarity',
    src_audio_path: request.sourceAudioPath,
  }
}

export interface FormatInputResult {
  caption: string
  lyrics: string
  bpm: number | null
  keyscale: string
  timesignature: string
  duration: number | null
  vocalLanguage: string
}

/** ACE's /format_input: the engine LM harmonizes caption + metadata around the
 *  given lyrics so caption and lyrics stop contradicting each other. We adopt
 *  its caption/BPM/key/duration but NEVER its lyrics rewrite. */
export async function formatWithEngine(input: { caption: string; lyrics: string; duration?: number; language?: string }): Promise<FormatInputResult | null> {
  try {
    const response = await fetch(`${BASE_URL}/format_input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: input.caption,
        lyrics: input.lyrics,
        temperature: 0.85,
        param_obj: JSON.stringify({
          duration: input.duration ?? undefined,
          language: input.language || 'en',
        }),
      }),
    })
    if (!response.ok) return null
    const body = await response.json() as {
      data?: {
        caption?: string
        bpm?: number
        key_scale?: string
        keyscale?: string
        time_signature?: string
        timesignature?: string
        duration?: number
        vocal_language?: string
      }
    }
    const data = body.data ?? {}
    return {
      caption: data.caption || input.caption,
      lyrics: input.lyrics,
      bpm: typeof data.bpm === 'number' ? data.bpm : null,
      keyscale: data.key_scale || data.keyscale || '',
      timesignature: data.time_signature || data.timesignature || '',
      duration: typeof data.duration === 'number' ? data.duration : null,
      vocalLanguage: data.vocal_language || input.language || 'en',
    }
  } catch {
    return null
  }
}

/** True when "lyrics" are only section headers / instrument tags with no real sung words. */
function lyricsAreJustTags(lyrics: string) {
  const words = lyrics
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}' ]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1)
  return words.length < 12
}

async function requestSample(query: string, instrumental: boolean, vocalLanguage: string) {
  const response = await fetch(`${BASE_URL}/v1/create_sample`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      instrumental,
      vocal_language: vocalLanguage || 'en',
      // Gradio reference parity: temperature 0.85 with nucleus sampling 0.9.
      // top_p needs the DoReMii patch to sample_format_routes.py; without it
      // the field is ignored harmlessly.
      temperature: 0.85,
      top_p: 0.9,
    }),
  })
  const body = await response.json() as ApiEnvelope<BlueprintApiData>
  if (!response.ok || body.error || (body.code && body.code >= 400)) {
    throw new Error(body.error || body.detail || `Blueprint failed with HTTP ${response.status}`)
  }
  return body
}

export async function createBlueprint(input: {
  query: string
  instrumental: boolean
  vocalLanguage: string
  tags: string[]
}): Promise<BlueprintResult> {
  requireEngine('generate a blueprint')
  const settings = getEngineSettings()
  // The 5Hz LM is a fine-tuned expander, not an instruction-following chat
  // model. It expects a short natural description, exactly like the Gradio
  // Simple Mode textbox. Never append meta-instructions here - they leak into
  // the caption and derail the lyrics.
  const query = [
    input.query,
    input.tags.length ? `Style: ${input.tags.join(', ')}` : '',
  ].filter(Boolean).join('. ')

  let body: ApiEnvelope<BlueprintApiData>
  let data: BlueprintApiData
  try {
    body = await requestSample(query, input.instrumental, input.vocalLanguage)
    data = body.data ?? {}

    // The LM occasionally returns an arrangement sheet instead of sung lyrics.
    // Re-roll once with the same clean prompt - fresh sampling usually lands.
    if (!input.instrumental && lyricsAreJustTags(data.lyrics || '')) {
      body = await requestSample(query, false, input.vocalLanguage)
      data = body.data ?? {}
    }
  } catch (error) {
    throw friendlyEngineError(error, 'generate the blueprint')
  }

  return {
    id: crypto.randomUUID(),
    query,
    caption: data.caption || '',
    lyrics: data.lyrics || '',
    bpm: data.bpm ?? null,
    keyscale: data.keyscale || data.key_scale || '',
    duration: data.duration ?? null,
    timesignature: data.timesignature || data.time_signature || '',
    vocalLanguage: data.vocal_language || input.vocalLanguage || 'en',
    instrumental: Boolean(data.instrumental ?? input.instrumental),
    lmModel: settings.preferredLmModel,
    raw: body,
    createdAt: new Date().toISOString(),
  }
}

export async function createGeneration(request: GenerationRequest): Promise<GenerationTask> {
  const task: GenerationTask = {
    id: crypto.randomUUID(),
    aceTaskId: null,
    status: 'submitting',
    progress: 0,
    request,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  }

  insertGenerationTask(task)

  try {
    requireEngine('generate music')
    const response = await fetch(`${BASE_URL}/release_task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAcePayload(request)),
    }).catch((error) => { throw friendlyEngineError(error, 'submit the song') })

  const body = await response.json() as ApiEnvelope<ReleaseTaskData>
    if (!response.ok || body.error || (body.code && body.code >= 400)) {
      throw new Error(body.error || `ACE request failed with HTTP ${response.status}`)
    }

    const updated: GenerationTask = {
      ...task,
      aceTaskId: body.data?.task_id ?? null,
      status: body.data?.status ?? 'queued',
      progress: 0,
      result: body,
    }
    updateGenerationTask(task.id, {
      aceTaskId: updated.aceTaskId,
      status: updated.status,
      progress: updated.progress,
      result: body,
    })
    return updated
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateGenerationTask(task.id, {
      status: 'error',
      error: message,
      completedAt: new Date().toISOString(),
    })
    return { ...task, status: 'error', error: message, completedAt: new Date().toISOString() }
  }
}

function sanitizeName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'song'
}

function timestamp() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function resolveAudioSource(source: string) {
  try {
    const url = source.startsWith('http')
      ? new URL(source)
      : source.startsWith('/v1/audio')
        ? new URL(source, BASE_URL)
        : null
    if (!url) {
      return { filePath: source, downloadUrl: `${BASE_URL}/v1/audio?path=${encodeURIComponent(source)}` }
    }

    const pathParam = url.searchParams.get('path')
    if (pathParam) {
      return {
        filePath: pathParam,
        downloadUrl: url.origin === BASE_URL ? url.toString() : `${BASE_URL}${url.pathname}${url.search}`,
      }
    }
    return { filePath: source, downloadUrl: url.toString() }
  } catch {
    return { filePath: source, downloadUrl: `${BASE_URL}/v1/audio?path=${encodeURIComponent(source)}` }
  }
}

async function importAudio(source: string, destPath: string): Promise<boolean> {
  const { filePath, downloadUrl } = resolveAudioSource(source)
  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, destPath)
      return true
    }
  } catch {
    // fall through to HTTP download
  }
  try {
    const response = await fetch(downloadUrl)
    if (!response.ok) return false
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) return false
    fs.writeFileSync(destPath, buffer)
    return true
  } catch {
    return false
  }
}

export async function pollGeneration(
  aceTaskId: string,
  meta: { title: string; mode: ModeType },
): Promise<GenerationPollResult> {
  let body: QueryResultBody
  try {
    const response = await fetch(`${BASE_URL}/query_result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id_list: [aceTaskId] }),
    })
    body = await response.json()
  } catch {
    return { status: 'running', progress: null, progressText: 'Engine not reachable yet…', error: null, songs: [] }
  }

  const item = body?.data?.[0]
  if (!item) {
    return { status: 'running', progress: null, progressText: null, error: null, songs: [] }
  }

  const statusInt = Number(item.status)
  const progressText: string | null = item.progress_text ?? null
  let parsed: AceResultEntry[]
  try {
    const rawParsed = JSON.parse(item.result || '[]') as unknown
    parsed = Array.isArray(rawParsed) ? rawParsed as AceResultEntry[] : []
  } catch {
    parsed = []
  }
  const first = Array.isArray(parsed) ? parsed[0] : null
  const progress = first && typeof first.progress === 'number' ? first.progress : null

  if (statusInt === 2) {
    return { status: 'failed', progress: null, progressText, error: first?.error || 'Generation failed.', songs: [] }
  }
  if (statusInt !== 1) {
    return { status: 'running', progress, progressText, error: null, songs: [] }
  }

  // Succeeded — copy each produced file into the DoReMi library.
  const songsDir = getDoReMiPaths().songs
  fs.mkdirSync(songsDir, { recursive: true })
  const songs: SongVersion[] = []
  let index = 0
  for (const entry of parsed) {
    if (!entry || !entry.file) continue
    index += 1
    const sourcePath = String(entry.file)
    const resolved = resolveAudioSource(sourcePath)
    const ext = path.extname(resolved.filePath) || '.mp3'
    const filename = `${sanitizeName(meta.title)} - ${meta.mode} - ${timestamp()} - ${index}${ext}`
    const destPath = path.join(songsDir, filename)
    const imported = await importAudio(sourcePath, destPath)
    if (!imported) continue

    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const metas = entry.metas || {}
    insertSong({
      id,
      title: meta.title,
      mode: meta.mode,
      prompt: entry.prompt || '',
      lyrics: entry.lyrics || '',
      vocalLanguage: 'en',
      duration: typeof metas.duration === 'number' ? metas.duration : null,
      bpm: typeof metas.bpm === 'number' ? metas.bpm : null,
      keyScale: metas.keyscale || null,
      audioPath: destPath,
      sourceTaskId: aceTaskId,
      requestJson: JSON.stringify({
        importedFrom: sourcePath,
        resolvedAudioPath: resolved.filePath,
        blueprint: meta,
      }),
      responseJson: JSON.stringify(entry),
      createdAt,
    })
    songs.push({
      id,
      projectId: null,
      title: meta.title,
      mode: meta.mode,
      prompt: entry.prompt || '',
      lyrics: entry.lyrics || '',
      audioPath: destPath,
      metadataPath: null,
      favorite: false,
      createdAt,
    })
  }

  if (!songs.length) {
    return { status: 'failed', progress: 1, progressText, error: 'Completed, but no audio files were produced.', songs: [] }
  }
  return { status: 'succeeded', progress: 1, progressText, error: null, songs }
}
