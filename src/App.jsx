/**
 * App.jsx
 * =======
 * Root component. The key change from the previous version: handleAnalyse now
 * accepts a third parameter `endpoint` so UploadForm can call different backend
 * routes (EDGAR search, URL paste, file upload) while all other app state and
 * UI (ResultsView, loading, error, access gate) stays identical.
 */

import { useState } from 'react'
import UploadForm from './components/UploadForm'
import ResultsView from './components/ResultsView'
import Header from './components/Header'

function useAuth() {
  const [authenticated, setAuthenticated] = useState(
    () => sessionStorage.getItem('credit_ai_auth') === 'true'
  )
  const login  = (code) => { sessionStorage.setItem('credit_ai_auth', 'true'); sessionStorage.setItem('credit_ai_code', code); setAuthenticated(true) }
  const logout = ()     => { sessionStorage.removeItem('credit_ai_auth'); sessionStorage.removeItem('credit_ai_code'); setAuthenticated(false) }
  return { authenticated, login, logout }
}

export function getAccessCode() {
  return sessionStorage.getItem('credit_ai_code') || ''
}

export default function App() {
  const { authenticated, login, logout } = useAuth()
  const [result, setResult]             = useState(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(null)
  const [companyName, setCompanyName]   = useState('')

  if (!authenticated) return <AccessGate onLogin={login} />

  /**
   * Main analysis handler.
   *
   * @param {FormData} formData     Form payload (file / CIK / URL + borrower fields)
   * @param {string}   borrowerName Company name for the results header
   * @param {string}   endpoint     API route — UploadForm passes one of:
   *                                  '/v1/analyze'       (file upload)
   *                                  '/v1/analyze/edgar' (EDGAR search)
   *                                  '/v1/analyze/url'   (URL paste)
   */
  const handleAnalyse = async (formData, borrowerName, endpoint = '/v1/analyze') => {
    setLoading(true)
    setError(null)
    setResult(null)
    setCompanyName(borrowerName || '')
    try {
      const res = await fetch(endpoint, {
        method: 'POST', body: formData,
        headers: { 'X-Access-Code': getAccessCode() },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        if (res.status === 401) { logout(); return }
        throw new Error(err.detail || `Server error ${res.status}`)
      }
      setResult(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => { setResult(null); setError(null); setCompanyName('') }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header onReset={result ? handleReset : null} />
      <main style={{ flex: 1, maxWidth: 1100, margin: '0 auto', width: '100%', padding: '2rem 1.5rem' }}>
        {!result && !loading && <UploadForm onSubmit={handleAnalyse} error={error} />}
        {loading && <LoadingState />}
        {result && <ResultsView data={result} companyName={companyName} onReset={handleReset} />}
      </main>
    </div>
  )
}

function AccessGate({ onLogin }) {
  const [code, setCode]     = useState('')
  const [error, setError]   = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true); setError(false)
    try {
      const res = await fetch('/v1/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access-Code': code.trim() } })
      res.ok ? onLogin(code.trim()) : setError(true)
    } catch { onLogin(code.trim()) }  // Backend unreachable = local dev, let through
    finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '2rem' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '2.5rem 2rem', width: '100%', maxWidth: 380, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--accent)', margin: '0 auto 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📊</div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.4rem' }}>Credit Agent</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text3)', marginBottom: '2rem' }}>Enter your access code to continue</p>
        <form onSubmit={handleSubmit}>
          <input type="password" placeholder="Access code" value={code} onChange={e => { setCode(e.target.value); setError(false) }} autoFocus
            style={{ width: '100%', padding: '0.65rem 0.9rem', background: 'var(--surface2)', border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`, borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: '0.9rem', fontFamily: 'inherit', marginBottom: error ? '0.4rem' : '0.75rem', boxSizing: 'border-box', outline: 'none' }} />
          {error && <p style={{ fontSize: '0.8rem', color: 'var(--red)', marginBottom: '0.75rem' }}>Incorrect access code</p>}
          <button type="submit" disabled={loading || !code.trim()} style={{ width: '100%', padding: '0.65rem', background: 'var(--accent)', color: '#0d0f14', border: 'none', borderRadius: 'var(--radius)', fontSize: '0.9rem', fontWeight: 600, fontFamily: 'inherit', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading || !code.trim() ? 0.6 : 1 }}>
            {loading ? 'Verifying…' : 'Continue →'}
          </button>
        </form>
        <p style={{ fontSize: '0.75rem', color: 'var(--text3)', marginTop: '1.5rem' }}>
          Private demo. Contact <a href="mailto:liamcleary@example.com" style={{ color: 'var(--accent)' }}>Liam Cleary</a> to request access.
        </p>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1.5rem' }}>
      <div style={{ position: 'relative', width: 56, height: 56 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid transparent', borderTopColor: 'var(--accent)', animation: 'spin 0.9s linear infinite' }} />
        <div style={{ position: 'absolute', inset: 8, borderRadius: '50%', border: '2px solid transparent', borderTopColor: 'var(--accent2, var(--accent))', animation: 'spin 1.4s linear infinite reverse' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: 'var(--text)', fontWeight: 500, marginBottom: '0.3rem' }}>Analysing filing…</p>
        <p style={{ color: 'var(--text3)', fontSize: '0.875rem' }}>Extracting financials, reading MD&A, building memo</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
