import { useEffect, useState } from 'react'
import { AlertCircle, RotateCcw, X, Wand2 } from 'lucide-react'
import type { LyricsDraftSnapshot } from '../../shared/types'

interface Props {
  status: 'idle' | 'generating' | 'ready' | 'accepted' | 'error'
  error: string | null
  writerStage: string | null
  notes?: string[]
  startedAt?: number | null
  stageStartedAt?: number | null
  drafts?: LyricsDraftSnapshot[]
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

function lyricLines(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function changedLineSet(current: string, previous?: string | null) {
  if (!previous) return new Set<number>()
  const prev = new Set(lyricLines(previous).map((line) => line.toLowerCase()))
  const changed = new Set<number>()
  lyricLines(current).forEach((line, index) => {
    if (!/^\[[^\]]+\]$/.test(line) && !prev.has(line.toLowerCase())) changed.add(index)
  })
  return changed
}

export function BlueprintStatusPanel({ status, error, writerStage, notes = [], startedAt, stageStartedAt, drafts = [], onRetry, onCancel }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'generating') return
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [status])

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
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  const stageElapsed = stageStartedAt ? Math.max(0, Math.floor((now - stageStartedAt) / 1000)) : elapsed
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[drafts.length - 1] ?? null
  const previousDraft = selectedDraft ? drafts[drafts.findIndex((draft) => draft.id === selectedDraft.id) - 1] : null
  const scoreDelta = selectedDraft?.quality && previousDraft?.quality ? selectedDraft.quality.score - previousDraft.quality.score : null
  const changedLines = selectedDraft ? changedLineSet(selectedDraft.lyrics, selectedDraft.previousLyrics ?? previousDraft?.lyrics ?? null) : new Set<number>()
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
      <div className="blueprint-thoughts" aria-live="polite">
        <strong>Live writer notes</strong>
        {notes.length ? (
          <ul>
            {notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        ) : (
          <p>Preparing the song intent packet and waiting for the first writer update.</p>
        )}
      </div>
      {drafts.length > 0 && (
        <div className="blueprint-draft-tray">
          <div className="draft-tray-head">
            <strong>Draft snapshots</strong>
            <span>Compare how the song changes as the writer revises.</span>
          </div>
          <div className="draft-tabs" role="tablist" aria-label="Blueprint draft snapshots">
            {drafts.map((draft) => (
              <button
                key={draft.id}
                type="button"
                className={`draft-tab ${selectedDraft?.id === draft.id ? 'active' : ''}`}
                onClick={() => setSelectedDraftId(draft.id)}
              >
                {draft.label}
                {draft.quality && <span>{draft.quality.score}/100</span>}
              </button>
            ))}
          </div>
          {selectedDraft && (
            <div className="draft-preview">
              <div className="draft-preview-meta">
                <span>{selectedDraft.note}</span>
                {scoreDelta !== null && <span className={scoreDelta >= 0 ? 'delta-good' : 'delta-bad'}>{scoreDelta >= 0 ? '+' : ''}{scoreDelta} vs previous</span>}
                {selectedDraft.quality && <span>{selectedDraft.quality.verdict.replace('_', ' ')}</span>}
              </div>
              <div className="draft-compare-lines">
                {lyricLines(selectedDraft.lyrics).map((line, index) => (
                  <div key={`${index}-${line}`} className={changedLines.has(index) ? 'changed' : /^\[[^\]]+\]$/.test(line) ? 'tag-line' : 'kept'}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <code>{line}</code>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
