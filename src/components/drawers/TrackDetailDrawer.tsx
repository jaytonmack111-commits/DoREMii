import { useState } from 'react'
import { Download, FolderOpen, Heart, Music2, Play, Repeat2, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { Cover } from '../ui/Cover'
import { useAppStore } from '../../stores/appStore'
import { usePlayerStore } from '../../stores/playerStore'
import { useUiStore } from '../../stores/uiStore'

export function TrackDetailDrawer() {
  const { detail, setDetail, soon } = useUiStore()
  const { songs, renameSong, toggleFavorite, deleteSong, showInFolder } = useAppStore()
  const playSong = usePlayerStore((s) => s.playSong)
  const liveDetail = detail ? songs.find((song) => song.id === detail.id) ?? detail : null
  if (!liveDetail) return null

  return (
    <>
      <div className="drawer-backdrop" onClick={() => setDetail(null)} />
      <aside className="detail-drawer" role="dialog" aria-label="Track details">
        <header className="drawer-head">
          <div className="drawer-title"><Music2 size={18} /><strong>Track Details</strong></div>
          <button className="ghost-btn close" onClick={() => setDetail(null)}><X size={16} /></button>
        </header>
        <div className="drawer-body">
          <div className="detail-hero">
            <Cover hue={250} size="lg" label />
            <div>
              <h3>{liveDetail.title}</h3>
              <small>{liveDetail.mode} · {new Date(liveDetail.createdAt).toLocaleString()}</small>
            </div>
          </div>

          <RenameRow key={liveDetail.id} id={liveDetail.id} currentTitle={liveDetail.title} onRename={renameSong} />

          <div className="meta-grid">
            <div><span>Mode</span><strong>{liveDetail.mode}</strong></div>
            <div><span>Created</span><strong>{new Date(liveDetail.createdAt).toLocaleDateString()}</strong></div>
            <div className="wide"><span>Prompt</span><strong>{liveDetail.prompt || '-'}</strong></div>
            {liveDetail.lyrics && <div className="wide"><span>Lyrics</span><strong className="pre">{liveDetail.lyrics}</strong></div>}
            <div className="wide"><span>File</span><strong className="path">{liveDetail.audioPath || '-'}</strong></div>
          </div>

          <div className="detail-actions">
            <button className="generate-cta compact" onClick={() => playSong(liveDetail)}><Play size={15} /> Play</button>
            <button className="ghost-btn" onClick={() => soon('Regenerate from seed')}><RotateCcw size={14} /> Regenerate</button>
            <button className="ghost-btn" onClick={() => soon('Remix Queue')}><Repeat2 size={14} /> Remix</button>
            <button className="ghost-btn" onClick={() => soon('Export Center')}><Download size={14} /> Export</button>
            <button className="ghost-btn" onClick={() => void toggleFavorite(liveDetail.id)}><Heart size={14} /> {liveDetail.favorite ? 'Unfavorite' : 'Favorite'}</button>
            <button className="ghost-btn" onClick={() => void showInFolder(liveDetail.id)}><FolderOpen size={14} /> Folder</button>
            <button className="ghost-btn danger" onClick={() => { if (confirm(`Delete "${liveDetail.title}" from DoReMii?`)) void deleteSong(liveDetail.id) }}><Trash2 size={14} /> Delete</button>
          </div>
        </div>
      </aside>
    </>
  )
}

function RenameRow({ id, currentTitle, onRename }: { id: string; currentTitle: string; onRename: (id: string, title: string) => Promise<void> }) {
  const [title, setTitle] = useState(currentTitle)

  return (
    <div className="rename-row">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Track title" />
      <button className="ghost-btn" onClick={() => void onRename(id, title)} disabled={!title.trim() || title.trim() === currentTitle}>
        <Save size={14} /> Rename
      </button>
    </div>
  )
}
