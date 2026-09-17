/**
 * ReviewCorrect.jsx
 * =================
 * Lets analysts review and correct values the AI extracted from a 10-K filing.
 *
 * Three things an analyst can do for each financial field:
 *
 *  1. SEE where the AI found the value — a highlighted snippet from the filing
 *     shows the exact line the extractor matched. If a profile override is
 *     active, a note explains that the displayed location was overridden.
 *
 *  2. CORRECT the value — type the right number and choose whether it applies
 *     to this period only or all future runs for this company.
 *     After saving, the system automatically suggests an extraction rule.
 *
 *  3. SAVE AN EXTRACTION RULE — teaches the extractor WHERE to find the right
 *     number next time, so the correction is not needed again. Rules are
 *     suggested automatically after a correction is saved (AI-generated),
 *     or the analyst can write one manually.
 *
 * Learning system:
 *   Corrections → saved to company_profiles.json
 *   Rules        → injected into the extraction prompt on the next run
 *   Auto-suggest → after saving a correction, Claude analyses the context
 *                  and suggests a rule automatically
 */

import { useState, useEffect } from 'react'

// ── Field definitions ─────────────────────────────────────────────────────────
// These define what appears in each tab of the Review & Correct panel

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

// Maps each field key to which section of the extracted data it lives in
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

// ── Helper functions ──────────────────────────────────────────────────────────

/** Gets the extracted value for a field from a period object */
function getExtracted(period, fieldKey) {
  const section = SECTION_MAP[fieldKey]
  if (!section || !period[section]) return null
  const v = period[section][fieldKey]
  return (v === undefined || v === null) ? null : v
}

/**
 * Finds the extraction context note for a field from period.notes.
 * The context is stored as: "CONTEXT:{field_name}:{json_data}"
 * It contains the text snippet from the filing where the value was found.
 */
function getContextFromNotes(period, fieldKey) {
  if (!period.notes) return null
  const prefix = `CONTEXT:${fieldKey}:`
  const note   = period.notes.find(n => typeof n === 'string' && n.startsWith(prefix))
  if (!note) return null
  const raw = note.slice(prefix.length)
  try {
    const parsed = JSON.parse(raw)
    if (parsed && parsed.formatted !== undefined) return parsed
    return { raw, formatted: null, matched_line: null, score: null }
  } catch {
    return { raw, formatted: null, matched_line: null, score: null }
  }
}

/** Formats a number for display (e.g. $40.2MM) */
function fmt(v, basis) {
  if (v === null || v === undefined) return '—'
  const s = basis === 'millions' ? 'MM' : basis === 'thousands' ? 'K' : ''
  return `$${parseFloat(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}${s}`
}

// ── Context display ───────────────────────────────────────────────────────────

/**
 * Shows the text snippet from the filing where the extractor found the value.
 * Lines starting with ">>>" are highlighted — that's the line that was matched.
 */
function ContextDisplay({ context, isOverridden, profileValue, basis }) {
  if (!context) return null
  const raw = typeof context === 'string' ? context : context.raw
  if (!raw) return null

  return (
    <div>
      {/* If a profile correction is active, explain that this location was overridden */}
      {isOverridden && (
        <div style={{
          background: 'rgba(201,169,110,0.1)',
          border: '1px solid rgba(201,169,110,0.3)',
          borderRadius: 4, padding: '0.5rem 0.75rem',
          marginBottom: '0.5rem', fontSize: '0.78rem',
          color: 'var(--accent)',
        }}>
          ⚠ The extractor found this location, but your saved correction
          ({fmt(profileValue, basis)}) overrides it. The value shown in the
          analysis is your corrected value, not what was found here.
        </div>
      )}
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
              color:      isMatch ? 'var(--accent)' : 'var(--text3)',
              fontWeight: isMatch ? 600 : 400,
              background: isMatch ? 'rgba(201,169,110,0.08)' : 'transparent',
              padding:    isMatch ? '0.1rem 0.4rem' : '0 0.4rem',
              borderRadius: isMatch ? 3 : 0,
              whiteSpace: 'pre',
            }}>
              {line}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Rule suggestion display ───────────────────────────────────────────────────

/**
 * Shows a suggested extraction rule after a correction is saved.
 * The suggestion is generated by Claude based on where the extractor
 * originally found the wrong value.
 */
