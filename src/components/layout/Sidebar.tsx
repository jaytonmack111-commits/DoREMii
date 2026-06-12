import { AudioLines, Compass, FlaskConical, Heart, Library, Music2, Pause, Play, Plus, Search, Sparkles } from 'lucide-react'
import { Cover } from '../ui/Cover'
import { togglePlay } from '../../lib/audioController'
import { usePlayerStore } from '../../stores/playerStore'
import { useUiStore, type RouteId } from '../../stores/uiStore'

const navItems: { id: RouteId; label: string; icon: typeof Sparkles }[] = [
  { id: 'home', label: 'Home', icon: Music2 },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'studio', label: 'Studio', icon: Sparkles },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'favorites', label: 'Favorites', icon: Heart },
  { id: 'labs', label: 'Labs', icon: FlaskConical },
]

export function Sidebar() {
  const { route, collapsed, setRoute, toggleCollapsed, toast, soon } = useUiStore()
  const { nowPlaying, playing } = usePlayerStore()

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <button className="brand" onClick={toggleCollapsed} title="Collapse / expand menu">
          <span className="brand-mark"><AudioLines size={20} /></span>
          {!collapsed && <span className="brand-text">DoReMii</span>}
        </button>
      </div>

      <button className="search-box" onClick={() => toast('Search is coming in a later pass')}>
        <Search size={15} />
        {!collapsed && <span className="search-ph">Search music…</span>}
        {!collapsed && <kbd>Ctrl K</kbd>}
      </button>

      <nav className="nav-list">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button className={route === item.id ? 'nav-item active' : 'nav-item'} key={item.id} onClick={() => setRoute(item.id)} title={item.label}>
              <Icon size={18} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {!collapsed && (
        <div className="playlists">
          <div className="playlists-head">
            <span>Playlists</span>
            <button aria-label="New playlist" onClick={() => soon('Playlists')}><Plus size={14} /></button>
          </div>
          <p className="playlists-empty">No playlists yet. Create one to organise your tracks.</p>
        </div>
      )}

      <div className="mini-player">
        {nowPlaying ? (
          <>
            <Cover hue={250} size="sm" />
            {!collapsed && <span className="mini-meta"><strong>{nowPlaying.title}</strong><small>{nowPlaying.mode}</small></span>}
            <button className="mini-play" onClick={togglePlay}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
          </>
        ) : (!collapsed && <span className="mini-empty">Nothing playing yet</span>)}
      </div>
    </aside>
  )
}
