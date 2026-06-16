import { Heart, Info, MoreHorizontal, Play, Sparkles } from 'lucide-react'
import { Cover } from '../components/ui/Cover'
import { FEATURED, TEMPLATES } from '../lib/constants'
import { useAppStore } from '../stores/appStore'
import { usePlayerStore } from '../stores/playerStore'
import { useStudioStore } from '../stores/studioStore'
import { useUiStore } from '../stores/uiStore'

function greetingForNow() {
  const hour = new Date().getHours()
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function HomePage() {
  const songs = useAppStore((s) => s.songs)
  const playSong = usePlayerStore((s) => s.playSong)
  const applyTemplate = useStudioStore((s) => s.applyTemplate)
  const { setRoute, setDetail } = useUiStore()

  return (
    <section className="page">
      <div className="greeting">
        <h1>{greetingForNow()}, Nick<span className="wave-emoji"> 👋</span></h1>
        <p className="sub">Pick up where you left off, or start something new in the Studio.</p>
      </div>

      <div className="featured-row">
        {FEATURED.map((mix) => (
          <article className="featured-card" key={mix.id} onClick={() => setRoute('library')}>
            <Cover hue={mix.hue} size="lg" label />
            <div className="featured-meta"><small>{mix.label}</small><strong>{mix.title}</strong></div>
            <button className="play-fab"><Play size={16} /></button>
          </article>
        ))}
      </div>

      <div className="section-head"><h2>Start something</h2><button className="link-btn" onClick={() => setRoute('studio')}>Open Studio</button></div>
      <div className="template-row">
        {TEMPLATES.map((t) => (
          <button className="template-card" key={t.name} onClick={() => applyTemplate(t)}>
            <Sparkles size={16} />
            <strong>{t.name}</strong>
            <small className="ellipsis">{t.idea}</small>
          </button>
        ))}
      </div>

      <div className="section-head"><h2>Recently Played</h2><button className="link-btn" onClick={() => setRoute('library')}>View all</button></div>
      {songs.length ? (
        <div className="card-grid">
          {songs.slice(0, 8).map((song, index) => (
            <article className="media-card" key={song.id} onClick={() => playSong(song)}>
              <Cover hue={(index * 48 + 260) % 360} size="md" label src={song.coverArtPath} />
              <strong className="ellipsis">{song.title}</strong>
              <small className="ellipsis">{song.mode} · DoReMii</small>
              <button className="play-fab sm"><Play size={14} /></button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Sparkles size={22} />
          <strong>No tracks yet</strong>
          <p>Head to the Studio and generate your first song — it’ll appear here automatically.</p>
          <button className="cta" onClick={() => setRoute('studio')}>Open Studio</button>
        </div>
      )}

      <div className="section-head"><h2>Trending in Your Library</h2></div>
      <div className="track-list">
        {songs.length ? songs.slice(0, 5).map((song, index) => (
          <div className="track-row" key={song.id} onClick={() => playSong(song)}>
            <span className="rank">{String(index + 1).padStart(2, '0')}</span>
            <Cover hue={(index * 40 + 200) % 360} size="sm" label src={song.coverArtPath} />
            <span className="track-row-meta"><strong className="ellipsis">{song.title}</strong><small className="ellipsis">{song.prompt.slice(0, 60)}</small></span>
            <button className="ghost-icon" onClick={(e) => { e.stopPropagation(); setDetail(song) }}><Info size={15} /></button>
            <button className="ghost-icon"><Heart size={15} /></button>
            <button className="ghost-icon"><MoreHorizontal size={15} /></button>
          </div>
        )) : (<div className="track-row muted-row">Generate a few songs to see what’s rising in your library.</div>)}
      </div>
    </section>
  )
}
