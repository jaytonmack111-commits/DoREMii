import { RefreshCw, X } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useUiStore } from '../../stores/uiStore'

export function SetupModal() {
  const { showSetup, setShowSetup } = useUiStore()
  const { setup, refreshAll } = useAppStore()

  if (!showSetup || !setup) return null

  return (
    <div className="modal-backdrop" onClick={() => setShowSetup(false)}>
      <section className="setup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div><span className="eyebrow">First-Run Setup</span><h2>{setup.checks.filter((c) => c.status === 'pass').length}/{setup.checks.length} checks passing</h2></div>
          <button className="ghost-btn close" onClick={() => setShowSetup(false)}><X size={16} /></button>
        </div>
        <div className="diagnostic-list">
          {setup.checks.map((check) => (
            <div className="diagnostic-row" key={check.id}><span className={`status-dot ${check.status}`} /><div><strong>{check.label}</strong><small>{check.detail}</small></div></div>
          ))}
        </div>
        <button className="generate-cta" onClick={() => void refreshAll()}><RefreshCw size={17} /> Recheck Setup</button>
      </section>
    </div>
  )
}
