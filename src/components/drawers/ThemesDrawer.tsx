import { useMemo, useRef, useState } from 'react'
import { Download, Image as ImageIcon, Palette, Plus, RotateCcw, Save, Shuffle, Trash2, Upload, X } from 'lucide-react'
import { Switch } from '../ui/Switch'
import { allPresets, useThemeStore } from '../../stores/themeStore'
import { useUiStore } from '../../stores/uiStore'
import type { AlbumArtStyle, BackgroundStyle, ThemeState } from '../../theme/themes'

export function ThemesDrawer() {
  const { theme, userPresets, patchTheme, applyNamedTheme, savePreset, deleteUserPreset, surprise, reset } = useThemeStore()
  const { showThemes, setShowThemes, toast } = useUiStore()
  const [presetName, setPresetName] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)
  const bgInputRef = useRef<HTMLInputElement>(null)

  const presets = useMemo(() => allPresets(userPresets), [userPresets])
  const activePresetId = useMemo(
    () => presets.find((p) => JSON.stringify(p.theme) === JSON.stringify(theme))?.id ?? null,
    [presets, theme],
  )

  if (!showThemes) return null

  function saveCurrentPreset() {
    const name = presetName.trim()
    if (!name) return
    savePreset(name)
    setPresetName('')
    toast('Preset saved')
  }

  function exportTheme() {
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'doremii-theme.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  function importTheme(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { try { patchTheme(JSON.parse(String(reader.result))) } catch { /* ignore */ } }
    reader.readAsText(file)
    event.target.value = ''
  }

  function uploadBackground(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => patchTheme({ bgImage: String(reader.result), bgStyle: 'image' })
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={() => setShowThemes(false)} />
      <aside className="theme-drawer" role="dialog" aria-label="Themes">
        <header className="drawer-head">
          <div className="drawer-title"><Palette size={18} /><strong>Themes</strong></div>
          <div className="drawer-head-actions">
            <button className="ghost-btn" onClick={reset}><RotateCcw size={14} /> Reset</button>
            <button className="ghost-btn" onClick={saveCurrentPreset} disabled={!presetName.trim()}><Save size={14} /> Save</button>
            <button className="ghost-btn close" onClick={() => setShowThemes(false)}><X size={16} /></button>
          </div>
        </header>
        <div className="drawer-body">
          <div className="drawer-columns">
            <section className="drawer-section">
              <span className="section-label">Colors</span>
              <div className="color-rows">
                {([['accent', 'Primary Accent'], ['accent2', 'Secondary'], ['background', 'Background 1'], ['background2', 'Background 2'], ['surface', 'Panel'], ['text', 'Text'], ['muted', 'Muted Text'], ['border', 'Border']] as [keyof ThemeState, string][]).map(([key, label]) => (
                  <label className="color-row" key={key}>
                    <span className="swatch" style={{ background: theme[key] as string }} />
                    <span className="color-name">{label}</span>
                    <input type="color" value={theme[key] as string} onChange={(e) => patchTheme({ [key]: e.target.value } as Partial<ThemeState>)} />
                  </label>
                ))}
              </div>
            </section>
            <section className="drawer-section">
              <span className="section-label">Backgrounds</span>
              <div className="segmented">
                {(['solid', 'gradient', 'image'] as BackgroundStyle[]).map((style) => (
                  <button key={style} className={theme.bgStyle === style ? 'seg active' : 'seg'} onClick={() => patchTheme({ bgStyle: style })}>{style === 'solid' ? 'Default' : style === 'gradient' ? 'Gradient' : 'Image'}</button>
                ))}
              </div>
              <button className="upload-box" onClick={() => bgInputRef.current?.click()}><Upload size={16} /> Upload Your Own Background<small>Supports JPG, PNG, WebP</small></button>
              <input ref={bgInputRef} type="file" accept="image/*" hidden onChange={uploadBackground} />
              {theme.bgImage && (<div className="bg-preview"><span className="bg-thumb" style={{ backgroundImage: `url("${theme.bgImage}")` }} /><button className="ghost-btn" onClick={() => patchTheme({ bgImage: null, bgStyle: 'gradient' })}><Trash2 size={14} /> Remove</button></div>)}
            </section>
          </div>

          <section className="drawer-section">
            <span className="section-label">Effects</span>
            {([['glassOpacity', 'Glass Opacity', 0.2, 1, 0.01, (v: number) => `${Math.round(v * 100)}%`], ['backdropBlur', 'Backdrop Blur', 0, 30, 1, (v: number) => `${v}px`], ['glow', 'Neon Glow', 0, 40, 1, (v: number) => `${v}px`], ['radius', 'Corner Radius', 0, 28, 1, (v: number) => `${v}px`], ['uiScale', 'UI Scale', 0.8, 1.4, 0.01, (v: number) => `${v.toFixed(2)}×`], ['textScale', 'Text Size', 0.8, 1.4, 0.01, (v: number) => `${v.toFixed(2)}×`]] as [keyof ThemeState, string, number, number, number, (v: number) => string][]).map(([key, label, min, max, step, fmt]) => (
              <div className="slider-row" key={key}>
                <div className="slider-top"><span>{label}</span><span className="slider-value">{fmt(theme[key] as number)}</span></div>
                <input type="range" min={min} max={max} step={step} value={theme[key] as number} onChange={(e) => patchTheme({ [key]: Number(e.target.value) } as Partial<ThemeState>)} />
              </div>
            ))}
          </section>

          <section className="drawer-section">
            <span className="section-label">Player &amp; Motion</span>
            <label className="stacked">Album Art Style
              <select value={theme.albumArt} onChange={(e) => patchTheme({ albumArt: e.target.value as AlbumArtStyle })}>
                <option value="square">Modern Square</option><option value="rounded">Rounded</option><option value="vinyl">Spinning Vinyl</option>
              </select>
            </label>
            <div className="toggle-row"><span>Spinning Vinyl</span><Switch on={theme.spinningVinyl} onChange={(v) => patchTheme({ spinningVinyl: v })} /></div>
            <div className="toggle-row"><span>Enable Animations</span><Switch on={theme.animations} onChange={(v) => patchTheme({ animations: v })} /></div>
            <div className="toggle-row"><span>Film Grain</span><Switch on={theme.filmGrain} onChange={(v) => patchTheme({ filmGrain: v })} /></div>
            <div className="toggle-row"><span>Reduce Motion</span><Switch on={theme.reduceMotion} onChange={(v) => patchTheme({ reduceMotion: v })} /></div>
            <div className="slider-row"><div className="slider-top"><span>Animation Energy</span><span className="slider-value">{Math.round(theme.motion * 100)}%</span></div><input type="range" min={0} max={1} step={0.01} value={theme.motion} onChange={(e) => patchTheme({ motion: Number(e.target.value) })} /></div>
          </section>

          <section className="drawer-section">
            <span className="section-label">Presets</span>
            <div className="preset-chips">
              {presets.map((preset) => (
                <span className={`preset-pill ${activePresetId === preset.id ? 'active' : ''}`} key={preset.id}>
                  <button onClick={() => applyNamedTheme(preset)}>{activePresetId === preset.id && <span className="check">✓</span>}{preset.name}</button>
                  {preset.id.startsWith('user-') && <button className="pill-x" onClick={() => deleteUserPreset(preset.id)} aria-label="Delete preset"><X size={11} /></button>}
                </span>
              ))}
            </div>
            <div className="save-row"><input placeholder="Name this preset…" value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveCurrentPreset()} /><button className="ghost-btn" onClick={saveCurrentPreset}><Plus size={14} /> Save</button></div>
          </section>
        </div>
        <footer className="drawer-foot">
          <button className="ghost-btn" onClick={surprise}><Shuffle size={14} /> Surprise Me</button>
          <button className="ghost-btn" onClick={exportTheme}><Download size={14} /> Export</button>
          <button className="ghost-btn" onClick={() => importInputRef.current?.click()}><ImageIcon size={14} /> Import</button>
          <input ref={importInputRef} type="file" accept="application/json" hidden onChange={importTheme} />
          <button className="generate-cta compact" onClick={() => setShowThemes(false)}>Done</button>
        </footer>
      </aside>
    </>
  )
}
