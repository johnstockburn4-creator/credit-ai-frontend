/**
 * UploadForm.jsx
 * ==============
 * The main input form for the Credit AI platform. Supports two modes:
 *
 *   1. SEARCH mode — type a company name, the system finds and fetches the
 *      filing automatically from SEC EDGAR (US public companies) or via a
 *      URL the analyst pastes (international / private companies).
 *
 *   2. UPLOAD mode — the original file upload interface. Analyst drags and
 *      drops a 10-K HTML or PDF file from their computer.
 *
 * Both modes share the same Borrower Details and Covenants cards, and both
 * call the parent's onSubmit handler with the same signature:
 *   onSubmit(formData: FormData, borrowerName: string, endpoint: string)
 *
 * The `endpoint` parameter tells App.jsx which API route to call:
 *   - Upload mode: '/v1/analyze'
 *   - EDGAR search mode: '/v1/analyze/edgar'
 *   - URL paste mode: '/v1/analyze/url'
 */

import { useState, useRef, useEffect, useCallback } from 'react'

// ── Shared style constants (unchanged from original UploadForm) ───────────────

const INPUT_STYLE = {
  width: '100%',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '0.6rem 0.85rem',
  color: 'var(--text)',
  fontSize: '0.9rem',
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 0.15s',
}

const LABEL_STYLE = {
  display: 'block',
  fontSize: '0.78rem',
  fontWeight: 500,
  color: 'var(--text3)',
  marginBottom: '0.4rem',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const CARD_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: '1.25rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
}

