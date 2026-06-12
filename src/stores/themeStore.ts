import { create } from 'zustand'
import {
  builtInThemes,
  loadTheme,
  loadUserPresets,
  doremiiNeon,
  PRESETS_KEY,
  THEME_KEY,
  type NamedTheme,
  type ThemeState,
} from '../theme/themes'
import { hexToRgb, hslToHex } from '../lib/color'

interface ThemeStore {
  theme: ThemeState
  userPresets: NamedTheme[]
  patchTheme: (patch: Partial<ThemeState>) => void
  applyNamedTheme: (named: NamedTheme) => void
  savePreset: (name: string) => void
  deleteUserPreset: (id: string) => void
  surprise: () => void
  reset: () => void
}

export function surpriseTheme(base: ThemeState): ThemeState {
  const h = Math.floor(Math.random() * 360)
  return {
    ...base,
    accent: hslToHex(h, 90, 60), accent2: hslToHex((h + 150) % 360, 88, 62),
    background: hslToHex(h, 48, 6), background2: hslToHex((h + 26) % 360, 50, 10),
    surface: hslToHex(h, 40, 13), surface2: hslToHex(h, 38, 18), border: hslToHex(h, 44, 30),
    text: '#f4f9ff', muted: hslToHex(h, 24, 72), bgStyle: base.bgStyle === 'image' ? 'image' : 'gradient',
  }
}

export function applyThemeToDom(theme: ThemeState) {
  const root = document.documentElement
  const set = (k: string, v: string) => root.style.setProperty(k, v)
  set('--bg', theme.background); set('--bg-2', theme.background2)
  set('--surface', theme.surface); set('--surface-2', theme.surface2)
  set('--text', theme.text); set('--muted', theme.muted); set('--border', theme.border)
  set('--accent', theme.accent); set('--accent-2', theme.accent2)
  set('--bg-rgb', hexToRgb(theme.background)); set('--bg-2-rgb', hexToRgb(theme.background2))
  set('--surface-rgb', hexToRgb(theme.surface)); set('--surface-2-rgb', hexToRgb(theme.surface2))
  set('--border-rgb', hexToRgb(theme.border)); set('--accent-rgb', hexToRgb(theme.accent))
  set('--accent-2-rgb', hexToRgb(theme.accent2)); set('--text-rgb', hexToRgb(theme.text))
  set('--glass-opacity', String(theme.glassOpacity)); set('--blur', `${theme.backdropBlur}px`)
  set('--glow', `${theme.glow}px`); set('--radius', `${theme.radius}px`)
  set('--font-scale', String(theme.textScale))
  set('--motion-scale', theme.reduceMotion || !theme.animations ? '0' : String(theme.motion))
  set('--bg-image', theme.bgStyle === 'image' && theme.bgImage ? `url("${theme.bgImage}")` : 'none')
  window.doReMi?.setZoom?.(theme.uiScale)
  try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)) } catch { /* ignore */ }
}

function persistPresets(presets: NamedTheme[]) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)) } catch { /* ignore */ }
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: loadTheme(),
  userPresets: loadUserPresets(),
  patchTheme: (patch) => set((s) => ({ theme: { ...s.theme, ...patch } })),
  applyNamedTheme: (named) => set((s) => ({ theme: { ...named.theme, uiScale: s.theme.uiScale } })),
  savePreset: (name) => set((s) => {
    const userPresets = [...s.userPresets, { id: `user-${Date.now()}`, name, theme: s.theme }]
    persistPresets(userPresets)
    return { userPresets }
  }),
  deleteUserPreset: (id) => set((s) => {
    const userPresets = s.userPresets.filter((p) => p.id !== id)
    persistPresets(userPresets)
    return { userPresets }
  }),
  surprise: () => set((s) => ({ theme: surpriseTheme(s.theme) })),
  reset: () => set((s) => ({ theme: { ...doremiiNeon, uiScale: s.theme.uiScale } })),
}))

export function allPresets(userPresets: NamedTheme[]) {
  return [...builtInThemes, ...userPresets]
}
