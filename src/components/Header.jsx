export default function Header({ onReset }) {
  return (
    <header style={{
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
      padding: '0 1.5rem',
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{
          width: 28, height: 28, background: 'var(--accent)',
          borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 14V6l6-4 6 4v8H10v-4H6v4H2z" fill="#0d0f14"/>
          </svg>
        </div>
        <span style={{
          fontFamily: 'DM Serif Display, serif',
          fontSize: '1.1rem',
          color: 'var(--text)',
          letterSpacing: '0.01em'
        }}>
          Credit Agent
        </span>
      </div>
      {onReset && (
        <button
          onClick={onReset}
          style={{
            background: 'none',
            border: '1px solid var(--border2)',
            color: 'var(--text2)',
            padding: '0.3rem 0.9rem',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
          onMouseOver={e => e.target.style.borderColor = 'var(--accent)'}
          onMouseOut={e => e.target.style.borderColor = 'var(--border2)'}
        >
          ← New Analysis
        </button>
      )}
    </header>
  )
}
