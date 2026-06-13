import { AudioLines, Bell, Palette, PenLine } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useUiStore } from '../../stores/uiStore'

function engineLabel(engine: ReturnType<typeof useAppStore.getState>['engine'], busy: boolean) {
  if (busy) return 'Working...'
  if (engine.health === 'ready') return 'Engine ready'
  if (engine.health === 'warming' || engine.state === 'starting') return 'Warming up... (click to force restart)'
  if (engine.state === 'error') return 'Engine error - click to restart'
  if (engine.state === 'stopped' || engine.health === 'unknown') return 'Start engine'
  return 'Engine unreachable - click to restart'
}

export function TopBar() {
  const { setRoute, setShowThemes, soon } = useUiStore()
  const { engine, busy, conductor, startEngine, stopEngine, restartEngine } = useAppStore()
  const engineReady = engine.health === 'ready'
  const warming = engine.health === 'warming' || engine.state === 'starting'

  // The pill always moves toward a working engine: ready -> stop;
  // stopped -> start; stuck/warming/error -> hard restart. The watchdog flips
  // a wedged engine to error on its own, but the click escape hatch means a
  // stuck "Warming up..." is never more than one click from recovery.
  function onPillClick() {
    if (engineReady) return void stopEngine()
    if (engine.state === 'stopped' || engine.health === 'unknown') return void startEngine()
    return void restartEngine()
  }

  return (
    <header className="topbar">
      <div className="topbar-nav">
        <button className="round-btn" onClick={() => setRoute('home')} aria-label="Home">‹</button>
        <button className="round-btn" onClick={() => setRoute('studio')} aria-label="Studio">›</button>
      </div>
      <div className="topbar-right">
        {conductor !== 'idle' && (
          <span className={`conductor-chip ${conductor}`} title="Only one heavy AI runs at a time to keep your GPU fast">
            {conductor === 'writer' ? <><PenLine size={13} /> Writer working</> : <><AudioLines size={13} /> Engine generating</>}
          </span>
        )}
        <button type="button" className="themes-trigger" onClick={() => setShowThemes(true)}>
          <Palette size={15} /> Themes
        </button>
        <button
          type="button"
          className={`engine-pill ${engineReady ? 'ready' : warming ? 'warming' : engine.state}`}
          onClick={onPillClick}
          disabled={busy}
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
