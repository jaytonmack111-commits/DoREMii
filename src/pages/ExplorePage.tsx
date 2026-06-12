import { Compass, Play } from 'lucide-react'
import { Cover } from '../components/ui/Cover'
import { FEATURED } from '../lib/constants'

export function ExplorePage() {
  return (
    <section className="page">
      <div className="section-head"><h2>Explore</h2></div>
      <div className="featured-row">
        {FEATURED.map((mix) => (
          <article className="featured-card" key={mix.id}>
            <Cover hue={mix.hue} size="lg" label />
            <div className="featured-meta"><small>Auto playlist</small><strong>{mix.title}</strong></div>
            <button className="play-fab"><Play size={16} /></button>
          </article>
        ))}
      </div>
      <div className="empty-state subtle">
        <Compass size={22} /><strong>Explore grows with your library</strong>
        <p>As you generate and favourite more music, DoReMii builds smarter auto-playlists and radios from your own tracks.</p>
      </div>
    </section>
  )
}
