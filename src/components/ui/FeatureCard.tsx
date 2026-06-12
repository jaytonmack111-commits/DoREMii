import type { ReactNode } from 'react'

export function FeatureCard({ icon, title, desc, badge, onClick }: {
  icon: ReactNode
  title: string
  desc: string
  badge?: string
  onClick?: () => void
}) {
  return (
    <button className="feature-card" onClick={onClick}>
      <span className="feature-icon">{icon}</span>
      <span className="feature-body">
        <strong>{title}{badge && <em className="feature-badge">{badge}</em>}</strong>
        <small>{desc}</small>
      </span>
    </button>
  )
}
