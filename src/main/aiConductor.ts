import { BrowserWindow } from 'electron'
import type { ConductorState } from '../shared/types.js'

/** Phase 3 - VRAM Conductor.
 *
 *  On an 8 GB card, ACE-Step and an Ollama writer model can't both sit in VRAM
 *  comfortably - whichever loses pages to system RAM and crawls. The conductor
 *  keeps only one heavy brain hot at a time: Ollama is put to sleep before a
 *  song generation so ACE gets the whole GPU, and it broadcasts which brain is
 *  active so the UI can show it. Models stay in system RAM, so waking one back
 *  up is a few seconds, not a fresh download. */

const OLLAMA_URL = 'http://127.0.0.1:11434'

let current: ConductorState = 'idle'

function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('conductor:state', current)
  }
}

export function getConductorState(): ConductorState {
  return current
}

export function setConductorState(state: ConductorState) {
  if (current === state) return
  current = state
  broadcast()
}

/** Unload every loaded Ollama model to free system RAM/VRAM before ACE runs. */
export async function sleepOllama(): Promise<void> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/ps`)
    if (!response.ok) return
    const body = await response.json() as { models?: { name: string }[] }
    const loaded = body.models ?? []
    if (!loaded.length) return
    await Promise.all(loaded.map((model) =>
      fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // keep_alive: 0 with no prompt tells Ollama to unload the model now.
        body: JSON.stringify({ model: model.name, keep_alive: 0 }),
      }).catch(() => undefined),
    ))
  } catch {
    // Ollama isn't running - nothing to sleep.
  }
}

/** Run an Ollama writer job while flagging the conductor as 'writer'. Nesting
 *  is safe; the state only drops back to idle when the outermost job ends and a
 *  generation hasn't taken over in the meantime. */
export async function withWriter<T>(fn: () => Promise<T>): Promise<T> {
  if (current === 'engine') {
    throw new Error('The music engine is generating right now. Wait for the song to finish before running writer fixes.')
  }
  setConductorState('writer')
  try {
    return await fn()
  } finally {
    if (current === 'writer') setConductorState('idle')
  }
}

/** Mark a song generation as starting: sleep Ollama, claim the GPU. */
export async function beginEngineJob(): Promise<void> {
  setConductorState('engine')
  await sleepOllama()
}

/** A generation finished (or failed) - release the conductor. */
export function endEngineJob() {
  if (current === 'engine') setConductorState('idle')
}
