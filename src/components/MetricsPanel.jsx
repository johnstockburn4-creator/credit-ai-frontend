function fmt(v, basis) {
  if (v === null || v === undefined) return '—'
  const s = basis === 'millions' ? 'MM' : basis === 'thousands' ? 'K' : ''
  return `$${parseFloat(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}${s}`
}
function fmtx(v) { return v == null ? '—' : `${parseFloat(v).toFixed(2)}x` }
function fmtp(v) { return v == null ? '—' : `${(parseFloat(v) * 100).toFixed(1)}%` }

function Row({ label, values, format, highlight }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{
        padding: '0.5rem 0.75rem',
        color: 'var(--text3)',
        fontSize: '0.85rem',
        whiteSpace: 'nowrap'
      }}>
        {label}
      </td>
      {values.map((v, i) => (
        <td key={i} style={{
          padding: '0.5rem 0.75rem',
          textAlign: 'right',
          fontFamily: 'DM Mono, monospace',
          fontSize: '0.85rem',
          color: highlight && i === 0
            ? 'var(--accent)'
            : v === '—' ? 'var(--text3)' : 'var(--text)',
          fontWeight: highlight && i === 0 ? 600 : 400,
        }}>
          {format ? format(v) : v}
        </td>
      ))}
    </tr>
  )
}

function Section({ title, rows, periods, basis }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <p style={{
        fontSize: '0.72rem', fontWeight: 600, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: '0.5rem', paddingLeft: '0.75rem'
      }}>
        {title}
      </p>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border2)' }}>
              <th style={{
                padding: '0.5rem 0.75rem', textAlign: 'left',
                fontSize: '0.75rem', color: 'var(--text3)', fontWeight: 500
              }}>
                Metric
              </th>
              {periods.map(p => (
                <th key={p} style={{
                  padding: '0.5rem 0.75rem', textAlign: 'right',
                  fontSize: '0.75rem', color: 'var(--text3)', fontWeight: 500,
                  fontFamily: 'DM Mono, monospace'
                }}>
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <Row
                key={i}
                label={row.label}
                values={periods.map(p => row.getter(p))}
                format={row.format || (v => fmt(v, basis))}
                highlight={row.highlight}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ScoreCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '0.9rem 1rem'
    }}>
      <p style={{
        fontSize: '0.72rem', color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem'
      }}>
        {label}
      </p>
      <p style={{
        fontFamily: 'DM Mono, monospace',
        fontSize: '1.4rem', fontWeight: 600,
        color, marginBottom: '0.15rem'
      }}>
        {value}
      </p>
      <p style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{sub}</p>
    </div>
  )
}

