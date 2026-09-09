import { useState, useEffect } from 'react'

const RULE_TYPES = [
  { value: 'label',     label: 'Wrong line item — use a different label' },
  { value: 'section',   label: 'Wrong section — look in a different part of the document' },
  { value: 'exclusion', label: 'Too broad — exclude certain labels from matching' },
]

const ALL_FIELDS = {
  'Income Statement': [
    { key: 'revenue',                   label: 'Revenue' },
    { key: 'cost_of_sales',             label: 'Cost of Sales' },
    { key: 'sga_expense',               label: 'SG&A' },
    { key: 'operating_income',          label: 'Operating Income' },
    { key: 'ebitda',                    label: 'EBITDA' },
    { key: 'net_income',                label: 'Net Income' },
    { key: 'interest_expense',          label: 'Interest Expense' },
    { key: 'income_tax_expense',        label: 'Income Tax Expense' },
    { key: 'depreciation_amortization', label: 'D&A' },
    { key: 'rent_expense',              label: 'Rent / Lease Expense' },
  ],
  'Balance Sheet': [
    { key: 'cash',                            label: 'Cash' },
    { key: 'total_assets',                    label: 'Total Assets' },
    { key: 'total_liabilities',               label: 'Total Liabilities' },
    { key: 'total_equity',                    label: 'Total Equity' },
    { key: 'total_debt',                      label: 'Total Debt' },
    { key: 'long_term_debt',                  label: 'Long-term Debt' },
    { key: 'current_portion_long_term_debt',  label: 'Current Portion LTD' },
    { key: 'revolver_facility_size',          label: 'Revolver Facility Size' },
    { key: 'revolver_borrowings',             label: 'Revolver Borrowings' },
    { key: 'revolver_availability',           label: 'Revolver Availability' },
  ],
  'Cash Flow': [
    { key: 'cfo',                           label: 'Operating Cash Flow' },
    { key: 'cfi',                           label: 'Investing Cash Flow' },
    { key: 'cff',                           label: 'Financing Cash Flow' },
    { key: 'capex',                         label: 'Capex' },
    { key: 'cash_paid_for_interest',        label: 'Cash Paid for Interest' },
    { key: 'cash_paid_for_income_taxes',    label: 'Cash Paid for Taxes' },
    { key: 'dividends_distributions_paid',  label: 'Dividends Paid' },
  ],
}

const SECTION_MAP = {
  revenue: 'income_statement', cost_of_sales: 'income_statement',
  sga_expense: 'income_statement', operating_income: 'income_statement',
  ebitda: 'income_statement', net_income: 'income_statement',
  interest_expense: 'income_statement', income_tax_expense: 'income_statement',
  depreciation_amortization: 'income_statement', rent_expense: 'income_statement',
  cash: 'balance_sheet', total_assets: 'balance_sheet',
  total_liabilities: 'balance_sheet', total_equity: 'balance_sheet',
  total_debt: 'balance_sheet', long_term_debt: 'balance_sheet',
  current_portion_long_term_debt: 'balance_sheet',
  revolver_facility_size: 'balance_sheet', revolver_borrowings: 'balance_sheet',
  revolver_availability: 'balance_sheet',
  cfo: 'cash_flow', cfi: 'cash_flow', cff: 'cash_flow', capex: 'cash_flow',
  cash_paid_for_interest: 'cash_flow', cash_paid_for_income_taxes: 'cash_flow',
  dividends_distributions_paid: 'cash_flow',
}

function getExtracted(period, fieldKey) {
  const section = SECTION_MAP[fieldKey]
  if (!section || !period[section]) return null
  const v = period[section][fieldKey]
  return (v === undefined || v === null) ? null : v
}

function getContextFromNotes(period, fieldKey) {
  if (!period.notes) return null
  const prefix = `CONTEXT:${fieldKey}:`
  const note = period.notes.find(n => typeof n === 'string' && n.startsWith(prefix))
  if (!note) return null
  const raw = note.slice(prefix.length)
  // Try to parse as JSON (new format with formatted + raw)
  try {
    const parsed = JSON.parse(raw)
    if (parsed && parsed.formatted !== undefined) return parsed
    // Old format — wrap as raw only
    return { raw, formatted: null, matched_line: null, score: null }
  } catch {
    // Old plain-text format
    return { raw, formatted: null, matched_line: null, score: null }
  }
}

