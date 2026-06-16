import fs from 'node:fs'
import type { ResourceMode, ResourceStatus } from '../shared/types.js'
import { getConductorState } from './aiConductor.js'
import { engineManager } from './engineManager.js'
import { getEngineSettings, setResourceMode as persistResourceMode } from './modelSettings.js'
import { getFluxHealth } from './fluxManager.js'

const OLLAMA_URL = 'http://127.0.0.1:11434'

async function ollamaLoadedModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return []
    const body = await response.json() as { models?: { name: string }[] }
    return (body.models ?? []).map((model) => model.name)
  } catch {
    return []
  }
}

async function fluxStatus(settings = getEngineSettings()): Promise<ResourceStatus['flux']> {
  const live = await getFluxHealth()
  if (live.running) {
    return { configured: true, status: 'running', backendPath: live.url, lastError: live.lastError }
  }
  const backendPath = settings.fluxBackendPath.trim()
  if (!backendPath) {
    return { configured: true, status: 'configured', backendPath: live.url, lastError: live.lastError }
  }
  if (/^https?:\/\//i.test(backendPath)) {
    return { configured: true, status: 'configured', backendPath, lastError: null }
  }
  return {
    configured: fs.existsSync(backendPath),
    status: fs.existsSync(backendPath) ? 'configured' : 'missing',
    backendPath,
    lastError: fs.existsSync(backendPath) ? null : 'Configured FLUX path does not exist.',
  }
}

export async function getResourceStatus(): Promise<ResourceStatus> {
  const settings = getEngineSettings()
  const conductor = getConductorState()
  const ollama = await ollamaLoadedModels()
  const ace = engineManager.getStatus()
  const highPressure = conductor === 'engine' || ollama.some((name) => /14b|8b/i.test(name))
  return {
    mode: settings.resourceMode,
    conductor,
    ace,
    ollamaLoadedModels: ollama,
    flux: await fluxStatus(settings),
    estimatedPressure: highPressure ? 'high' : conductor === 'writer' || conductor === 'cover' ? 'medium' : 'low',
    owner: conductor,
  }
}

export async function setResourceMode(mode: ResourceMode): Promise<ResourceStatus> {
  persistResourceMode(mode)
  return getResourceStatus()
}
