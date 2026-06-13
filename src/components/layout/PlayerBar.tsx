import { Info, ListMusic, Minimize2, Pause, Play, Repeat, Settings, Shuffle, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { Cover } from '../ui/Cover'
import { formatTime, seekToFraction, setVolume, togglePlay } from '../../lib/audioController'
import { usePlayerStore } from '../../stores/playerStore'
import { useThemeStore } from '../../stores/themeStore'
import { useUiStore } from '../../stores/uiStore'

export function PlayerBar() {
  const { nowPlaying, playing, currentTime, duration, volume } = usePlayerStore()
  const theme = useThemeStore((s) => s.theme)
  const { setDetail, setRoute, soon, miniDocked, toggleMiniDock } = useUiStore()
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    seekToFraction((e.clientX - rect.left) / rect.width)
  }
  function handleVolume(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setVolume((e.clientX - rect.left) / rect.width)
  }

  return (
    <footer className="player-bar">
      <div className="player-track">
        {nowPlaying && miniDocked ? (
          <button className="ghost-icon docked-hint" onClick={toggleMiniDock} title="Show the track here again">
            <Minimize2 size={14} /> Docked to sidebar
          </button>
        ) : nowPlaying ? (
          <>
            <div className={`np-cover ${theme.spinningVinyl && playing ? 'spin' : ''}`}><Cover hue={250} size="sm" /></div>
            <span className="np-meta"><strong className="ellipsis">{nowPlaying.title}</strong><small className="ellipsis">DoReMii · {nowPlaying.mode}</small></span>
            <button className="ghost-icon" onClick={() => setDetail(nowPlaying)} title="Track details"><Info size={15} /></button>
            <button className="ghost-icon" onClick={toggleMiniDock} title="Dock to sidebar"><Minimize2 size={15} /></button>
          </>
        ) : (<span className="np-empty">Select a track to play</span>)}
      </div>
      <div className="player-center">
        <div className="transport">
          <button className="ghost-icon" onClick={() => soon('Shuffle')}><Shuffle size={16} /></button>
          <button className="ghost-icon" onClick={() => soon('Previous')}><SkipBack size={18} /></button>
          <button className={`play-main ${playing ? 'live' : ''}`} onClick={togglePlay} disabled={!nowPlaying}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
          <button className="ghost-icon" onClick={() => soon('Next')}><SkipForward size={18} /></button>
          <button className="ghost-icon" onClick={() => soon('Loop')}><Repeat size={16} /></button>
        </div>
        <div className="scrubber">
          <span>{formatTime(currentTime)}</span>
          <div className="scrub-track seekable" onClick={nowPlaying ? handleSeek : undefined}>
            <div className="scrub-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className="player-right">
        <button className="ghost-icon" onClick={() => soon('Play queue')}><ListMusic size={16} /></button>
        <Volume2 size={16} />
        <div className="scrub-track volume seekable" onClick={handleVolume}>
          <div className="scrub-fill" style={{ width: `${volume * 100}%` }} />
        </div>
        <button className="ghost-icon" onClick={() => setRoute('settings')}><Settings size={16} /></button>
      </div>
    </footer>
  )
}
