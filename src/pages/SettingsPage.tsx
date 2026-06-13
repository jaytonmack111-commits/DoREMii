import { useEffect, useMemo, useState } from 'react'
import { Brain, Cpu, Download, FolderOpen, Gauge, Palette, RefreshCw, SlidersHorizontal, Wrench } from 'lucide-react'
import { FeatureCard } from '../components/ui/FeatureCard'
import { allPresets, useThemeStore } from '../stores/themeStore'
import { useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import type { EngineSettings, LmModelId, LocalModelInfo } from '../shared/types'

const LM_OPTIONS: { id: LmModelId; label: string; detail: string }[] = [
  { id: 'acestep-5Hz-lm-0.6B', label: '0.6B - fast and safe', detail: 'Recommended fallback for 8 GB VRAM.' },
  { id: 'acestep-5Hz-lm-1.7B', label: '1.7B - stronger planner', detail: 'Better composition, more memory.' },
  { id: 'acestep-5Hz-lm-4B', label: '4B - best planner', detail: 'Slower and experimental on 8 GB VRAM.' },
]

const OLLAMA_ROLE_MODELS = ['qwen3:4b', 'qwen3:8b', 'qwen3:14b', 'qwen3:1.7b', 'llama3.2:3b']

export function SettingsPage() {
  const { theme, userPresets, applyNamedTheme } = useThemeStore()
  const { setup, logs, engine, refreshAll } = useAppStore()
  const { showLogs, toggleLogs, setShowThemes, setShowSetup, toast, soon } = useUiStore()
  const [engineSettings, setEngineSettings] = useState<EngineSettings | null>(null)
  const [models, setModels] = useState<LocalModelInfo[]>([])
  const [modelBusy, setModelBusy] = useState(false)

  const presets = useMemo(() => allPresets(userPresets), [userPresets])
  const activePresetId = useMemo(
    () => presets.find((p) => JSON.stringify(p.theme) === JSON.stringify(theme))?.id ?? null,
    [presets, theme],
  )

  async function refreshModels() {
    const [settings, localModels] = await Promise.all([
      window.doReMi.getEngineSettings(),
      window.doReMi.getLocalModels(),
    ])
    setEngineSettings(settings)
    setModels(localModels)
  }

  useEffect(() => {
    void Promise.resolve().then(refreshModels)
  }, [engine.loadedLmModel, engine.loadedModel])

  async function updateLmModel(model: LmModelId) {
    const settings = await window.doReMi.updateEngineSettings({ preferredLmModel: model })
    setEngineSettings(settings)
    toast(`Preferred LM set to ${model}`)
    await refreshModels()
  }

  async function reloadLm() {
    setModelBusy(true)
    try {
      const status = await window.doReMi.reloadPreferredLm()
      useAppStore.setState({ engine: status, logs: await window.doReMi.getEngineLogs() })
      await refreshModels()
      toast(status.loadedLmModel ? `Loaded LM: ${status.loadedLmModel}` : 'LM reload requested')
    } finally {
      setModelBusy(false)
    }
  }

  async function downloadModel(modelId: string) {
    setModelBusy(true)
    try {
      toast(`Starting ${modelId} download/check...`)
      await window.doReMi.downloadModel(modelId)
      await refreshModels()
      toast(`${modelId} is ready or download completed`)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error))
    } finally {
      setModelBusy(false)
    }
  }

  async function updateOllamaRole(patch: Partial<Pick<EngineSettings, 'writerRoomModel' | 'lyricWriterModel'>>) {
    const settings = await window.doReMi.updateEngineSettings(patch)
    setEngineSettings(settings)
    toast('Ollama role model updated')
  }

  async function pullOllama(model: string) {
    setModelBusy(true)
    try {
      toast(`Pulling ${model} with Ollama...`)
      await window.doReMi.pullOllamaModel(model)
      await refreshModels()
      toast(`${model} is ready`)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error))
    } finally {
      setModelBusy(false)
    }
  }

  return (
    <section className="page">
      <div className="section-head"><h2>Settings</h2></div>
      <div className="settings-stack">
        <div className="glass-panel">
          <div className="panel-head"><h3>Appearance</h3><button className="mini-action" onClick={() => setShowThemes(true)}><Palette size={14} /> Open Themes</button></div>
          <p className="muted-copy">Full control over colours, glass, blur, glow, corner radius, text and UI scale, motion and backgrounds. Every change saves automatically.</p>
          <div className="chip-wrap">
            {presets.map((p) => (
              <button key={p.id} className={activePresetId === p.id ? 'chip on' : 'chip'} onClick={() => applyNamedTheme(p)}>{p.name}</button>
            ))}
          </div>
        </div>

        <div className="glass-panel">
          <div className="panel-head"><h3>Engine &amp; Setup</h3><button className="mini-action" onClick={() => { void refreshAll(); void refreshModels() }}><RefreshCw size={14} /> Recheck</button></div>
          <div className="diagnostic-list">
            {setup?.checks.map((check) => (
              <div className="diagnostic-row" key={check.id}>
                <span className={`status-dot ${check.status}`} />
                <div><strong>{check.label}</strong><small>{check.detail}</small></div>
              </div>
            ))}
          </div>
          <div className="chip-wrap">
            <button className="chip" onClick={() => setShowSetup(true)}><Wrench size={13} /> First-Run Wizard</button>
            <button className="chip" onClick={toggleLogs}>Error Doctor / Logs</button>
            <button className="chip" onClick={() => soon('Open output folder')}><FolderOpen size={13} /> Output Folder</button>
            <button
              className="chip danger"
              onClick={() => {
                void window.doReMi.cleanupLocalWorkers()
                  .then((status) => {
                    useAppStore.setState({ engine: status })
                    toast('Stopped DoReMii ACE/Python/Ollama worker processes')
                  })
                  .catch((error) => toast(error instanceof Error ? error.message : String(error)))
              }}
            >
              <Cpu size={13} /> Free Local AI Memory
            </button>
          </div>
          {showLogs && (
            <div className="log-box">
              {logs.length ? logs.slice(-80).map((line, i) => <p key={`${line}-${i}`}>{line}</p>) : <p>No engine logs yet.</p>}
            </div>
          )}
        </div>

        <div className="glass-panel">
          <div className="panel-head">
            <h3>Local Model Control Center</h3>
            <button className="mini-action accent" disabled={modelBusy} onClick={() => void reloadLm()}><RefreshCw size={14} /> Reload Preferred LM</button>
          </div>
          <p className="muted-copy">Each AI job uses its own model: room chat stays snappy on a small model, lyric drafting uses the strong writer, and ACE's own LM handles musical metadata. The table shows what is actually loaded so there are no mystery fallbacks.</p>
          <div className="model-selector">
            <label>Writers Room thinking model
              <select
                value={engineSettings?.writerRoomModel ?? 'qwen3:4b'}
                onChange={(e) => void updateOllamaRole({ writerRoomModel: e.target.value })}
              >
                {OLLAMA_ROLE_MODELS.map((model) => <option key={model} value={model}>{model}{model === 'qwen3:4b' ? ' - preferred chat brain' : ''}</option>)}
              </select>
            </label>
            <label>Deep lyric writer model
              <select
                value={engineSettings?.lyricWriterModel ?? 'qwen3:14b'}
                onChange={(e) => void updateOllamaRole({ lyricWriterModel: e.target.value })}
              >
                {OLLAMA_ROLE_MODELS.map((model) => <option key={model} value={model}>{model}{model === 'qwen3:8b' ? ' - default lyric drafter' : model === 'qwen3:14b' ? ' - deep rewrite / critic' : ''}</option>)}
              </select>
            </label>
          </div>
          <div className="inline-note"><Brain size={14} /> Room chat prefers {engineSettings?.writerRoomModel ?? 'qwen3:4b'}; lyric drafting prefers {engineSettings?.lyricWriterModel ?? 'qwen3:8b'}. Use 14B for slower deep rewrite/critic passes.</div>
          <div className="chip-wrap">
            <button className="chip on" disabled={modelBusy} onClick={() => void pullOllama(engineSettings?.writerRoomModel ?? 'qwen3:4b')}><Download size={13} /> Pull Room Model</button>
            <button className="chip" disabled={modelBusy} onClick={() => void pullOllama('qwen3:4b')}><Download size={13} /> Pull qwen3:4b</button>
          </div>
          <div className="model-selector">
            <label>Preferred lyric / planning model
              <select value={engineSettings?.preferredLmModel ?? 'acestep-5Hz-lm-4B'} onChange={(e) => void updateLmModel(e.target.value as LmModelId)}>
                {LM_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label>Backend
              <select
                value={engineSettings?.lmBackend ?? 'pt'}
                onChange={(e) => void window.doReMi.updateEngineSettings({ lmBackend: e.target.value as EngineSettings['lmBackend'] }).then(setEngineSettings)}
              >
                <option value="pt">PyTorch - safest on Windows</option>
                <option value="vllm">vLLM - faster when supported</option>
                <option value="mlx">MLX - Apple Silicon</option>
              </select>
            </label>
          </div>
          <div className="inline-note"><Brain size={14} /> Preferred: {engineSettings?.preferredLmModel ?? 'acestep-5Hz-lm-4B'} · Actually loaded: {engine.loadedLmModel || 'not loaded yet'}</div>
          <div className="model-table">
            <div className="model-row head">
              <span>Role</span><span>Model</span><span>Status</span><span>Path / Size</span><span>Actions</span>
            </div>
            {models.map((model) => (
              <div className="model-row" key={model.id}>
                <div><strong>{model.role}</strong><small>{model.affects}</small></div>
                <div><strong>{model.currentModel}</strong>{model.preferredModel && <small>Preferred: {model.preferredModel}</small>}</div>
                <div><span className={`status-dot ${model.loaded || model.exists ? 'pass' : 'warn'}`} /> <small>{model.loaded ? 'Loaded' : model.exists ? 'On disk' : 'Missing'}</small></div>
                <div><strong>{model.sizeLabel}</strong><small className="mono">{model.diskPath}</small>{model.warning && <small className="warn-copy">{model.warning}</small>}</div>
                <div className="model-actions">
                  <button className="ghost-btn" onClick={() => void window.doReMi.openModelFolder(model.id)}><FolderOpen size={13} /> Open</button>
                  {model.id === 'songwriter-lm' && engineSettings && (
                    <button className="ghost-btn" disabled={modelBusy} onClick={() => void downloadModel(engineSettings.preferredLmModel)}><Download size={13} /> Download</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel">
          <div className="panel-head"><h3>Training &amp; Fine-Tuning Hub</h3></div>
          <p className="muted-copy">Safe tuning starts with LoRA/style adapters so base checkpoints stay untouched. Full model fine-tuning stays behind a future expert workflow.</p>
          <div className="feature-grid compact">
            <FeatureCard icon={<SlidersHorizontal size={18} />} title="Dataset Builder" desc="Import songs, captions and lyrics for style-adapter prep." onClick={() => soon('Dataset Builder')} />
            <FeatureCard icon={<Brain size={18} />} title="Auto Caption / Lyrics" desc="Use the selected 5Hz LM to label training samples." onClick={() => soon('Auto Label')} />
            <FeatureCard icon={<Wrench size={18} />} title="LoRA Training" desc="Train separate adapters without overwriting ACE base models." onClick={() => soon('LoRA Training')} />
            <FeatureCard icon={<RefreshCw size={18} />} title="Adapter Rollback" desc="Switch, unload or roll back trained adapters safely." onClick={() => soon('Adapter Rollback')} />
          </div>
        </div>

        <div className="glass-panel">
          <div className="panel-head"><h3>Expansion Roadmap</h3></div>
          <p className="muted-copy">These are now tracked as first-class DoReMii modules so the big dream features have a home instead of living as loose ideas.</p>
          <div className="feature-grid compact">
            <FeatureCard icon={<Palette size={18} />} title="Cover Art Generation" desc="Generate cover art from title, lyrics, mood, and final audio metadata." onClick={() => soon('Cover Art Generation')} />
            <FeatureCard icon={<SlidersHorizontal size={18} />} title="Album / Mix Cards" desc="Better Daily Mix, Neon Nights, Chill Vibes, and collection artwork." onClick={() => soon('Album / Mix Cards')} />
            <FeatureCard icon={<Cpu size={18} />} title="Stem Separation" desc="Split vocals, drums, bass, and melody with an optional local model." onClick={() => soon('Stem Separation')} />
            <FeatureCard icon={<Gauge size={18} />} title="Timeline Editor" desc="Arrange intro, verse, chorus, bridge, outro, repaints, and extensions visually." onClick={() => soon('Timeline Editor')} />
            <FeatureCard icon={<Wrench size={18} />} title="LoRA / Training Hub" desc="Build datasets and train safe style adapters without touching base checkpoints." onClick={() => soon('LoRA / Training Hub')} />
            <FeatureCard icon={<Brain size={18} />} title="Multi-Engine Backend" desc="Route ACE plus future local/open models under one Studio workflow." onClick={() => soon('Multi-Engine Backend')} />
            <FeatureCard icon={<Download size={18} />} title="DAW / Plugin Experiments" desc="Explore VST/bridge workflows for FL Studio, Ableton, Reaper, and more." onClick={() => soon('DAW / Plugin Experiments')} />
            <FeatureCard icon={<Palette size={18} />} title="Visualizer / Music Video" desc="Reactive visuals and later music-to-video tools tied to finished songs." onClick={() => soon('Visualizer / Music Video')} />
          </div>
        </div>

        <div className="glass-panel">
          <div className="panel-head"><h3>Models, GPU &amp; Updates</h3></div>
          <div className="feature-grid compact">
            <FeatureCard icon={<Cpu size={18} />} title="Model / GPU Settings" desc="8 GB VRAM profile, CPU offload, batch size, duration defaults." onClick={() => soon('Model / GPU Settings')} />
            <FeatureCard icon={<Gauge size={18} />} title="Performance Modes" desc="Fast Draft · Balanced · High Quality · Experimental." onClick={() => toast('Performance mode is set per-song in the Studio')} />
            <FeatureCard icon={<Download size={18} />} title="Update Manager" desc="Update the engine separately, with a backup first." onClick={() => soon('Update Manager')} />
            <FeatureCard icon={<Wrench size={18} />} title="Patch Manager" desc="Track local engine patches so updates don’t wipe them." onClick={() => soon('Patch Manager')} />
            <FeatureCard icon={<Download size={18} />} title="Export Center" desc="MP3, WAV, stems, JSON metadata, lyrics, prompt card." onClick={() => soon('Export Center')} />
            <FeatureCard icon={<Cpu size={18} />} title="Multi-Engine Backend" desc="ACE-Step plus other local / open models." onClick={() => soon('Multi-Engine Backend')} />
          </div>
        </div>
      </div>
    </section>
  )
}
