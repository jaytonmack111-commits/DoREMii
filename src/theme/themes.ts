export type BackgroundStyle = 'solid' | 'gradient' | 'image'
export type AlbumArtStyle = 'square' | 'rounded' | 'vinyl'

export interface ThemeState {
  background: string
  background2: string
  surface: string
  surface2: string
  text: string
  muted: string
  border: string
  accent: string
  accent2: string
  glassOpacity: number
  backdropBlur: number
  glow: number
  radius: number
  uiScale: number
  textScale: number
  motion: number
  animations: boolean
  filmGrain: boolean
  reduceMotion: boolean
  spinningVinyl: boolean
  albumArt: AlbumArtStyle
  bgStyle: BackgroundStyle
  bgImage: string | null
}

export interface NamedTheme {
  id: string
  name: string
  theme: ThemeState
}

export const THEME_KEY = 'doremi.theme.v5'
export const PRESETS_KEY = 'doremi.presets.v3'

/** Default look, matched to the DoReMii reference shots: deep violet-black
 *  base with violet→magenta neon accents. */
export const doremiiNeon: ThemeState = {
  background: '#030716', background2: '#0b1028', surface: '#10172e', surface2: '#1a2142',
  text: '#f7f4ff', muted: '#a9b2d9', border: '#2d3769', accent: '#31c7ff', accent2: '#f241a3',
  glassOpacity: 0.74, backdropBlur: 18, glow: 28, radius: 18, uiScale: 1, textScale: 1,
  motion: 0.7, animations: true, filmGrain: true, reduceMotion: false, spinningVinyl: true,
  albumArt: 'rounded', bgStyle: 'gradient', bgImage: null,
}

export const neonNight: ThemeState = {
  ...doremiiNeon,
  background: '#050b1a', background2: '#0c1230', surface: '#111a33', surface2: '#182142',
  text: '#f2f7ff', muted: '#9cb0d4', border: '#26345c', accent: '#38bdf8', accent2: '#f43f8e',
  glow: 22,
}

export const builtInThemes: NamedTheme[] = [
  { id: 'doremii-neon', name: 'DoReMii Neon', theme: doremiiNeon },
  { id: 'neon-night', name: 'Neon Night', theme: neonNight },
  { id: 'midnight-pulse', name: 'Midnight Pulse', theme: { ...neonNight, background: '#03060f', background2: '#07101f', surface: '#0c1626', surface2: '#122033', text: '#eafbff', muted: '#8fb4cc', border: '#1d3550', accent: '#22d3ee', accent2: '#fb7185', glow: 26 } },
  { id: 'synthwave', name: 'Synthwave', theme: { ...neonNight, background: '#120626', background2: '#1d0a3a', surface: '#241046', surface2: '#311657', text: '#fdeaff', muted: '#c7a3e8', border: '#4a2278', accent: '#c026f0', accent2: '#22d3ee', glow: 28 } },
  { id: 'emerald', name: 'Emerald', theme: { ...neonNight, background: '#04130f', background2: '#06201a', surface: '#0a2820', surface2: '#0f3429', text: '#ecfff7', muted: '#8fccb4', border: '#1b4d3c', accent: '#34f5a8', accent2: '#eab308', glow: 22 } },
  { id: 'ember', name: 'Ember', theme: { ...neonNight, background: '#140805', background2: '#23100a', surface: '#2a140d', surface2: '#371b11', text: '#fff2ea', muted: '#d6ab98', border: '#522a1c', accent: '#ff7a45', accent2: '#ffce3a', glow: 24 } },
  { id: 'cyber-dawn', name: 'Cyber Dawn', theme: { ...neonNight, background: '#eef1fb', background2: '#e0e5f5', surface: '#ffffff', surface2: '#f3f5fd', text: '#161a2e', muted: '#5a6385', border: '#cdd5ee', accent: '#6d28f0', accent2: '#ff5a3c', glassOpacity: 0.9, backdropBlur: 8, glow: 12, filmGrain: false } },
]

export function loadTheme(): ThemeState {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw) return { ...doremiiNeon, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return doremiiNeon
}

export function loadUserPresets(): NamedTheme[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}
