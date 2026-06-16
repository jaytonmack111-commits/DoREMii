import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'
import { ACE_STEP_DIR } from './paths.js'

const FLUX_PORT = 8811
const FLUX_URL = `http://127.0.0.1:${FLUX_PORT}`
const PYTHON_EXE = path.join(ACE_STEP_DIR, '.venv', 'Scripts', 'python.exe')

function serverPath() {
  return path.join(app.getAppPath(), 'flux_backend', 'server.py')
}

let processHandle: ChildProcessWithoutNullStreams | null = null
let lastError: string | null = null
const logs: string[] = []

function log(line: string) {
  logs.push(line)
  if (logs.length > 300) logs.shift()
}

export function getFluxLogs() {
  return logs
}

export async function getFluxHealth(): Promise<{ ok: boolean; configured: boolean; running: boolean; loaded: boolean; url: string; lastError: string | null; model?: string }> {
  try {
    const response = await fetch(`${FLUX_URL}/health`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json() as { ok?: boolean; loaded?: boolean; model?: string; last_error?: string | null }
    return { ok: Boolean(body.ok), configured: true, running: true, loaded: Boolean(body.loaded), url: FLUX_URL, lastError: body.last_error ?? lastError, model: body.model }
  } catch (error) {
    return { ok: false, configured: true, running: false, loaded: false, url: FLUX_URL, lastError: lastError ?? (error instanceof Error ? error.message : String(error)) }
  }
}

export async function startFluxBackend() {
  const health = await getFluxHealth()
  if (health.running) return health
  if (processHandle && !processHandle.killed) return health
  processHandle = spawn(PYTHON_EXE, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(FLUX_PORT)], {
    cwd: path.dirname(serverPath()),
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      DOREMII_FLUX_MODEL: process.env.DOREMII_FLUX_MODEL || 'black-forest-labs/FLUX.1-schnell',
    },
  })
  log(`[flux] starting ${PYTHON_EXE} ${serverPath()}`)
  processHandle.stdout.on('data', (chunk) => log(String(chunk).trim()))
  processHandle.stderr.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (text) lastError = text
    log(text)
  })
  processHandle.on('exit', (code) => {
    log(`[flux] exited ${code}`)
    processHandle = null
  })
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const next = await getFluxHealth()
    if (next.running) return next
  }
  return getFluxHealth()
}

export async function stopFluxBackend() {
  try {
    await fetch(`${FLUX_URL}/unload`, { method: 'POST', signal: AbortSignal.timeout(5000) })
  } catch {
    // ignore
  }
  if (processHandle && !processHandle.killed) {
    processHandle.kill()
  }
  processHandle = null
  return getFluxHealth()
}

export async function generateFluxImage(input: {
  prompt: string
  outputPath: string
  width: number
  height: number
  steps: number
  seed?: number | null
}) {
  const health = await startFluxBackend()
  if (!health.running) throw new Error(`FLUX backend is not running: ${health.lastError || 'unknown error'}`)
  const response = await fetch(`${FLUX_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15 * 60_000),
    body: JSON.stringify({
      prompt: input.prompt,
      output_path: input.outputPath,
      width: input.width,
      height: input.height,
      steps: input.steps,
      guidance_scale: 0,
      seed: input.seed ?? undefined,
    }),
  })
  if (!response.ok) throw new Error(`FLUX generate failed: HTTP ${response.status}`)
  const body = await response.json() as { ok?: boolean; path?: string; error?: string }
  if (!body.ok || !body.path) throw new Error(body.error || 'FLUX did not return an output path')
  return body.path
}