export default function MetricsPanel({ extracted }) {
  if (!extracted || !extracted.periods?.length) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text3)' }}>
        No metrics extracted.
      </div>
    )
  }

  const periods     = extracted.periods
  const periodNames = periods.map(p => p.period_name)
  const basis       = extracted.statement_basis || 'actual'

  const get = (pName, section, key) => {
    const p = periods.find(x => x.period_name === pName)
    if (!p) return null
    const v = (p[section] || {})[key]
    return v === undefined || v === null ? null : v
  }
  const dm = (pName, key) => get(pName, 'derived_metrics', key)

  const p0dm     = periods[0]?.derived_metrics || {}
  const pdScore  = p0dm.pd_score
  const pdRating = p0dm.credit_rating
  const zScore   = p0dm.altman_z_score

  return (
    <div>
      {/* Score cards */}
      {(pdScore != null || zScore != null) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1.5rem'
        }}>
          {pdScore != null && (
            <ScoreCard
              label="PD Score"
              value={`${Math.round(pdScore)}/12`}
              sub={pdRating}
              color={pdScore <= 3 ? 'var(--green)' : pdScore <= 6 ? 'var(--accent)' : 'var(--red)'}
            />
          )}
          {zScore != null && (
            <ScoreCard
              label="Altman Z-Score"
              value={parseFloat(zScore).toFixed(2)}
              sub={zScore > 2.9 ? 'Safe Zone' : zScore > 1.23 ? 'Grey Zone' : 'Distress Zone'}
              color={zScore > 2.9 ? 'var(--green)' : zScore > 1.23 ? 'var(--accent)' : 'var(--red)'}
            />
          )}
          {dm(periodNames[0], 'leverage_total_debt_to_ebitda') != null && (
            <ScoreCard
              label="Leverage"
              value={fmtx(dm(periodNames[0], 'leverage_total_debt_to_ebitda'))}
              sub="Debt / EBITDA"
              color="var(--blue)"
            />
          )}
          {dm(periodNames[0], 'fcc') != null && (
            <ScoreCard
              label="FCC"
              value={fmtx(dm(periodNames[0], 'fcc'))}
              sub="Fixed Charge Coverage"
              color="var(--blue)"
            />
          )}
        </div>
      )}

      <Section title="Income Statement" basis={basis} periods={periodNames} rows={[
        { label: 'Revenue',             getter: p => get(p, 'income_statement', 'revenue') },
        { label: 'Cost of Sales',       getter: p => get(p, 'income_statement', 'cost_of_sales') },
        { label: 'Gross Profit',        getter: p => {
          const r = get(p, 'income_statement', 'revenue')
          const c = get(p, 'income_statement', 'cost_of_sales')
          return r != null && c != null ? r - c : null
        }},
        { label: 'SG&A',                getter: p => get(p, 'income_statement', 'sga_expense') },
        { label: 'Operating Income',    getter: p => get(p, 'income_statement', 'operating_income') },
        { label: 'EBITDA',              getter: p => get(p, 'income_statement', 'ebitda'), highlight: true },
        { label: 'EBITDA Margin',       getter: p => dm(p, 'ebitda_margin'), format: fmtp },
        { label: 'Net Income',          getter: p => get(p, 'income_statement', 'net_income') },
        { label: 'D&A',                 getter: p => get(p, 'income_statement', 'depreciation_amortization') },
        { label: 'Rent Expense',        getter: p => get(p, 'income_statement', 'rent_expense') },
      ]} />

      <Section title="Balance Sheet" basis={basis} periods={periodNames} rows={[
        { label: 'Cash',                getter: p => get(p, 'balance_sheet', 'cash') },
        { label: 'Total Assets',        getter: p => get(p, 'balance_sheet', 'total_assets') },
        { label: 'Total Liabilities',   getter: p => get(p, 'balance_sheet', 'total_liabilities') },
        { label: 'Total Equity',        getter: p => get(p, 'balance_sheet', 'total_equity') },
        { label: 'Total Debt',          getter: p => get(p, 'balance_sheet', 'total_debt'), highlight: true },
        { label: 'Long-term Debt',      getter: p => get(p, 'balance_sheet', 'long_term_debt') },
        { label: 'Current Portion LTD', getter: p => get(p, 'balance_sheet', 'current_portion_long_term_debt') },
        { label: 'Revolver Size',       getter: p => get(p, 'balance_sheet', 'revolver_facility_size') },
        { label: 'Revolver Drawn',      getter: p => get(p, 'balance_sheet', 'revolver_borrowings') },
        { label: 'Revolver Avail',      getter: p => get(p, 'balance_sheet', 'revolver_availability') },
      ]} />

      <Section title="Cash Flow" basis={basis} periods={periodNames} rows={[
        { label: 'Operating Cash Flow', getter: p => get(p, 'cash_flow', 'cfo') },
        { label: 'Investing Cash Flow', getter: p => get(p, 'cash_flow', 'cfi') },
        { label: 'Financing Cash Flow', getter: p => get(p, 'cash_flow', 'cff') },
        { label: 'Capex',               getter: p => get(p, 'cash_flow', 'capex') },
        { label: 'Free Cash Flow',      getter: p => dm(p, 'free_cash_flow'), highlight: true },
        { label: 'Cash Interest Paid',  getter: p => get(p, 'cash_flow', 'cash_paid_for_interest') },
        { label: 'Cash Taxes Paid',     getter: p => get(p, 'cash_flow', 'cash_paid_for_income_taxes') },
        { label: 'Dividends Paid',      getter: p => get(p, 'cash_flow', 'dividends_distributions_paid') },
      ]} />

      <Section title="Credit Metrics" basis={basis} periods={periodNames} rows={[
        { label: 'Leverage (Debt/EBITDA)', getter: p => dm(p, 'leverage_total_debt_to_ebitda'), format: fmtx, highlight: true },
        { label: 'FCC',                    getter: p => dm(p, 'fcc'), format: fmtx, highlight: true },
        { label: 'EBITDA Margin',          getter: p => dm(p, 'ebitda_margin'), format: fmtp },
        { label: 'Free Cash Flow',         getter: p => dm(p, 'free_cash_flow') },
        { label: 'FCC Numerator',          getter: p => dm(p, 'fcc_numerator') },
        { label: 'FCC Denominator',        getter: p => dm(p, 'fcc_denominator') },
        { label: 'Altman Z-Score',         getter: p => dm(p, 'altman_z_score'), format: v => v == null ? '—' : parseFloat(v).toFixed(2) },
      ]} />
    </div>
  )
}
