import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { ACE_STEP_DIR, DEFAULT_ENGINE_PORT, UV_EXE } from './paths.js'
import type { EngineStatus } from '../shared/types.js'
import { getEngineSettings } from './modelSettings.js'

type EngineHealthPayload = {
  data?: EngineHealthPayload
  models_initialized?: boolean
  model_initialized?: boolean
  loaded_model?: string
  loaded_lm_model?: string
  model?: string
  lm_model?: string
}

type ApiResponsePayload = {
  code?: number
  error?: string | null
  detail?: string
}

const execFileAsync = promisify(execFile)

/** How long a previously-healthy (or adopted) engine may be unreachable before
 *  the watchdog declares it dead. Fresh boots get the longer waitForHealth
 *  window instead, because model loading legitimately takes minutes. */
const WATCHDOG_UNREACHABLE_MS = 90_000

class EngineManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private adopted = false
  private logs: string[] = []
  /** Set after the first successful health check; null until then. */
  private lastHealthyAt: number | null = null
  /** Set when health checks start failing; cleared on the next success. */
  private unhealthySince: number | null = null
  private status: EngineStatus = {
    state: 'stopped',
    pid: null,
    port: DEFAULT_ENGINE_PORT,
    health: 'unknown',
    loadedModel: null,
    loadedLmModel: null,
    queueSize: null,
    lastLogLine: null,
    lastError: null,
    startedByDoReMi: false,
  }

  getStatus() {
    return this.status
  }

  getLogs() {
    return this.logs.slice(-500)
  }

  async start() {
    if (this.process || this.adopted || this.status.state === 'running' || this.status.state === 'starting') {
      await this.refreshHealth()
      return this.status
    }

    if (await this.probe() !== 'down') {
      this.addLog('Found an engine already running on the port - adopting it.')
      this.adopted = true
      this.status = {
        ...this.status,
        state: 'starting',
        health: 'warming',
        lastError: null,
        startedByDoReMi: false,
      }
      await this.refreshHealth()
      void this.waitForHealth()
      return this.status
    }

    this.status = {
      ...this.status,
      state: 'starting',
      health: 'warming',
      lastError: null,
      lastLogLine: 'Engine starting - launching ACE-Step.',
      startedByDoReMi: true,
    }

    const settings = getEngineSettings()
    this.process = spawn(UV_EXE, ['run', '--no-sync', 'acestep-api', '--host', '127.0.0.1', '--port', String(DEFAULT_ENGINE_PORT)], {
      cwd: ACE_STEP_DIR,
      windowsHide: true,
      env: {
        ...process.env,
        ACESTEP_API_HOST: '127.0.0.1',
        ACESTEP_API_PORT: String(DEFAULT_ENGINE_PORT),
        ACESTEP_LM_MODEL_PATH: settings.preferredLmModel,
        ACESTEP_LM_BACKEND: settings.lmBackend,
        ACESTEP_DEVICE: 'auto',
        ACESTEP_INIT_LLM: 'auto',
        ACESTEP_OFFLOAD_TO_CPU: settings.lmOffloadToCpu ? 'true' : 'false',
        ACESTEP_LM_OFFLOAD_TO_CPU: settings.lmOffloadToCpu ? 'true' : 'false',
      },
    })
    this.status = { ...this.status, pid: this.process.pid ?? null }

    this.process.stdout.on('data', (chunk) => this.addLog(String(chunk)))
    this.process.stderr.on('data', (chunk) => this.addLog(String(chunk)))
    this.process.on('exit', (code) => {
      this.addLog(`Engine exited with code ${code}`)
      this.process = null
      this.status = {
        ...this.status,
        state: code === 0 ? 'stopped' : 'error',
        pid: null,
        health: code === 0 ? 'unknown' : 'unreachable',
      }
    })

    void this.waitForHealth()
    return this.status
  }

  async stop() {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.adopted = false
    this.lastHealthyAt = null
    this.unhealthySince = null
    this.status = {
      ...this.status,
      state: 'stopped',
      pid: null,
      health: 'unknown',
      lastLogLine: 'Engine stopped.',
      startedByDoReMi: false,
    }
    return this.status
  }

  /** Hard recovery: kill our child AND any stray ACE process holding the
   *  port (e.g. a wedged adopted engine we have no handle to), then boot
   *  fresh. Wired to the engine pill so a stuck engine is one click away
   *  from recovery instead of requiring an app restart. */
  async forceRestart() {
    this.addLog('Force restart requested - stopping any engine on the port.')
    await this.stop()
    try {
      await execFileAsync('powershell.exe', [
        '-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='uv.exe'" | Where-Object { $_.CommandLine -match 'acestep-api' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ], { timeout: 15_000 })
    } catch {
      // Best effort - if the sweep fails we still try a fresh start.
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
    this.status = { ...this.status, lastError: null, lastLogLine: 'Engine restarting fresh.' }
    return this.start()
  }

  private async probe(): Promise<'up' | 'down'> {
    try {
      const response = await fetch(`http://127.0.0.1:${DEFAULT_ENGINE_PORT}/health`)
      return response.ok ? 'up' : 'down'
    } catch {
      return 'down'
    }
  }

  private addLog(line: string) {
    const clean = line.trim()
    if (!clean) return
    this.logs.push(clean)
    this.status = { ...this.status, lastLogLine: clean }
  }

  private async waitForHealth() {
    for (let i = 0; i < 600; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (!this.process && !this.adopted) return
      await this.refreshHealth()
      if (this.status.health === 'ready') return
      if (this.status.state === 'error') return // watchdog already called it
    }
    this.status = {
      ...this.status,
      state: 'error',
      health: 'unreachable',
      lastError: 'Engine did not become ready within 10 minutes - check the logs in Settings.',
    }
  }

  async refreshHealth() {
    try {
      const response = await fetch(`http://127.0.0.1:${DEFAULT_ENGINE_PORT}/health`)
      const payload = await response.json() as EngineHealthPayload
      const data = payload.data ?? payload

      // ACE initializes models LAZILY: models_initialized / llm_initialized
      // stay false until the first generation or blueprint request arrives.
      // A responding /health endpoint IS a ready engine - never gate
      // readiness on those flags or we wait forever.
      const modelsInitialized = data.models_initialized === true
        || data.model_initialized === true
        || (Boolean(data.loaded_model) && Boolean(data.loaded_lm_model))

      this.lastHealthyAt = Date.now()
      this.unhealthySince = null
      this.status = {
        ...this.status,
        state: 'running',
        health: 'ready',
        loadedModel: data.loaded_model ?? data.model ?? null,
        loadedLmModel: data.loaded_lm_model ?? data.lm_model ?? null,
        lastError: null,
        lastLogLine: modelsInitialized
          ? 'Engine ready - models initialized.'
          : 'Engine ready - models load on the first request (the first one takes a bit longer).',
      }
      return this.status
    } catch (error) {
      if (this.unhealthySince === null) this.unhealthySince = Date.now()

      // Watchdog: an engine that WAS healthy (or was adopted already-running)
      // and has now been unreachable for a while is dead or wedged - say so
      // instead of showing "Warming up..." forever. Fresh boots are exempt:
      // they get waitForHealth's long window while models load.
      const wasEverHealthy = this.lastHealthyAt !== null || this.adopted
      const unreachableFor = Date.now() - this.unhealthySince
      if (wasEverHealthy && unreachableFor > WATCHDOG_UNREACHABLE_MS) {
        this.status = {
          ...this.status,
          state: 'error',
          health: 'unreachable',
          lastError: `The engine stopped responding for over ${Math.round(WATCHDOG_UNREACHABLE_MS / 1000)} seconds. Click the engine pill to restart it.`,
          lastLogLine: 'Engine watchdog: process is unresponsive - restart needed.',
        }
        return this.status
      }

      const isManagedStartup = Boolean(this.process || this.adopted || this.status.startedByDoReMi)
      this.status = {
        ...this.status,
        health: isManagedStartup ? 'warming' : 'unreachable',
        state: isManagedStartup ? 'starting' : this.status.state,
        lastError: error instanceof Error ? error.message : String(error),
        lastLogLine: isManagedStartup
          ? 'Engine warming up - health check is waiting for the model loader.'
          : this.status.lastLogLine,
      }
      return this.status
    }
  }

  async reloadPreferredLm() {
    const settings = getEngineSettings()
    if (this.status.health !== 'ready') {
      await this.start()
      await this.waitForHealth()
    }
    try {
      const response = await fetch(`http://127.0.0.1:${DEFAULT_ENGINE_PORT}/v1/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.status.loadedModel || 'acestep-v15-turbo',
          init_llm: true,
          lm_model_path: settings.preferredLmModel,
          lm_backend: settings.lmBackend,
        }),
      })
      const body = await response.json() as ApiResponsePayload
      if (!response.ok || body.error || (body.code && body.code >= 400)) {
        throw new Error(body.error || body.detail || `Model init failed with HTTP ${response.status}`)
      }
      this.addLog(`Requested LM reload: ${settings.preferredLmModel}`)
      return this.refreshHealth()
    } catch (error) {
      this.status = {
        ...this.status,
        state: 'error',
        health: 'unreachable',
        lastError: error instanceof Error ? error.message : String(error),
      }
      return this.status
    }
  }
}

export const engineManager = new EngineManager()
