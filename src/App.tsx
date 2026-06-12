import { useEffect, useRef } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { PlayerBar } from './components/layout/PlayerBar'
import { ThemesDrawer } from './components/drawers/ThemesDrawer'
import { TrackDetailDrawer } from './components/drawers/TrackDetailDrawer'
import { WritersRoom } from './components/WritersRoom'
import { SetupModal } from './components/drawers/SetupModal'
import { HomePage } from './pages/HomePage'
import { StudioPage } from './pages/StudioPage'
import { LibraryPage } from './pages/LibraryPage'
import { ExplorePage } from './pages/ExplorePage'
import { LabsPage } from './pages/LabsPage'
import { SettingsPage } from './pages/SettingsPage'
import { initApp } from './stores/appStore'
import { applyThemeToDom, useThemeStore } from './stores/themeStore'
import { usePlayerStore } from './stores/playerStore'
import { useUiStore } from './stores/uiStore'
import { fileUrl } from './lib/media'
import { registerAudioElement } from './lib/audioController'
import './styles.css'

function App() {
  const route = useUiStore((s) => s.route)
  const collapsed = useUiStore((s) => s.collapsed)
  const toastMsg = useUiStore((s) => s.toastMsg)
  const theme = useThemeStore((s) => s.theme)
  const { nowPlaying, playing, volume, setPlaying, setProgress } = usePlayerStore()
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => { applyThemeToDom(theme) }, [theme])
  useEffect(() => { initApp() }, [])
  useEffect(() => {
    registerAudioElement(audioRef.current)
    if (audioRef.current) audioRef.current.volume = volume
  })

  const shellClass = [
    'app-shell', `bg-${theme.bgStyle}`, collapsed ? 'nav-collapsed' : '',
    theme.filmGrain ? 'film-grain' : '', theme.reduceMotion || !theme.animations ? 'reduce-motion' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={shellClass}>
      <Sidebar />

      <div className="content">
        <TopBar />
        <main className="scroll-area">
          {route === 'home' && <HomePage />}
          {route === 'studio' && <StudioPage />}
          {route === 'library' && <LibraryPage favoritesOnly={false} />}
          {route === 'favorites' && <LibraryPage favoritesOnly />}
          {route === 'explore' && <ExplorePage />}
          {route === 'labs' && <LabsPage />}
          {route === 'settings' && <SettingsPage />}
        </main>
        <PlayerBar />
      </div>

      {nowPlaying?.audioPath ? (
        <audio
          ref={audioRef}
          src={fileUrl(nowPlaying.audioPath)}
          autoPlay={playing}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime, e.currentTarget.duration)}
          onLoadedMetadata={(e) => setProgress(e.currentTarget.currentTime, e.currentTarget.duration)}
        />
      ) : null}

      {toastMsg && <div className="toast">{toastMsg}</div>}

      <TrackDetailDrawer />
      <ThemesDrawer />
      <SetupModal />
      <WritersRoom />
    </div>
  )
}

export default App