const CARD_LABEL_STYLE = {
  fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

// How long to wait after typing before searching (ms)
const SEARCH_DEBOUNCE_MS = 400

// Minimum characters before triggering a search
const SEARCH_MIN_CHARS = 2

// ── Shared sub-components ─────────────────────────────────────────────────────

/** A labelled form field wrapper — identical to original UploadForm */
function Field({ label, id, children }) {
  return (
    <div>
      <label htmlFor={id} style={LABEL_STYLE}>{label}</label>
      {children}
    </div>
  )
}

/** Shared focus/blur handlers to highlight inputs on focus */
const focusBorder = e => e.target.style.borderColor = 'var(--accent)'
const blurBorder  = e => e.target.style.borderColor = 'var(--border)'

// ── Mode tab button ───────────────────────────────────────────────────────────

function ModeTab({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '0.6rem 1rem',
        background: active ? 'var(--surface)' : 'none',
        border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
        borderRadius: 'var(--radius)',
        color: active ? 'var(--accent)' : 'var(--text3)',
        fontFamily: 'inherit',
        fontSize: '0.875rem',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        transition: 'all 0.15s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.4rem',
      }}
    >
      {icon} {label}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UploadForm({ onSubmit, error }) {

  // ── Mode: 'search' or 'upload' ────────────────────────────────────────────
  const [mode, setMode] = useState('search')

  // ── Shared borrower / covenant state ──────────────────────────────────────
  // These fields are the same in both modes — they live here so they persist
  // when the analyst switches between Search and Upload tabs.
  const [borrowerName,  setBorrowerName]  = useState('')
  const [industry,      setIndustry]      = useState('')
  const [facilityType,  setFacilityType]  = useState('')
  const [useOfProceeds, setUseOfProceeds] = useState('')
  const [maxLeverage,   setMaxLeverage]   = useState('')
  const [minFcc,        setMinFcc]        = useState('')

  // ── Upload mode state ─────────────────────────────────────────────────────
  const [file,     setFile]     = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef()

  // ── Search mode state ─────────────────────────────────────────────────────

  /** What the user has typed in the company search box */
  const [query, setQuery] = useState('')

  /** Whether a search API call is in flight */
  const [searching, setSearching] = useState(false)

  /** Companies returned by the search API */
  const [searchResults, setSearchResults] = useState([])

  /** Whether to show the results dropdown */
  const [showDropdown, setShowDropdown] = useState(false)

  /** The company the user has selected from the dropdown */
  const [selectedCompany, setSelectedCompany] = useState(null)
  // Shape: { name: string, cik: string, ticker: string }

  /** Available 10-K filings for the selected company */
  const [availableFilings, setAvailableFilings] = useState([])

  /** Whether the filings list is currently loading */
  const [loadingFilings, setLoadingFilings] = useState(false)

  /** The specific fiscal year the user has selected (null = most recent) */
  const [selectedFiling, setSelectedFiling] = useState(null)
  // Shape: { accession_number, fiscal_year, filing_date, form_type }

  /** Whether the user is in URL-paste sub-mode (fallback for non-EDGAR companies) */
  const [urlMode, setUrlMode] = useState(false)

  /** URL pasted by user for international / private companies */
  const [manualUrl, setManualUrl] = useState('')

  /** Skip MD&A toggle — cuts per-run API cost by ~$1 */
  const [skipMda, setSkipMda] = useState(false)

  // Ref for debounce timer and click-outside detection
  const debounceRef  = useRef(null)
  const dropdownRef  = useRef(null)

  // ── Click-outside: close dropdown when clicking elsewhere ─────────────────
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── Search logic ──────────────────────────────────────────────────────────

  /** Calls the EDGAR search API. Invoked after the debounce delay. */
  const doSearch = useCallback(async (searchQuery) => {
    if (!searchQuery || searchQuery.trim().length < SEARCH_MIN_CHARS) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    setSearching(true)
    try {
      const res  = await fetch(`/v1/edgar/search?q=${encodeURIComponent(searchQuery.trim())}&limit=8`)
      const data = await res.json()
      setSearchResults(data.results || [])
      setShowDropdown(true)
    } catch (e) {
      console.error('Company search failed:', e)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  /** Handles typing in the company search box — debounces the API call */
  const handleQueryChange = (e) => {
    const value = e.target.value
    setQuery(value)

    // Reset selection state when user starts typing again
    if (selectedCompany) {
      setSelectedCompany(null)
      setAvailableFilings([])
      setSelectedFiling(null)
    }

    // Cancel pending search and schedule a new one
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(value), SEARCH_DEBOUNCE_MS)
  }

  /**
   * Handles clicking a company in the search results dropdown.
   * Fetches the list of available 10-K filings for that company
   * so the analyst can pick a specific year.
   */
  const handleSelectCompany = async (company) => {
    setSelectedCompany(company)
    setQuery(company.name)
    setShowDropdown(false)
    setSelectedFiling(null)
    setAvailableFilings([])

    // Pre-fill borrower name if the analyst hasn't already typed one
    if (!borrowerName) {
      // Convert "CHURCH & DWIGHT CO INC" → more readable form
      const prettyName = company.name
        .split(' ')
        .map(w => {
          if (['INC', 'LLC', 'LTD', 'CORP', 'CO', 'PLC'].includes(w)) return w
          if (w.length <= 2) return w
          return w.charAt(0) + w.slice(1).toLowerCase()
        })
        .join(' ')
      setBorrowerName(prettyName)
    }

    // Fetch available filings for the year selector
    setLoadingFilings(true)
    try {
      const res  = await fetch(`/v1/edgar/${company.cik}/filings?count=5`)
      const data = await res.json()
      setAvailableFilings(data.filings || [])
    } catch (e) {
      console.error('Failed to load filings:', e)
    } finally {
      setLoadingFilings(false)
    }
  }

  /**
   * Toggles the selected fiscal year.
   * Clicking the already-selected year deselects it, reverting to "most recent".
   */
  const handleSelectFiling = (filing) => {
    setSelectedFiling(prev =>
      prev?.accession_number === filing.accession_number ? null : filing
    )
  }

  // ── Form submission ───────────────────────────────────────────────────────

  /**
   * Builds the FormData payload and calls the parent's onSubmit handler.
   *
   * The `endpoint` parameter tells App.jsx which API route to call:
   *   - Upload:      '/v1/analyze'
   *   - EDGAR:       '/v1/analyze/edgar'
   *   - URL paste:   '/v1/analyze/url'
   */
  const handleSubmit = () => {
    const fd = new FormData()

    // ── Common fields (both modes) ────────────────────────────────────────
    if (borrowerName)  fd.append('borrower_name',      borrowerName)
    if (industry)      fd.append('industry',           industry)
    if (facilityType)  fd.append('facility_type',      facilityType)
    if (useOfProceeds) fd.append('use_of_proceeds',    useOfProceeds)
    if (maxLeverage)   fd.append('max_total_leverage', maxLeverage)
    if (minFcc)        fd.append('min_fcc',            minFcc)
    if (skipMda)       fd.append('skip_mda',           'true')

    let endpoint = '/v1/analyze'

    if (mode === 'upload') {
      // ── File upload mode ─────────────────────────────────────────────────
      if (!file) return
      fd.append('file',          file)
      fd.append('cache_bypass',  'true')
      endpoint = '/v1/analyze'

    } else if (urlMode) {
      // ── URL paste mode (fallback within search mode) ──────────────────
      if (!manualUrl.trim().startsWith('http')) return
      fd.append('url', manualUrl.trim())
      endpoint = '/v1/analyze/url'

    } else {
      // ── EDGAR search mode ─────────────────────────────────────────────
      if (!selectedCompany) return
      fd.append('cik', selectedCompany.cik)
      if (selectedFiling) {
        fd.append('accession_number', selectedFiling.accession_number)
      }
      endpoint = '/v1/analyze/edgar'
    }

    onSubmit(fd, borrowerName, endpoint)
  }

  // Determine whether the submit button should be enabled
  const canSubmit =
    mode === 'upload'  ? !!file :
    urlMode            ? manualUrl.trim().startsWith('http') :
                         !!selectedCompany

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 680, margin: '3rem auto 0' }}>

      {/* ── Page heading ── */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{
          fontFamily: 'DM Serif Display, serif',
          fontSize: '2rem',
          color: 'var(--text)',
          marginBottom: '0.4rem',
        }}>
          Credit Analysis
        </h1>
        <p style={{ color: 'var(--text3)', fontSize: '0.9rem' }}>
          Upload a 10-K filing or search any US public company to extract
          financials, analyse MD&A, and generate a credit memo.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* ── Mode tabs ── */}
        <div style={{
          display: 'flex', gap: '0.5rem',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '0.3rem',
        }}>
          <ModeTab
            active={mode === 'search'}
            onClick={() => { setMode('search'); setUrlMode(false) }}
            icon="🔍"
            label="Search Company"
          />
          <ModeTab
            active={mode === 'upload'}
            onClick={() => setMode('upload')}
            icon="📁"
            label="Upload File"
          />
        </div>

        {/* ── Search mode ── */}
        {mode === 'search' && (
          <div style={CARD_STYLE}>
            <p style={CARD_LABEL_STYLE}>
              {urlMode ? 'Annual Report URL' : 'Company Name'}
            </p>

            {urlMode ? (
              /* URL paste sub-mode */
              <div>
                <input
                  type="url"
                  placeholder="https://company.com/investors/annual-report-2024.pdf"
                  value={manualUrl}
                  onChange={e => setManualUrl(e.target.value)}
                  style={INPUT_STYLE}
                  onFocus={focusBorder}
                  onBlur={blurBorder}
                />
                <div style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', marginTop: '0.5rem',
                }}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>
                    Paste a direct link to any annual report PDF or HTML page.
                    Works for international companies and private issuers.
                  </p>
                  <button
                    onClick={() => { setUrlMode(false); setManualUrl('') }}
                    style={{
                      background: 'none', border: 'none', color: 'var(--accent)',
                      cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: '0.8rem', whiteSpace: 'nowrap', marginLeft: '1rem',
                    }}
                  >
                    ← Back to search
                  </button>
                </div>
              </div>

            ) : (
              /* EDGAR company search */
              <div>
                {/* Search input + dropdown */}
                <div ref={dropdownRef} style={{ position: 'relative' }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="e.g. Mosaic Company, Church & Dwight, 3M"
                      value={query}
                      onChange={handleQueryChange}
                      onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                      style={{
                        ...INPUT_STYLE,
                        paddingRight: '2.2rem',
                        borderColor: selectedCompany ? 'var(--green)' : 'var(--border)',
                      }}
                      onBlur={blurBorder}
                    />
                    <span style={{
                      position: 'absolute', right: '0.7rem',
                      top: '50%', transform: 'translateY(-50%)',
                      fontSize: '0.85rem', color: 'var(--text3)',
                      pointerEvents: 'none',
                    }}>
                      {searching ? '⏳' : selectedCompany ? '✓' : '🔍'}
                    </span>
                  </div>

                  {/* Search results dropdown */}
                  {showDropdown && searchResults.length > 0 && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 4px)',
                      left: 0, right: 0, zIndex: 200,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                      maxHeight: 260, overflowY: 'auto',
                    }}>
                      {searchResults.map((company, i) => (
                        <button
                          key={company.cik}
                          onMouseDown={() => handleSelectCompany(company)}
                          style={{
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between',
                            width: '100%', padding: '0.6rem 0.9rem',
                            background: 'none', border: 'none',
                            borderBottom: i < searchResults.length - 1
                              ? '1px solid var(--border)' : 'none',
                            cursor: 'pointer', textAlign: 'left',
                            color: 'var(--text)',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                              {company.name}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginTop: 2 }}>
                              CIK: {company.cik}
                              {company.ticker && ` · ${company.ticker}`}
                            </div>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--accent)', flexShrink: 0 }}>
                            SEC ›
                          </span>
                        </button>
                      ))}

                      {/* Prompt to switch to URL mode if company not found */}
                      <div style={{
                        padding: '0.55rem 0.9rem',
                        borderTop: '1px solid var(--border)',
                        fontSize: '0.78rem', color: 'var(--text3)',
                      }}>
                        Not listed?{' '}
                        <button
                          onMouseDown={() => { setUrlMode(true); setShowDropdown(false) }}
                          style={{
                            background: 'none', border: 'none',
                            color: 'var(--accent)', cursor: 'pointer',
                            fontFamily: 'inherit', fontSize: 'inherit',
                            padding: 0, textDecoration: 'underline',
                          }}
                        >
                          Paste an annual report URL
                        </button>
                        {' '}for international or private companies.
                      </div>
                    </div>
                  )}

                  {/* No results state */}
                  {showDropdown && !searching
                      && query.length >= SEARCH_MIN_CHARS
                      && searchResults.length === 0 && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 4px)',
                      left: 0, right: 0, zIndex: 200,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      padding: '0.9rem',
                      fontSize: '0.85rem', color: 'var(--text3)',
                    }}>
                      No SEC EDGAR companies match "{query}".{' '}
                      <button
                        onClick={() => { setUrlMode(true); setShowDropdown(false) }}
                        style={{
                          background: 'none', border: 'none',
                          color: 'var(--accent)', cursor: 'pointer',
                          fontFamily: 'inherit', fontSize: 'inherit',
                          padding: 0, textDecoration: 'underline',
                        }}
                      >
                        Try a URL instead
                      </button>
                      {' '}for international or private companies.
                    </div>
                  )}
                </div>

                {/* Filing year selector — appears after company is selected */}
                {selectedCompany && (
                  <div style={{ marginTop: '1rem' }}>
                    <p style={{ ...LABEL_STYLE, marginBottom: '0.6rem' }}>
                      Fiscal Year
                      {!selectedFiling && (
                        <span style={{
                          fontWeight: 400, textTransform: 'none',
                          marginLeft: '0.5rem', color: 'var(--text3)',
                        }}>
                          — most recent by default
                        </span>
                      )}
                    </p>

                    {loadingFilings ? (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text3)' }}>
                        Loading available filings…
                      </p>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {availableFilings.map(filing => {
                          const isActive = selectedFiling?.accession_number === filing.accession_number
                          return (
                            <button
                              key={filing.accession_number}
                              onClick={() => handleSelectFiling(filing)}
                              style={{
                                padding: '0.35rem 0.9rem',
                                borderRadius: 'var(--radius)',
                                border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                                background: isActive ? 'var(--accent)' : 'var(--surface2)',
                                color: isActive ? '#0d0f14' : 'var(--text)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontFamily: 'inherit',
                                fontWeight: isActive ? 600 : 400,
                                transition: 'all 0.15s',
                              }}
                            >
                              {filing.fiscal_year}
                              {filing.form_type === '10-K/A' && (
                                <span style={{ fontSize: '0.7rem', marginLeft: 4, opacity: 0.75 }}>
                                  /A
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Link to switch to URL mode at the bottom */}
                {!selectedCompany && query.length < SEARCH_MIN_CHARS && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text3)', marginTop: '0.5rem' }}>
                    Covers all US public companies on SEC EDGAR.{' '}
                    <button
                      onClick={() => setUrlMode(true)}
                      style={{
                        background: 'none', border: 'none',
                        color: 'var(--accent)', cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: 'inherit',
                        padding: 0, textDecoration: 'underline',
                      }}
                    >
                      Paste a URL
                    </button>
                    {' '}for international or private companies.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Upload mode — original drop zone, unchanged ── */}
        {mode === 'upload' && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              const f = e.dataTransfer.files[0]
              if (f) setFile(f)
            }}
            onClick={() => fileRef.current.click()}
            style={{
              border: `2px dashed ${
                dragging ? 'var(--accent)' : file ? 'var(--green)' : 'var(--border2)'
              }`,
              borderRadius: 'var(--radius-lg)',
              padding: '2rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.6rem',
              cursor: 'pointer',
              transition: 'all 0.15s',
              background: dragging
                ? 'rgba(201,169,110,0.04)'
                : file
                ? 'rgba(76,175,130,0.04)'
                : 'var(--surface)',
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".htm,.html,.pdf"
              style={{ display: 'none' }}
              onChange={e => setFile(e.target.files[0])}
            />
            {file ? (
              <>
                <div style={{
                  width: 36, height: 36,
                  background: 'rgba(76,175,130,0.15)',
                  borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="var(--green)" strokeWidth="2">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                </div>
                <p style={{ color: 'var(--green)', fontWeight: 500, fontSize: '0.9rem' }}>
                  {file.name}
                </p>
                <p style={{ color: 'var(--text3)', fontSize: '0.8rem' }}>
                  {(file.size / 1024 / 1024).toFixed(1)} MB — click to change
                </p>
              </>
            ) : (
              <>
                <div style={{
                  width: 36, height: 36,
                  background: 'var(--surface2)',
                  borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="var(--text3)" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17,8 12,3 7,8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <p style={{ color: 'var(--text2)', fontWeight: 500, fontSize: '0.9rem' }}>
                  Drop 10-K filing here or click to browse
                </p>
                <p style={{ color: 'var(--text3)', fontSize: '0.8rem' }}>
                  Supports .htm, .html, .pdf — up to 30MB
                </p>
              </>
            )}
          </div>
        )}

        {/* ── Borrower Details (shared between both modes) ── */}
        <div style={CARD_STYLE}>
          <p style={CARD_LABEL_STYLE}>Borrower Details</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Field label="Borrower Name" id="bn">
              <input id="bn" style={INPUT_STYLE} placeholder="e.g. Mosaic Company"
                value={borrowerName} onChange={e => setBorrowerName(e.target.value)}
                onFocus={focusBorder} onBlur={blurBorder} />
            </Field>
            <Field label="Industry" id="ind">
              <input id="ind" style={INPUT_STYLE} placeholder="e.g. Agriculture / Fertilizers"
                value={industry} onChange={e => setIndustry(e.target.value)}
                onFocus={focusBorder} onBlur={blurBorder} />
            </Field>
            <Field label="Facility Type" id="ft">
              <input id="ft" style={INPUT_STYLE} placeholder="e.g. Revolving Credit Facility"
                value={facilityType} onChange={e => setFacilityType(e.target.value)}
                onFocus={focusBorder} onBlur={blurBorder} />
            </Field>
            <Field label="Use of Proceeds" id="up">
              <input id="up" style={INPUT_STYLE} placeholder="e.g. General corporate purposes"
                value={useOfProceeds} onChange={e => setUseOfProceeds(e.target.value)}
                onFocus={focusBorder} onBlur={blurBorder} />
            </Field>
          </div>
        </div>

        {/* ── Covenants (shared between both modes) ── */}
        <div style={CARD_STYLE}>
          <p style={CARD_LABEL_STYLE}>
            Covenants{' '}
            <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Field label="Max Total Leverage" id="lev">
              <input id="lev" type="number" step="0.01" style={INPUT_STYLE}
                placeholder="e.g. 4.50" value={maxLeverage}
                onChange={e => setMaxLeverage(e.target.value)}
                onFocus={focusBorder} onBlur={blurBorder} />
            </Field>
            <Field label="Min FCC" id="fcc">
              <input id="fcc" type="number" step="0.01" style={INPUT_STYLE}
                placeholder="e.g. 1.20" value={minFcc}
                onChange={e => setMinFcc(e.target.value)}
                onFocus={focusBorder} onBlur={blurBorder} />
            </Field>
          </div>
        </div>

        {/* ── Quick mode toggle (search mode only — controls MD&A cost) ── */}
        {mode === 'search' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.65rem 0.9rem',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          }}>
            <input
              type="checkbox"
              id="skipMda"
              checked={skipMda}
              onChange={e => setSkipMda(e.target.checked)}
              style={{ cursor: 'pointer', width: 15, height: 15, flexShrink: 0 }}
            />
            <label htmlFor="skipMda" style={{
              fontSize: '0.83rem', color: 'var(--text2)', cursor: 'pointer',
            }}>
              <strong>Quick mode</strong> — skip MD&A segment analysis
              <span style={{ color: 'var(--text3)', marginLeft: '0.4rem' }}>
                (saves ~$1 per run, no segment drivers or commentary)
              </span>
            </label>
          </div>
        )}

        {/* ── Error display ── */}
        {error && (
          <div style={{
            background: 'rgba(224,92,92,0.1)',
            border: '1px solid rgba(224,92,92,0.3)',
            borderRadius: 'var(--radius)',
            padding: '0.75rem 1rem',
            color: 'var(--red)',
            fontSize: '0.875rem',
          }}>
            {error}
          </div>
        )}

        {/* ── Submit button ── */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            background: canSubmit ? 'var(--accent)' : 'var(--surface2)',
            color: canSubmit ? '#0d0f14' : 'var(--text3)',
            border: 'none',
            borderRadius: 'var(--radius)',
            padding: '0.75rem 1.5rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
            letterSpacing: '0.01em',
          }}
          onMouseOver={e => { if (canSubmit) e.target.style.background = 'var(--accent2, var(--accent))' }}
          onMouseOut={e => { if (canSubmit) e.target.style.background = 'var(--accent)' }}
        >
          {!canSubmit
            ? mode === 'upload'
              ? 'Select a file to continue'
              : urlMode
              ? 'Enter a URL to continue'
              : 'Search and select a company to continue'
            : mode === 'upload'
            ? 'Run Analysis →'
            : urlMode
            ? 'Analyse from URL →'
            : selectedFiling
            ? `Analyse ${selectedFiling.fiscal_year} — ${selectedCompany?.ticker || selectedCompany?.name} →`
            : `Analyse most recent 10-K — ${selectedCompany?.ticker || selectedCompany?.name} →`
          }
        </button>

      </div>
    </div>
  )
}
