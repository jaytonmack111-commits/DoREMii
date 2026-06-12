import { create } from 'zustand'
import type { SongVersion } from '../shared/types'

interface PlayerStore {
  nowPlaying: SongVersion | null
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  playSong: (song: SongVersion) => void
  setPlaying: (playing: boolean) => void
  setProgress: (currentTime: number, duration: number) => void
  setVolume: (volume: number) => void
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  nowPlaying: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  playSong: (song) => set({ nowPlaying: song, playing: true, currentTime: 0, duration: 0 }),
  setPlaying: (playing) => set({ playing }),
  setProgress: (currentTime, duration) => set({ currentTime, duration: Number.isFinite(duration) ? duration : 0 }),
  setVolume: (volume) => set({ volume }),
}))
