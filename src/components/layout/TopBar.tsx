import { Bell, Palette } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useUiStore } from '../../stores/uiStore'

function engineLabel(engine: ReturnType<typeof useAppStore.getState>['engine'], busy: boolean) {
  if (busy) return 'Working...'
  if (engine.health === 'ready') return 'Engine ready'
  if (engine.health === 'warming' || engine.state === 'starting') return 'Warming up...'
  if (engine.state === 'error') return 'Engine error'
  return 'Starting...'
}

export function TopBar() {
  const { setRoute, setShowThemes, soon } = useUiStore()
  const { engine, busy, startEngine, stopEngine } = useAppStore()
  const engineReady = engine.health === 'ready'
  const warming = engine.health === 'warming' || engine.state === 'starting'

  return (
    <header className="topbar">
      <div className="topbar-nav">
        <button className="round-btn" onClick={() => setRoute('home')} aria-label="Home">‹</button>
        <button className="round-btn" onClick={() => setRoute('studio')} aria-label="Studio">›</button>
      </div>
      <div className="topbar-right">
        <button type="button" className="themes-trigger" onClick={() => setShowThemes(true)}>
          <Palette size={15} /> Themes
        </button>
        <button
          type="button"
          className={`engine-pill ${engineReady ? 'ready' : warming ? 'warming' : engine.state}`}
          onClick={() => (engineReady ? void stopEngine() : void startEngine())}
          disabled={busy || warming}
          title={engine.lastError || engine.lastLogLine || 'Local music engine'}
        >
          <span className={`status-dot ${engineReady ? 'ready' : warming ? 'starting' : engine.state}`} />
          {engineLabel(engine, busy)}
        </button>
        <button type="button" className="ghost-icon" aria-label="Notifications" onClick={() => soon('Notifications')}>
          <Bell size={16} />
        </button>
        <button type="button" className="avatar" aria-label="Profile and settings" onClick={() => setRoute('settings')}>
          <span className="avatar-glyph">N</span>
        </button>
      </div>
    </header>
  )
}
