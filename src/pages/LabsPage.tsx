import { FlaskConical } from 'lucide-react'
import { FeatureCard } from '../components/ui/FeatureCard'
import { LAB_FEATURES } from '../lib/constants'
import { useUiStore } from '../stores/uiStore'

export function LabsPage() {
  const soon = useUiStore((s) => s.soon)

  return (
    <section className="page">
      <div className="section-head"><h2>Labs</h2><span className="hint">Advanced features in development</span></div>
      <p className="muted-copy">These are the deeper creative tools on the roadmap. Each one is wired into the app shell so it’s ready to light up as the backend lands.</p>
      <div className="feature-grid">
        {LAB_FEATURES.map((f) => (
          <FeatureCard key={f.title} icon={<FlaskConical size={18} />} title={f.title} desc={f.desc} badge="Planned" onClick={() => soon(f.title)} />
        ))}
      </div>
    </section>
  )
}
