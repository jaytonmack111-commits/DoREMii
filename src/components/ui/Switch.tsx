export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={on ? 'switch on' : 'switch'} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}
