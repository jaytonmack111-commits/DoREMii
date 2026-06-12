import { useEffect, useState } from 'react'
import { AlertCircle, RotateCcw, X, Wand2 } from 'lucide-react'

interface Props {
  status: 'idle' | 'generating' | 'ready' | 'accepted' | 'error'
  error: string | null
  writerStage: string | null
  onRetry: () => void
  onCancel: () => void
}

const STAGES = [
  { id: 'planning', label: 'Planning' },
  { id: 'drafting', label: 'Drafting' },
  { id: 'self-critique', label: 'Self-critique' },
  { id: 'rewrite', label: 'Rewrite' },
  { id: 'finalizing', label: 'Finalizing' },
]

function formatTimer(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function BlueprintStatusPanel({ status, error, writerStage, onRetry, onCancel }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const [stageElapsed, setStageElapsed] = useState(0)

  useEffect(() => {
    if (status !== 'generating') {
      const reset = window.setTimeout(() => {
        setElapsed(0)
        setStageElapsed(0)
      }, 0)
      return () => clearTimeout(reset)
    }

    const timer = window.setInterval(() => {
      setElapsed((prev) => prev + 1)
      setStageElapsed((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [status])

  useEffect(() => {
    if (status !== 'generating') return
    const reset = window.setTimeout(() => setStageElapsed(0), 0)
    return () => clearTimeout(reset)
  }, [writerStage, status])

  if (status === 'idle' || status === 'ready' || status === 'accepted') return null
  if (status === 'error') {
    return (
      <div className="blueprint-status error-state">
        <div className="error-header">
          <AlertCircle size={20} />
          <span>Generation Failed</span>
        </div>
        <details className="error-details">
          <summary>View Technical Details</summary>
          <pre>{error}</pre>
        </details>
        <div className="error-actions">
          <button className="mini-action accent" onClick={onRetry}><RotateCcw size={14} /> Retry</button>
          <button className="mini-action danger" onClick={onCancel}><X size={14} /> Cancel</button>
        </div>
      </div>
    )
  }

  // Active stage logic
  let activeIndex = STAGES.findIndex(s => s.id === writerStage)
  if (activeIndex === -1 && writerStage) {
    if (writerStage.includes('critique')) activeIndex = 2
    else if (writerStage.includes('rewrite')) activeIndex = 3
    else activeIndex = 0
  }
  return (
    <div className="blueprint-status generating-state">
      <div className="gen-header">
        <div className="pulse-icon"><Wand2 size={16} /></div>
        <div className="gen-title">
          <strong>Synthesizing Blueprint...</strong>
          <span className="elapsed-timer">Elapsed: {formatTimer(elapsed)}</span>
        </div>
        <button className="mini-action" onClick={onCancel} title="Cancel generation"><X size={14} /> Cancel</button>
      </div>

      <div className="stage-tracker">
        {STAGES.map((stage, i) => {
          const isActive = i === activeIndex
          const isDone = i < activeIndex
          return (
            <div key={stage.id} className={`stage-item ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
              <div className="stage-bullet" />
              <span className="stage-label">{stage.label}</span>
              {isActive && <span className="stage-timer">{formatTimer(stageElapsed)}</span>}
            </div>
          )
        })}
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${Math.max(5, ((activeIndex + 1) / STAGES.length) * 100)}%` }} />
      </div>
    </div>
  )
}