function RuleSuggestionCard({ suggestion, onApply, onDismiss }) {
  if (!suggestion) return null

  const confidenceColor = {
    high:   'var(--green)',
    medium: 'var(--accent)',
    low:    'var(--text3)',
  }[suggestion.confidence] || 'var(--text3)'

  return (
    <div style={{
      background: 'rgba(76,175,130,0.06)',
      border: '1px solid rgba(76,175,130,0.25)',
      borderRadius: 6, padding: '0.875rem',
      marginTop: '0.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--green)',
          textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          AI Rule Suggestion
        </span>
        <span style={{ fontSize: '0.72rem', color: confidenceColor,
          background: `${confidenceColor}1a`, padding: '0.1rem 0.4rem',
          borderRadius: 10, fontWeight: 600 }}>
          {suggestion.confidence} confidence
        </span>
      </div>

      <p style={{ fontSize: '0.83rem', color: 'var(--text2)', marginBottom: '0.5rem' }}>
        {suggestion.explanation}
      </p>

      {/* Show the rule details */}
      <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginBottom: '0.75rem',
        fontFamily: 'DM Mono, monospace' }}>
        {suggestion.rule_type === 'label' && suggestion.label && (
          <span>Look for label: <strong style={{ color: 'var(--accent)' }}>"{suggestion.label}"</strong></span>
        )}
        {suggestion.section_hint && (
          <span> in section: <strong style={{ color: 'var(--accent)' }}>"{suggestion.section_hint}"</strong></span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={onApply} style={{
          background: 'var(--green)', color: 'white',
          border: 'none', borderRadius: 4, padding: '0.4rem 0.85rem',
          fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        }}>
          Apply This Rule
        </button>
        <button onClick={onDismiss} style={{
          background: 'none', border: '1px solid var(--border)',
          borderRadius: 4, padding: '0.4rem 0.75rem',
          fontSize: '0.8rem', color: 'var(--text3)', fontFamily: 'inherit', cursor: 'pointer',
        }}>
          Dismiss
        </button>
      </div>
    </div>
  )
}

// ── Rule editor ───────────────────────────────────────────────────────────────

/**
 * Form for manually creating or editing an extraction rule.
 * Rules tell the extractor exactly WHERE to find a value in future filings.
 */
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
    if (label.trim())         rule.label          = label.trim()
    if (sectionHint.trim())   rule.section_hint   = sectionHint.trim()
    if (excludeLabels.trim()) rule.exclude_labels = excludeLabels.split(',').map(s => s.trim()).filter(Boolean)
    if (note.trim())          rule.note           = note.trim()
    onSave(rule)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div>
        <label style={labelStyle}>What is wrong?</label>
        <select value={ruleType} onChange={e => setRuleType(e.target.value)} style={inputStyle}>
          {RULE_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {(ruleType === 'label' || ruleType === 'section') && (
        <div>
          <label style={labelStyle}>
            {ruleType === 'label' ? 'Correct line label to use' : 'Line label within section'}
          </label>
          <input style={inputStyle} value={label} onChange={e => setLabel(e.target.value)}
            placeholder={ruleType === 'label' ? 'e.g. Operating lease cost' : 'e.g. Income taxes paid'} />
        </div>
      )}

      <div>
        <label style={labelStyle}>
          {ruleType === 'section' ? 'Section / Note header to look in' : 'Section hint (optional)'}
        </label>
        <input style={inputStyle} value={sectionHint} onChange={e => setSectionHint(e.target.value)}
          placeholder='e.g. LEASES, SUPPLEMENTAL CASH FLOW INFORMATION' />
      </div>

      {(ruleType === 'exclusion' || ruleType === 'label') && (
        <div>
          <label style={labelStyle}>Labels to ignore (comma separated)</label>
          <input style={inputStyle} value={excludeLabels} onChange={e => setExcludeLabels(e.target.value)}
            placeholder='e.g. Total lease cost, Finance lease cost' />
        </div>
      )}

      <div>
        <label style={labelStyle}>Note (for your reference)</label>
        <input style={inputStyle} value={note} onChange={e => setNote(e.target.value)}
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

// ── Field row ─────────────────────────────────────────────────────────────────

/**
 * A single expandable row for one financial field (e.g. Rent / Lease Expense).
 * Shows the extracted value, profile correction, context, correction input,
 * and rule management — all in one collapsible panel.
 */
function FieldRow({
  fieldKey, fieldLabel, periods, profile, rules,
  basis, companyName, runId, onCorrectionSave, onRuleSave,
}) {
  const [expanded,       setExpanded]       = useState(false)
  const [showContext,    setShowContext]     = useState({})
  const [showRule,       setShowRule]       = useState(false)
  const [editValues,     setEditValues]     = useState({})
  const [applyTo,        setApplyTo]        = useState({})
  const [saving,         setSaving]         = useState(false)
  const [saved,          setSaved]          = useState(false)
  const [ruleSuggestion, setRuleSuggestion] = useState(null)  // AI-generated rule suggestion
  const [suggesting,     setSuggesting]     = useState(false) // true while waiting for suggestion

  const existingRule = rules[fieldKey]
  const hasRule      = !!existingRule

  // Check if any period has a conflict between extracted and profile values
  const anyConflict = periods.some(p => {
    const extracted = getExtracted(p, fieldKey)
    const profVal   = profile['_default']?.[fieldKey]?.value ?? profile[p.period_name]?.[fieldKey]?.value
    return profVal !== undefined && extracted !== null && Math.abs(extracted - profVal) > 0.5
  })

  /** Removes a saved correction from the profile */
  const handleDeleteCorrection = async (periodName) => {
    const res = await fetch(
      `/v1/profiles/${encodeURIComponent(companyName)}/field`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_name: fieldKey, period_name: periodName }) }
    )
    if (!res.ok) {
      // Try deleting the _default entry if period-specific not found
      await fetch(
        `/v1/profiles/${encodeURIComponent(companyName)}/field`,
        { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field_name: fieldKey, period_name: null }) }
      )
    }
    onCorrectionSave()
  }

  /**
   * Saves the analyst's corrections, then automatically requests a rule
   * suggestion from the AI based on where the extractor found the wrong value.
   */
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
      // Step 1: Save the corrections to the company profile
      const res = await fetch(
        `/v1/profiles/${encodeURIComponent(companyName)}/corrections/bulk`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ corrections }) }
      )
      if (!res.ok) return

      setSaved(true)
      setEditValues({})
      setTimeout(() => setSaved(false), 3000)
      onCorrectionSave()

      // Step 2: If no rule exists yet and we have a run ID, ask Claude to
      // suggest a rule based on the extraction context
      if (!hasRule && runId && corrections.length > 0) {
        setSuggesting(true)
        const firstCorrection = corrections[0]
        // Find what the extractor originally returned for this field
        const period     = periods.find(p => p.period_name === (firstCorrection.period_name || periods[0]?.period_name))
        const extracted  = period ? getExtracted(period, fieldKey) : null

        try {
          const suggestRes = await fetch(
            `/v1/profiles/${encodeURIComponent(companyName)}/suggest_rule`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                field_name:      fieldKey,
                correct_value:   firstCorrection.value,
                extracted_value: extracted,
                period_name:     firstCorrection.period_name || periods[0]?.period_name,
                run_id:          runId,
              }),
            }
          )
          if (suggestRes.ok) {
            const suggestion = await suggestRes.json()
            // Only show the suggestion if Claude actually generated one
            if (suggestion.status !== 'not_found' && suggestion.status !== 'error') {
              setRuleSuggestion(suggestion)
            }
          }
        } catch (e) {
          // Suggestion failure is non-fatal — the correction was already saved
          console.warn('Rule suggestion failed:', e)
        } finally {
          setSuggesting(false)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  /** Saves an extraction rule (either manual or from the AI suggestion) */
  const handleSaveRule = async (rule) => {
    const res = await fetch(
      `/v1/profiles/${encodeURIComponent(companyName)}/rules`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_name: fieldKey, ...rule }) }
    )
    if (res.ok) {
      setShowRule(false)
      setRuleSuggestion(null) // hide the suggestion once a rule is saved
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
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      marginBottom: '0.5rem', overflow: 'hidden' }}>

      {/* ── Collapsed header — always visible ── */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', padding: '0.6rem 0.75rem',
          cursor: 'pointer', background: expanded ? 'var(--surface2)' : 'var(--surface)',
          gap: '0.75rem' }}
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
        {/* Extracted values shown in header for quick scanning */}
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

      {/* ── Expanded content ── */}
      {expanded && (
        <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>

          {/* Per-period rows */}
          {periods.map(p => {
            const extracted  = getExtracted(p, fieldKey)
            const context    = getContextFromNotes(p, fieldKey)
            const profVal    = profile[p.period_name]?.[fieldKey]?.value
                            ?? profile['_default']?.[fieldKey]?.value
            const conflict   = profVal !== undefined && extracted !== null
                            && Math.abs(extracted - profVal) > 0.5
            const isOverridden = profVal !== undefined  // profile correction is active
            const showCtx    = showContext[p.period_name]

            return (
              <div key={p.period_name} style={{ marginBottom: '1.25rem',
                paddingBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>

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

                  {/* Profile correction badge */}
                  {profVal !== undefined && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.78rem', color: conflict ? 'var(--red)' : 'var(--green)' }}>
                        {conflict ? `⚠ Profile: ${fmt(profVal, basis)}` : `✓ Profile: ${fmt(profVal, basis)}`}
                      </span>
                      {hasRule && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text3)', fontStyle: 'italic' }}>
                          (rule active — value won't apply next year)
                        </span>
                      )}
                      <button onClick={() => handleDeleteCorrection(p.period_name)} style={{
                        background: 'none', border: '1px solid rgba(224,92,92,0.3)',
                        borderRadius: 3, padding: '0.1rem 0.4rem',
                        fontSize: '0.7rem', color: 'var(--red)', cursor: 'pointer',
                        fontFamily: 'inherit', lineHeight: 1.4,
                      }} title="Remove this saved correction">
                        Clear
                      </button>
                    </span>
                  )}

                  {/* "Where it was found" toggle — labelled differently when overridden */}
                  {context && (
                    <button
                      onClick={() => setShowContext(s => ({ ...s, [p.period_name]: !s[p.period_name] }))}
                      style={{ background: 'none',
                        border: `1px solid ${isOverridden ? 'rgba(201,169,110,0.4)' : 'var(--border)'}`,
                        borderRadius: 4, padding: '0.2rem 0.6rem',
                        fontSize: '0.75rem',
                        color: isOverridden ? 'var(--accent)' : 'var(--text3)',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {showCtx ? 'Hide' : 'Show'} where it was found
                      {isOverridden && ' ⚠'}
                    </button>
                  )}
                </div>

                {/* Context display — shows where the extractor looked */}
                {showCtx && context && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text3)',
                      textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                      Where the extractor looked (highlighted line = matched value)
                    </p>
                    <ContextDisplay
                      context       = {context}
                      isOverridden  = {isOverridden}
                      profileValue  = {profVal}
                      basis         = {basis}
                    />
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
                      background: 'var(--surface2)',
                      border: `1px solid ${editValues[p.period_name] ? 'var(--accent)' : 'var(--border)'}`,
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

          {/* Save corrections button */}
          {pendingCount > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <button onClick={handleSaveCorrections} disabled={saving} style={{
                background: 'var(--accent)', color: '#0d0f14',
                border: 'none', borderRadius: 4, padding: '0.5rem 1rem',
                fontSize: '0.83rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              }}>
                {saving ? 'Saving…' : `Save ${pendingCount} Correction${pendingCount > 1 ? 's' : ''}`}
              </button>
              {!hasRule && (
                <p style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '0.4rem' }}>
                  ⚠ No extraction rule yet. After saving, an AI rule suggestion will appear below.
                </p>
              )}
            </div>
          )}

          {saved && (
            <span style={{ fontSize: '0.83rem', color: 'var(--green)' }}>✓ Saved</span>
          )}

          {/* AI rule suggestion — shown after saving a correction */}
          {suggesting && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text3)', fontStyle: 'italic', marginTop: '0.5rem' }}>
              Generating rule suggestion…
            </p>
          )}

          {ruleSuggestion && !hasRule && (
            <RuleSuggestionCard
              suggestion = {ruleSuggestion}
              onApply    = {() => handleSaveRule({
                rule_type:      ruleSuggestion.rule_type,
                label:          ruleSuggestion.label,
                section_hint:   ruleSuggestion.section_hint,
                exclude_labels: ruleSuggestion.exclude_labels,
                note:           ruleSuggestion.explanation,
              })}
              onDismiss  = {() => setRuleSuggestion(null)}
            />
          )}

          {/* ── Rule section ── */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
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

            {/* Display existing rule */}
            {hasRule && !showRule && (
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '0.5rem', fontSize: '0.83rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ color: 'var(--text3)' }}>Type: </span>
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{existingRule.rule_type}</span>
                    {existingRule.label && (
                      <span style={{ color: 'var(--text3)' }}>
                        {' '}· Label: <span style={{ color: 'var(--accent)' }}>"{existingRule.label}"</span>
                      </span>
                    )}
                    {existingRule.section_hint && (
                      <span style={{ color: 'var(--text3)' }}>
                        {' '}· Section: <span style={{ color: 'var(--accent)' }}>"{existingRule.section_hint}"</span>
                      </span>
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

            {/* Add rule button */}
            {!hasRule && !showRule && !ruleSuggestion && (
              <button onClick={() => setShowRule(true)} style={{
                background: 'none', border: '1px solid var(--border2)',
                borderRadius: 4, padding: '0.35rem 0.75rem',
                fontSize: '0.78rem', color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                + Add extraction rule (teach the extractor where to look)
              </button>
            )}

            {/* Manual rule editor */}
            {showRule && (
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '1rem', marginTop: '0.5rem' }}>
                <p style={{ fontSize: '0.83rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
                  This rule tells the extractor exactly where to find <strong>{fieldLabel}</strong> in future filings.
                </p>
                <RuleEditor
                  fieldKey={fieldKey} fieldLabel={fieldLabel}
                  existingRule={existingRule} onSave={handleSaveRule}
                />
                <button onClick={() => setShowRule(false)} style={{
                  background: 'none', border: 'none', color: 'var(--text3)',
                  cursor: 'pointer', fontSize: '0.78rem', marginTop: '0.5rem',
                }}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReviewCorrect({ data, companyName }) {
  const [profile,       setProfile]       = useState({})
  const [rules,         setRules]         = useState({})
  const [activeSection, setActiveSection] = useState('Income Statement')
  const [refreshKey,    setRefreshKey]    = useState(0)

  const periods = data?.extracted?.periods || []
  const basis   = data?.extracted?.statement_basis || 'actual'
  const runId   = data?.run_id  // passed to FieldRow so it can call suggest_rule

  const reload = () => setRefreshKey(k => k + 1)

  // Load the company's saved corrections and rules when the component mounts
  // or when a correction/rule is saved (refreshKey changes)
  useEffect(() => {
    if (!companyName) return
    fetch(`/v1/profiles/${encodeURIComponent(companyName)}`)
      .then(r => r.json())
      .then(d => { setProfile(d.profile || {}); setRules(d.rules || {}) })
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
      {/* Info banner */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem',
        background: 'rgba(91,141,232,0.08)', border: '1px solid rgba(91,141,232,0.2)',
        borderRadius: 'var(--radius)', padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
        <p style={{ fontSize: '0.83rem', color: 'var(--text2)', flex: 1 }}>
          <strong style={{ color: 'var(--blue)' }}>How this works:</strong>{' '}
          Click any field to expand it. You can see where the extractor found each number,
          enter a correction, and save an extraction rule so the extractor finds the right
          number automatically in future filings for <strong>{companyName}</strong>.
          After saving a correction, an AI-generated rule suggestion will appear automatically.
        </p>
        <button
          onClick={async () => {
            if (!window.confirm(`Clear ALL saved corrections and rules for ${companyName}?`)) return
            await fetch(`/v1/profiles/${encodeURIComponent(companyName)}`, { method: 'DELETE' })
            reload()
          }}
          style={{ background: 'none', border: '1px solid rgba(224,92,92,0.3)',
            borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem',
            fontSize: '0.78rem', color: 'var(--red)', cursor: 'pointer',
            fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Clear Profile
        </button>
      </div>

      {/* Profile conflict alerts */}
      {profileFlags.length > 0 && (
        <div style={{ background: 'rgba(201,169,110,0.08)', border: '1px solid rgba(201,169,110,0.3)',
          borderRadius: 'var(--radius)', padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
          <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)',
            textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
            Profile Conflicts — Values differ from saved corrections
          </p>
          {profileFlags.map((f, i) => (
            <p key={i} style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.2rem' }}>⚠ {f}</p>
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
          <span key={p.period_name} style={{ fontFamily: 'DM Mono, monospace',
            fontSize: '0.75rem', color: 'var(--text3)', minWidth: 70, textAlign: 'right' }}>
            {p.period_name}
          </span>
        ))}
      </div>

      {/* Field rows */}
      {ALL_FIELDS[activeSection].map(({ key, label }) => (
        <FieldRow
          key             = {key}
          fieldKey        = {key}
          fieldLabel      = {label}
          periods         = {periods}
          profile         = {profile}
          rules           = {rules}
          basis           = {basis}
          companyName     = {companyName}
          runId           = {runId}
          onCorrectionSave = {reload}
          onRuleSave      = {reload}
        />
      ))}
    </div>
  )
}