function fmt(v, basis) {
  if (v === null || v === undefined) return '—'
  const s = basis === 'millions' ? 'MM' : basis === 'thousands' ? 'K' : ''
  return `$${parseFloat(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}${s}`
}

// ── Context display component ─────────────────────────────────────────────────
function ContextDisplay({ context }) {
  if (!context) return null

  const raw = typeof context === 'string' ? context : context.raw
  if (!raw) return null

  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '0.75rem',
      fontFamily: 'DM Mono, monospace', fontSize: '0.78rem',
      lineHeight: 1.8, overflowX: 'auto',
      maxHeight: 220, overflowY: 'auto',
    }}>
      {raw.split('\n').map((line, i) => {
        const isMatch = line.startsWith('>>>')
        return (
          <div key={i} style={{
            color: isMatch ? 'var(--accent)' : 'var(--text3)',
            fontWeight: isMatch ? 600 : 400,
            background: isMatch ? 'rgba(201,169,110,0.08)' : 'transparent',
            padding: isMatch ? '0.1rem 0.4rem' : '0 0.4rem',
            borderRadius: isMatch ? 3 : 0,
            whiteSpace: 'pre',
          }}>
            {line}
          </div>
        )
      })}
    </div>
  )
}

// placeholder to maintain structure
function _unused() {

}

