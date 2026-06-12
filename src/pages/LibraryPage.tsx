import { useState } from 'react'
import { FolderOpen, Heart, Info, Library, Play, Repeat2, Search, Trash2 } from 'lucide-react'
import { Cover } from '../components/ui/Cover'
import { useAppStore } from '../stores/appStore'
import { usePlayerStore } from '../stores/playerStore'
import { useUiStore } from '../stores/uiStore'

export function LibraryPage({ favoritesOnly }: { favoritesOnly: boolean }) {
  const songs = useAppStore((s) => s.songs)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const deleteSong = useAppStore((s) => s.deleteSong)
  const showInFolder = useAppStore((s) => s.showInFolder)
  const playSong = usePlayerStore((s) => s.playSong)
  const { setRoute, setDetail, soon } = useUiStore()
  const [search, setSearch] = useState('')

  const favorites = songs.filter((s) => s.favorite)
  const filtered = songs.filter((s) => !search || `${s.title} ${s.prompt} ${s.mode}`.toLowerCase().includes(search.toLowerCase()))
  const visible = favoritesOnly ? favorites : filtered

  return (
    <section className="page">
      <div className="section-head">
        <h2>{favoritesOnly ? 'Favorites' : 'Generation History'}</h2>
        <span className="hint">{visible.length} tracks</span>
      </div>
      {!favoritesOnly && (
        <div className="lib-search"><Search size={15} /><input placeholder="Search prompts, titles, modes…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      )}
      {visible.length ? (
        <div className="card-grid">
          {visible.map((song, index) => (
            <article className="media-card" key={song.id}>
              <div onClick={() => playSong(song)}><Cover hue={(index * 44 + 240) % 360} size="md" label /></div>
              <strong className="ellipsis">{song.title}</strong>
              <small className="ellipsis">{new Date(song.createdAt).toLocaleDateString()} · {song.mode}</small>
              <div className="card-actions">
                <button onClick={() => playSong(song)}><Play size={13} /></button>
                <button onClick={() => setDetail(song)}><Info size={13} /></button>
                <button className={song.favorite ? 'active' : ''} onClick={() => void toggleFavorite(song.id)}><Heart size={13} /></button>
                <button onClick={() => void showInFolder(song.id)}><FolderOpen size={13} /></button>
                <button onClick={() => soon('Remix Queue')}><Repeat2 size={13} /></button>
                <button onClick={() => { if (confirm(`Delete "${song.title}" from DoReMii?`)) void deleteSong(song.id) }}><Trash2 size={13} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Library size={22} />
          <strong>{favoritesOnly ? 'No favorites yet' : 'Your library is empty'}</strong>
          <p>{favoritesOnly ? 'Heart a track to keep it here.' : 'Generated songs land here automatically once the engine completes them.'}</p>
          <button className="cta" onClick={() => setRoute('studio')}>Open Studio</button>
        </div>
      )}
    </section>
  )
}
