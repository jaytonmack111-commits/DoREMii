import { useMemo } from 'react'

/** Procedural synthwave cover art. Deterministic per `hue` + `seed`, so a
 *  song always keeps the same artwork between renders and sessions. */
export function Cover({ hue, seed = 0, size = 'md', label, src }: {
  hue: number
  seed?: number
  size?: 'sm' | 'md' | 'lg'
  label?: boolean
  src?: string | null
}) {
  void label // retained for call-site compatibility; art no longer needs the glyph
  const mediaSrc = src ? `doremi-media://cover?path=${encodeURIComponent(src)}` : null
  const variant = Math.abs(Math.round(hue + seed * 7)) % 3
  const h2 = (hue + 60) % 360

  const svg = useMemo(() => {
    const sun = `
      <defs>
        <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="hsl(${(hue + 40) % 360} 95% 70%)"/>
          <stop offset="1" stop-color="hsl(${hue} 90% 55%)"/>
        </linearGradient>
      </defs>
      <circle cx="50" cy="46" r="24" fill="url(#s)"/>
      <g stroke="hsl(${hue} 70% 12%)" stroke-width="2.5">
        <line x1="22" y1="44" x2="78" y2="44"/><line x1="22" y1="51" x2="78" y2="51"/>
        <line x1="22" y1="58" x2="78" y2="58"/><line x1="22" y1="65" x2="78" y2="65"/>
      </g>
      <g fill="hsl(${h2} 60% 16%)">
        <rect x="0" y="70" width="100" height="30"/>
        <rect x="8" y="56" width="9" height="16"/><rect x="22" y="62" width="7" height="10"/>
        <rect x="66" y="58" width="10" height="14"/><rect x="82" y="63" width="8" height="9"/>
      </g>
      <g fill="hsl(${(hue + 320) % 360} 90% 65%)" opacity="0.8">
        <rect x="10" y="59" width="2" height="2"/><rect x="13" y="63" width="2" height="2"/>
        <rect x="68" y="61" width="2" height="2"/><rect x="71" y="65" width="2" height="2"/>
      </g>`
    const grid = `
      <g stroke="hsl(${h2} 90% 62%)" stroke-width="1" opacity="0.85">
        <line x1="50" y1="58" x2="6" y2="100"/><line x1="50" y1="58" x2="28" y2="100"/>
        <line x1="50" y1="58" x2="50" y2="100"/><line x1="50" y1="58" x2="72" y2="100"/>
        <line x1="50" y1="58" x2="94" y2="100"/>
        <line x1="8" y1="72" x2="92" y2="72"/><line x1="2" y1="84" x2="98" y2="84"/>
      </g>
      <circle cx="50" cy="38" r="17" fill="hsl(${hue} 92% 62%)"/>
      <circle cx="50" cy="38" r="17" fill="none" stroke="hsl(${(hue + 30) % 360} 95% 75%)" stroke-width="1.5" opacity="0.7"/>
      <ellipse cx="50" cy="58" rx="48" ry="3" fill="hsl(${hue} 90% 60%)" opacity="0.35"/>`
    const waves = `
      <g fill="none" stroke-width="2.4" stroke-linecap="round">
        <path d="M0 64 Q 18 46 36 60 T 70 58 T 100 52" stroke="hsl(${hue} 92% 62%)"/>
        <path d="M0 76 Q 22 60 44 72 T 100 66" stroke="hsl(${h2} 90% 60%)" opacity="0.85"/>
        <path d="M0 52 Q 26 38 50 48 T 100 40" stroke="hsl(${(hue + 300) % 360} 88% 66%)" opacity="0.7"/>
      </g>
      <circle cx="76" cy="26" r="11" fill="hsl(${(hue + 40) % 360} 95% 68%)" opacity="0.9"/>`
    const scene = variant === 0 ? sun : variant === 1 ? grid : waves
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${scene}</svg>`
  }, [hue, h2, variant])

  return (
    <div
      className={`cover cover-${size}`}
      style={{
        background:
          `radial-gradient(circle at 50% 120%, hsl(${hue} 90% 45% / 0.55), transparent 60%),` +
          `radial-gradient(circle at 20% 0%, hsl(${h2} 85% 50% / 0.4), transparent 55%),` +
          `linear-gradient(175deg, hsl(${(hue + 250) % 360} 55% 14%), hsl(${hue} 65% 8%) 70%)`,
      }}
    >
      <span
        className="cover-art"
        style={{ backgroundImage: mediaSrc ? `url("${mediaSrc}")` : `url("data:image/svg+xml,${encodeURIComponent(svg)}")` }}
      />
    </div>
  )
}