// ── Rule editor component ─────────────────────────────────────────────────────
function RuleEditor({ fieldKey, fieldLabel, existingRule, onSave }) {
  const [ruleType,      setRuleType]      = useState(existingRule?.rule_type || 'label')
  const [label,         setLabel]         = useState(existingRule?.label || '')
  const [sectionHint,   setSectionHint]   = useState(existingRule?.section_hint || '')
  const [excludeLabels, setExcludeLabels] = useState(
    (existingRule?.exclude_labels || []).join(', ')
  )
  const [note, setNote] = useState(existingRule?.note || '')

  const inputStyle = {
    width: '100%', background: 'var(--surface2)',
    border: '1px solid var(--border)', borderRadius: 4,
    padding: '0.4rem 0.6rem', color: 'var(--text)',
    fontSize: '0.83rem', fontFamily: 'inherit', outline: 'none',
  }

  const labelStyle = {
    display: 'block', fontSize: '0.72rem', color: 'var(--text3)',
    textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.3rem',
  }

  const handleSave = () => {
    const rule = { rule_type: ruleType }
    if (label.trim())       rule.label         = label.trim()
    if (sectionHint.trim()) rule.section_hint  = sectionHint.trim()
    if (excludeLabels.trim()) {
      rule.exclude_labels = excludeLabels.split(',').map(s => s.trim()).filter(Boolean)
    }
    if (note.trim())        rule.note          = note.trim()
    onSave(rule)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div>
        <label style={labelStyle}>What is wrong?</label>
        <select value={ruleType} onChange={e => setRuleType(e.target.value)}
          style={{ ...inputStyle }}>
          {RULE_TYPES.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {(ruleType === 'label' || ruleType === 'section') && (
        <div>
          <label style={labelStyle}>
            {ruleType === 'label' ? 'Correct line label to use' : 'Line label within section'}
          </label>
          <input style={inputStyle} value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder={ruleType === 'label' ? 'e.g. Operating lease cost' : 'e.g. Income taxes paid'} />
        </div>
      )}

      <div>
        <label style={labelStyle}>
          {ruleType === 'section' ? 'Section / Note header to look in' : 'Section hint (optional)'}
        </label>
        <input style={inputStyle} value={sectionHint}
          onChange={e => setSectionHint(e.target.value)}
          placeholder='e.g. LEASES, SUPPLEMENTAL CASH FLOW INFORMATION' />
      </div>

      {(ruleType === 'exclusion' || ruleType === 'label') && (
        <div>
          <label style={labelStyle}>Labels to ignore (comma separated)</label>
          <input style={inputStyle} value={excludeLabels}
            onChange={e => setExcludeLabels(e.target.value)}
            placeholder='e.g. Total lease cost, Finance lease cost' />
        </div>
      )}

      <div>
        <label style={labelStyle}>Note (for your reference)</label>
        <input style={inputStyle} value={note}
          onChange={e => setNote(e.target.value)}
          placeholder='e.g. Use operating lease cost only, not total' />
      </div>

      <button onClick={handleSave} style={{
        background: 'var(--accent)', color: '#0d0f14',
        border: 'none', borderRadius: 4, padding: '0.5rem 1rem',
        fontSize: '0.83rem', fontWeight: 600, fontFamily: 'inherit',
        cursor: 'pointer', alignSelf: 'flex-start',
      }}>
        Save Rule
      </button>
    </div>
  )
}

// ── Field row component ───────────────────────────────────────────────────────
function FieldRow({ fieldKey, fieldLabel, periods, profile, rules, basis, companyName, onCorrectionSave, onRuleSave }) {
  const [expanded,    setExpanded]    = useState(false)
  const [showContext, setShowContext] = useState({})
  const [showRule,    setShowRule]    = useState(false)
  const [editValues,  setEditValues]  = useState({})
  const [applyTo,     setApplyTo]     = useState({})
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)

  const existingRule = rules[fieldKey]
  const hasRule = !!existingRule

  // Check if any period has a value or a profile conflict
  const anyValue    = periods.some(p => getExtracted(p, fieldKey) !== null)
  const anyConflict = periods.some(p => {
    const extracted = getExtracted(p, fieldKey)
    const profVal   = profile['_default']?.[fieldKey]?.value ?? profile[p.period_name]?.[fieldKey]?.value
    return profVal !== undefined && extracted !== null && Math.abs(extracted - profVal) > 0.5
  })

  const handleDeleteCorrection = async (periodName) => {
    // Delete saved correction for this field/period
    const res = await fetch(
      `/v1/profiles/${encodeURIComponent(companyName)}/field`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_name: fieldKey, period_name: periodName }),
      }
    )
    // Also try deleting from _default if period-specific not found
    if (!res.ok) {
      await fetch(
        `/v1/profiles/${encodeURIComponent(companyName)}/field`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field_name: fieldKey, period_name: null }),
        }
      )
    }
    onCorrectionSave()
  }

  const handleSaveCorrections = async () => {
    const corrections = []
    for (const [pname, val] of Object.entries(editValues)) {
      if (!val && val !== '0') continue
      const num = parseFloat(val)
      if (isNaN(num)) continue
      const scope = applyTo[pname] || 'period'
      corrections.push({
        field_name:  fieldKey,
        value:       num,
        period_name: scope === 'period' ? pname : null,
      })
    }
    if (!corrections.length) return
    setSaving(true)
    try {
      const res = await fetch(
        `/v1/profiles/${encodeURIComponent(companyName)}/corrections/bulk`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ corrections }) }
      )
      if (res.ok) {
        setSaved(true)
        setEditValues({})
        setTimeout(() => setSaved(false), 3000)
        onCorrectionSave()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRule = async (rule) => {
    const res = await fetch(
      `/v1/profiles/${encodeURIComponent(companyName)}/rules`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_name: fieldKey, ...rule }) }
    )
    if (res.ok) {
      setShowRule(false)
      onRuleSave()
    }
  }

  const handleDeleteRule = async () => {
    await fetch(
      `/v1/profiles/${encodeURIComponent(companyName)}/rules/${fieldKey}`,
      { method: 'DELETE' }
    )
    onRuleSave()
  }

  const pendingCount = Object.values(editValues).filter(v => v !== '' && !isNaN(parseFloat(v))).length

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      marginBottom: '0.5rem', overflow: 'hidden',
    }}>
      {/* Header row — always visible */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', padding: '0.6rem 0.75rem',
          cursor: 'pointer', background: expanded ? 'var(--surface2)' : 'var(--surface)',
          gap: '0.75rem',
        }}
      >
        <span style={{ color: 'var(--text3)', fontSize: '0.9rem', width: 16 }}>
          {expanded ? '▾' : '▸'}
        </span>
        <span style={{ flex: 1, fontSize: '0.875rem', color: 'var(--text)', fontWeight: 500 }}>
          {fieldLabel}
        </span>
        {hasRule && (
          <span style={{ fontSize: '0.72rem', color: 'var(--green)',
            background: 'rgba(76,175,130,0.12)', padding: '0.15rem 0.5rem',
            borderRadius: 10, fontWeight: 600 }}>
            Rule saved
          </span>
        )}
        {anyConflict && (
          <span style={{ fontSize: '0.72rem', color: 'var(--red)',
            background: 'rgba(224,92,92,0.12)', padding: '0.15rem 0.5rem',
            borderRadius: 10, fontWeight: 600 }}>
            Conflict
          </span>
        )}
        {/* Show extracted values in header for quick scan */}
        <div style={{ display: 'flex', gap: '1rem' }}>
          {periods.map(p => {
            const v = getExtracted(p, fieldKey)
            return (
              <span key={p.period_name} style={{
                fontFamily: 'DM Mono, monospace', fontSize: '0.8rem',
                color: v === null ? 'var(--text3)' : anyConflict ? 'var(--red)' : 'var(--text)',
                minWidth: 70, textAlign: 'right',
              }}>
                {fmt(v, basis)}
              </span>
            )
          })}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          {periods.map(p => {
            const extracted = getExtracted(p, fieldKey)
            const context   = getContextFromNotes(p, fieldKey)
            const profVal   = profile[p.period_name]?.[fieldKey]?.value
                           ?? profile['_default']?.[fieldKey]?.value
            const conflict  = profVal !== undefined && extracted !== null
                           && Math.abs(extracted - profVal) > 0.5
            const showCtx   = showContext[p.period_name]

            return (
              <div key={p.period_name} style={{
                marginBottom: '1.25rem', paddingBottom: '1.25rem',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.78rem',
                    color: 'var(--text3)', fontWeight: 600, minWidth: 60 }}>
                    {p.period_name}
                  </span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.9rem',
                    color: conflict ? 'var(--red)' : extracted === null ? 'var(--text3)' : 'var(--text)',
                    fontWeight: 600 }}>
                    {fmt(extracted, basis)}
                  </span>
                  {profVal !== undefined && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.78rem', color: conflict ? 'var(--red)' : 'var(--green)' }}>
                        {conflict
                          ? `⚠ Profile: ${fmt(profVal, basis)}`
                          : `✓ Profile: ${fmt(profVal, basis)}`
                        }
                      </span>
                      {hasRule && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text3)', fontStyle: 'italic' }}>
                          (rule active — value won't apply next year)
                        </span>
                      )}
                      <button
                        onClick={() => handleDeleteCorrection(p.period_name)}
                        style={{
                          background: 'none', border: '1px solid rgba(224,92,92,0.3)',
                          borderRadius: 3, padding: '0.1rem 0.4rem',
                          fontSize: '0.7rem', color: 'var(--red)', cursor: 'pointer',
                          fontFamily: 'inherit', lineHeight: 1.4,
                        }}
                        title="Remove this saved correction"
                      >
                        Clear
                      </button>
                    </span>
                  )}
                  {context && (
                    <button
                      onClick={() => setShowContext(s => ({ ...s, [p.period_name]: !s[p.period_name] }))}
                      style={{
                        background: 'none', border: '1px solid var(--border)',
                        borderRadius: 4, padding: '0.2rem 0.6rem',
                        fontSize: '0.75rem', color: 'var(--text3)',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {showCtx ? 'Hide' : 'Show'} where it was found
                    </button>
                  )}
                </div>

                {/* Context display — only shown when context exists */}
                {showCtx && context && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text3)',
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      marginBottom: '0.4rem' }}>
                      Where it was found (highlighted line = extracted value)
                    </p>
                    <ContextDisplay context={context} />
                  </div>
                )}

                {/* Correction input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text3)', minWidth: 100 }}>
                    Correct value:
                  </span>
                  <input
                    type="number" step="0.1"
                    placeholder={profVal !== undefined ? `Profile: ${profVal}` : 'Enter correct value'}
                    value={editValues[p.period_name] || ''}
                    onChange={e => setEditValues(v => ({ ...v, [p.period_name]: e.target.value }))}
                    style={{
                      background: 'var(--surface2)', border: `1px solid ${editValues[p.period_name] ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 4, padding: '0.35rem 0.6rem',
                      color: 'var(--text)', fontSize: '0.83rem',
                      fontFamily: 'DM Mono, monospace', outline: 'none', width: 140,
                    }}
                  />
                  {editValues[p.period_name] && (
                    <select
                      value={applyTo[p.period_name] || 'period'}
                      onChange={e => setApplyTo(v => ({ ...v, [p.period_name]: e.target.value }))}
                      style={{
                        background: 'var(--surface2)', border: '1px solid var(--border)',
                        borderRadius: 4, padding: '0.35rem 0.5rem',
                        color: 'var(--text2)', fontSize: '0.78rem',
                        fontFamily: 'inherit', outline: 'none',
                      }}
                    >
                      <option value="period">This period only ({p.period_name})</option>
                      <option value="default">All future runs (default)</option>
                    </select>
                  )}
                </div>
              </div>
            )
          })}

          {/* Save corrections button + rule awareness message */}
          {pendingCount > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <button onClick={handleSaveCorrections} disabled={saving} style={{
                background: 'var(--accent)', color: '#0d0f14',
                border: 'none', borderRadius: 4, padding: '0.5rem 1rem',
                fontSize: '0.83rem', fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer',
              }}>
                {saving ? 'Saving…' : `Save ${pendingCount} Correction${pendingCount > 1 ? 's' : ''}`}
              </button>
              {hasRule ? (
                <p style={{ fontSize: '0.75rem', color: 'var(--green)', marginTop: '0.4rem' }}>
                  ✓ Extraction rule saved — this value fixes the current run only.
                  Next year the rule will find the correct number dynamically.
                </p>
              ) : (
                <p style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '0.4rem' }}>
                  ⚠ No extraction rule saved yet. This value will be used as a one-time fix.
                  Add an extraction rule below so the extractor finds the right number next year automatically.
                </p>
              )}
            </div>
          )}
          {saved && (
            <span style={{ fontSize: '0.83rem', color: 'var(--green)', marginLeft: '0.5rem' }}>
              ✓ Saved
            </span>
          )}

          {/* Rule section */}
          <div style={{
            borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.25rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text3)', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Extraction Rule
              </span>
              {hasRule && (
                <span style={{ fontSize: '0.78rem', color: 'var(--green)' }}>
                  ✓ Rule saved — extractor will use this on next run
                </span>
              )}
            </div>

            {hasRule && !showRule && (
              <div style={{
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '0.5rem',
                fontSize: '0.83rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ color: 'var(--text3)' }}>Type: </span>
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{existingRule.rule_type}</span>
                    {existingRule.label && (
                      <span style={{ color: 'var(--text3)' }}> · Label: <span style={{ color: 'var(--accent)' }}>"{existingRule.label}"</span></span>
                    )}
                    {existingRule.section_hint && (
                      <span style={{ color: 'var(--text3)' }}> · Section: <span style={{ color: 'var(--accent)' }}>"{existingRule.section_hint}"</span></span>
                    )}
                    {existingRule.note && (
                      <span style={{ color: 'var(--text3)' }}> · {existingRule.note}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => setShowRule(true)} style={{
                      background: 'none', border: '1px solid var(--border)',
                      borderRadius: 4, padding: '0.2rem 0.5rem',
                      fontSize: '0.75rem', color: 'var(--text3)', cursor: 'pointer',
                    }}>Edit</button>
                    <button onClick={handleDeleteRule} style={{
                      background: 'none', border: '1px solid rgba(224,92,92,0.3)',
                      borderRadius: 4, padding: '0.2rem 0.5rem',
                      fontSize: '0.75rem', color: 'var(--red)', cursor: 'pointer',
                    }}>Delete</button>
                  </div>
                </div>
              </div>
            )}

            {!hasRule && !showRule && (
              <button onClick={() => setShowRule(true)} style={{
                background: 'none', border: '1px solid var(--border2)',
                borderRadius: 4, padding: '0.35rem 0.75rem',
                fontSize: '0.78rem', color: 'var(--text3)', cursor: 'pointer',
                fontFamily: 'inherit',
              }}>
                + Add extraction rule (teach the extractor where to look)
              </button>
            )}

            {showRule && (
              <div style={{
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '1rem', marginTop: '0.5rem',
              }}>
                <p style={{ fontSize: '0.83rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
                  This rule tells the extractor exactly where to find <strong>{fieldLabel}</strong> in future filings for this company.
                </p>
                <RuleEditor
                  fieldKey={fieldKey}
                  fieldLabel={fieldLabel}
                  existingRule={existingRule}
                  onSave={handleSaveRule}
                />
                <button onClick={() => setShowRule(false)} style={{
                  background: 'none', border: 'none', color: 'var(--text3)',
                  cursor: 'pointer', fontSize: '0.78rem', marginTop: '0.5rem',
                }}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ReviewCorrect component ──────────────────────────────────────────────
export default function ReviewCorrect({ data, companyName }) {
  const [profile,       setProfile]       = useState({})
  const [rules,         setRules]         = useState({})
  const [activeSection, setActiveSection] = useState('Income Statement')
  const [refreshKey,    setRefreshKey]    = useState(0)

  const periods  = data?.extracted?.periods || []
  const basis    = data?.extracted?.statement_basis || 'actual'

  const reload = () => setRefreshKey(k => k + 1)

  useEffect(() => {
    if (!companyName) return
    fetch(`/v1/profiles/${encodeURIComponent(companyName)}`)
      .then(r => r.json())
      .then(d => {
        setProfile(d.profile || {})
        setRules(d.rules || {})
      })
      .catch(() => {})
  }, [companyName, refreshKey])

  const profileFlags = (data?.validation_flags || []).filter(f => f.startsWith('PROFILE'))

  if (!companyName) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text3)' }}>
        Enter a borrower name to enable the Review & Correct feature.
      </div>
    )
  }

  return (
    <div>
      {/* Info banner + clear profile button */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '1rem',
        background: 'rgba(91,141,232,0.08)', border: '1px solid rgba(91,141,232,0.2)',
        borderRadius: 'var(--radius)', padding: '0.75rem 1rem', marginBottom: '1.25rem',
      }}>
        <p style={{ fontSize: '0.83rem', color: 'var(--text2)', flex: 1 }}>
          <strong style={{ color: 'var(--blue)' }}>How this works:</strong>{' '}
          Click any field to expand it. You can see where the extractor found each number,
          enter a correction, and save an extraction rule so the extractor finds the right
          number automatically in future filings for <strong>{companyName}</strong>.
        </p>
        <button
          onClick={async () => {
            if (!window.confirm(`Clear ALL saved corrections and rules for ${companyName}?`)) return
            await fetch(`/v1/profiles/${encodeURIComponent(companyName)}`, { method: 'DELETE' })
            reload()
          }}
          style={{
            background: 'none', border: '1px solid rgba(224,92,92,0.3)',
            borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem',
            fontSize: '0.78rem', color: 'var(--red)', cursor: 'pointer',
            fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          Clear Profile
        </button>
      </div>

      {/* Profile conflict alerts */}
      {profileFlags.length > 0 && (
        <div style={{
          background: 'rgba(201,169,110,0.08)', border: '1px solid rgba(201,169,110,0.3)',
          borderRadius: 'var(--radius)', padding: '0.75rem 1rem', marginBottom: '1.25rem',
        }}>
          <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)',
            textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
            Profile Conflicts — Values differ from saved corrections
          </p>
          {profileFlags.map((f, i) => (
            <p key={i} style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.2rem' }}>
              ⚠ {f}
            </p>
          ))}
        </div>
      )}

      {/* Section tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
        {Object.keys(ALL_FIELDS).map(sec => (
          <button key={sec} onClick={() => setActiveSection(sec)} style={{
            background: 'none', border: 'none', padding: '0.5rem 1rem',
            fontSize: '0.83rem', fontFamily: 'inherit', cursor: 'pointer',
            color: activeSection === sec ? 'var(--accent)' : 'var(--text3)',
            borderBottom: activeSection === sec ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1, fontWeight: activeSection === sec ? 600 : 400,
          }}>
            {sec}
          </button>
        ))}
      </div>

      {/* Period column headers */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem',
        paddingRight: '0.75rem', marginBottom: '0.4rem' }}>
        {periods.map(p => (
          <span key={p.period_name} style={{
            fontFamily: 'DM Mono, monospace', fontSize: '0.75rem',
            color: 'var(--text3)', minWidth: 70, textAlign: 'right',
          }}>
            {p.period_name}
          </span>
        ))}
      </div>

      {/* Field rows */}
      {ALL_FIELDS[activeSection].map(({ key, label }) => (
        <FieldRow
          key={key}
          fieldKey={key}
          fieldLabel={label}
          periods={periods}
          profile={profile}
          rules={rules}
          basis={basis}
          companyName={companyName}
          onCorrectionSave={reload}
          onRuleSave={reload}
        />
      ))}
    </div>
  )
}
