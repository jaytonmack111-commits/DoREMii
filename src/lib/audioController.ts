import { usePlayerStore } from '../stores/playerStore'

// Single shared <audio> element, registered by App, controlled from anywhere
// (player bar, sidebar mini-player, track rows) without prop drilling.
let audioEl: HTMLAudioElement | null = null

export function registerAudioElement(el: HTMLAudioElement | null) {
  audioEl = el
}

export function togglePlay() {
  const { nowPlaying, playing, setPlaying } = usePlayerStore.getState()
  if (!nowPlaying) return
  if (!audioEl) { setPlaying(!playing); return }
  if (playing) { audioEl.pause(); setPlaying(false) }
  else { void audioEl.play().catch(() => undefined); setPlaying(true) }
}

export function seekTo(seconds: number) {
  if (audioEl && Number.isFinite(seconds)) audioEl.currentTime = seconds
}

export function seekToFraction(fraction: number) {
  const { duration } = usePlayerStore.getState()
  if (duration > 0) seekTo(Math.min(Math.max(fraction, 0), 1) * duration)
}

export function setVolume(volume: number) {
  const clamped = Math.min(Math.max(volume, 0), 1)
  if (audioEl) audioEl.volume = clamped
  usePlayerStore.getState().setVolume(clamped)
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
