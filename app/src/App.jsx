import { useEffect, useMemo, useState, useCallback } from 'react'
import './App.css'

const API_BASE = 'http://localhost:3000'

// ============ SVG Icons ============
const Icons = {
  Dashboard: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  Extract: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Convert: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  Detect: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><circle cx="12" cy="16" r="1"/></svg>,
  Data: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
  Drive: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="6" cy="12" r="1.5" fill="currentColor"/><line x1="10" y1="12" x2="18" y2="12"/></svg>,
  Refresh: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
  Export: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Upload: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Alert: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1"/></svg>,
  Search: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
}

// ============ Utility Functions ============
function normalizeDrive(v) { return (v || '').replace(':', '').trim().toUpperCase() }
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function parseCsvLine(line) {
  const values = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"' && inQuotes && line[i + 1] === '"') { current += '"'; i++; continue }
    if (char === '"') { inQuotes = !inQuotes; continue }
    if (char === ',' && !inQuotes) { values.push(current); current = ''; continue }
    current += char
  }
  values.push(current)
  return values
}

function parseExtractionId(path) {
  if (!path) return ''
  const normalized = String(path).replace(/\\/g, '/')
  const match = normalized.match(/(?:\$?MFT|\$?LogFile|\$?UsnJrnl|UsnJrnl_J|LogFile)_([A-Z])_(\d{8}_\d{6})\./i)
  if (match) return `${match[1].toUpperCase()}_${match[2]}`
  const folderMatch = normalized.match(/([A-Z]_\d{8}_\d{6})/i)
  return folderMatch ? folderMatch[1].toUpperCase() : ''
}

function parseCsvFull(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return { headers: [], rows: [] }
  return { headers: parseCsvLine(lines[0]), rows: lines.slice(1).map(parseCsvLine) }
}

function getCell(row, map, key) { return row[map[key]] ?? '' }
function parseDateValue(v) {
  if (!v || v === 'Unknown' || v === 'Invalid') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

function chooseFirstCell(row, map, keys) {
  for (const k of keys) { const v = getCell(row, map, k); if (v) return v }
  return ''
}

function outputPathToCandidates(path) {
  if (!path || path === '-') return []
  const n = String(path).replace(/\\/g, '/')
  const c = []
  // Handle full path with /exports/
  if (n.includes('/exports/')) c.push(`${API_BASE}/exports/${n.split('/exports/')[1]}`)
  // Handle relative path starting with exports/
  if (n.startsWith('exports/')) c.push(`${API_BASE}/${n}`)
  // Handle absolute path
  if (n.startsWith('/')) c.push(`${API_BASE}${n}`)
  // Handle relative artifact paths like MFT/E/file.csv
  if (/^(MFT|LogFile|UsnJrnl)\//i.test(n)) c.push(`${API_BASE}/exports/${n}`)
  return [...new Set(c)]
}

// ============ Reusable Components ============
function Spinner({ size = 'md' }) {
  const sizeClass = size === 'sm' ? 'spinner-sm' : size === 'lg' ? 'spinner-lg' : ''
  return <span className={`spinner ${sizeClass}`} />
}

function LoadingButton({ loading, children, icon: Icon, className = '', ...props }) {
  return (
    <button className={className} {...props} disabled={loading || props.disabled}>
      {loading ? <Spinner size="sm" /> : Icon && <Icon />}
      <span>{children}</span>
    </button>
  )
}

function EmptyState({ icon, title, message }) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  )
}

function DataTable({ data, columns = [], maxHeight = 'sm', emptyMessage = 'No data', onRowClick, selectedColumns, onColumnToggle, showColumnFilter = false, searchable = false }) {
  const [search, setSearch] = useState('')
  
  const allColumns = useMemo(() => {
    if (columns.length) return columns
    if (data?.headers?.length) return data.headers.map(h => ({ key: h, label: h }))
    return []
  }, [columns, data?.headers])

  const visibleColumns = useMemo(() => {
    if (!selectedColumns) return allColumns
    return allColumns.filter(c => selectedColumns.includes(c.key))
  }, [allColumns, selectedColumns])

  const filteredRows = useMemo(() => {
    if (!data?.rows) return []
    if (!search.trim()) return data.rows
    const term = search.toLowerCase()
    return data.rows.filter(row => row.some(cell => String(cell).toLowerCase().includes(term)))
  }, [data?.rows, search])

  const heightClass = maxHeight === 'sm' ? 'table-container-sm' : maxHeight === 'lg' ? 'table-container-lg' : maxHeight === 'xl' ? 'table-container-xl' : ''

  return (
    <div>
      {(showColumnFilter || searchable) && (
        <div className="column-filter">
          {searchable && (
            <div className="flex items-center gap-2" style={{ marginRight: 'auto' }}>
              <Icons.Search />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="form-input form-input-sm" style={{ width: 200 }} />
            </div>
          )}
          {showColumnFilter && allColumns.map(col => (
            <span key={col.key} className={`column-chip ${!selectedColumns || selectedColumns.includes(col.key) ? 'active' : ''}`} onClick={() => onColumnToggle?.(col.key)}>
              {col.label}
            </span>
          ))}
        </div>
      )}
      <div className={`table-container ${heightClass}`}>
        <table>
          <thead>
            <tr>{visibleColumns.map(col => <th key={col.key}>{col.label}</th>)}</tr>
          </thead>
          <tbody>
            {filteredRows.map((row, i) => (
              <tr key={i} onClick={() => onRowClick?.(row, i)} style={onRowClick ? { cursor: 'pointer' } : undefined}>
                {visibleColumns.map(col => {
                  const idx = data.headers?.indexOf(col.key) ?? allColumns.findIndex(c => c.key === col.key)
                  const value = row[idx] ?? row[col.key] ?? '-'
                  return <td key={col.key} className={col.className || ''}>{col.render ? col.render(value, row) : value}</td>
                })}
              </tr>
            ))}
            {!filteredRows.length && (
              <tr><td colSpan={visibleColumns.length} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '2rem' }}>{search ? 'No matching results' : emptyMessage}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data?.rows?.length > 0 && <div className="text-xs text-muted mt-2">Showing {filteredRows.length} of {data.rows.length} rows</div>}
    </div>
  )
}

// ============ Main App Component ============
function App() {
  const [page, setPage] = useState('dashboard')
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState({})
  const [sidebarOpen, setSidebarOpen] = useState(false)
  
  // Data state
  const [drives, setDrives] = useState([])
  const [selectedDrive, setSelectedDrive] = useState('')
  const [extractionId, setExtractionId] = useState('')
  const [extractions, setExtractions] = useState([])
  const [conversions, setConversions] = useState([])
  const [mftData, setMftData] = useState(null)
  const [usnData, setUsnData] = useState(null)
  const [logData, setLogData] = useState(null)
  const [findings, setFindings] = useState([])
  const [threshold, setThreshold] = useState(60)
  const [serverStatus, setServerStatus] = useState('checking')
  const [mftColumns, setMftColumns] = useState(null)
  const [usnColumns, setUsnColumns] = useState(null)
  const [logColumns, setLogColumns] = useState(null)
  const [dataView, setDataView] = useState('mft')
  const [history, setHistory] = useState([])
  const [exports, setExports] = useState([])
  const [csvFiles, setCsvFiles] = useState([])
  const [historyTab, setHistoryTab] = useState('bin')
  const [detectTab, setDetectTab] = useState('sifn')
  const [comprehensiveFindings, setComprehensiveFindings] = useState([])

  const drive = useMemo(() => normalizeDrive(selectedDrive), [selectedDrive])
  const isLoading = Object.values(loading).some(Boolean)

  // Toast helper
  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  // API helper
  const api = useCallback(async (key, path, opts = {}) => {
    setLoading(p => ({ ...p, [key]: true }))
    try {
      const res = await fetch(`${API_BASE}${path}`, opts)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(data?.detail || 'Request failed', 'error'); return { ok: false, data } }
      return { ok: true, data }
    } catch (e) { showToast(e.message, 'error'); return { ok: false } }
    finally { setLoading(p => ({ ...p, [key]: false })) }
  }, [showToast])

  // Check server status
  const checkServer = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/health`)
      setServerStatus(res.ok ? 'online' : 'offline')
    } catch { setServerStatus('offline') }
  }, [])

  // Load drives
  const loadDrives = useCallback(async () => {
    const res = await api('drives', '/extract/drives')
    if (res.ok) {
      const list = res.data?.available_drives || []
      setDrives(list)
      if (!selectedDrive && list.length) setSelectedDrive(list[0].letter)
    }
  }, [api, selectedDrive])

  // Extract artifacts
  const extract = useCallback(async (endpoint, label) => {
    if (!drive) { showToast('Please select a drive first', 'error'); return }
    const res = await api(label, endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drive })
    })
    if (!res.ok) return
    const now = new Date().toLocaleString()
    if (endpoint.includes('extract-all')) {
      const items = Object.entries(res.data?.extractions || {}).map(([a, v]) => ({
        id: parseExtractionId(v?.output_file), artifact: a, status: v?.success ? 'SUCCESS' : 'FAILED',
        size: formatBytes(v?.bytes_extracted || 0), path: v?.output_file || '-', time: now
      }))
      setExtractions(p => [...items, ...p].slice(0, 20))
      if (items[0]?.id) setExtractionId(items[0].id)
      showToast(`Extracted ${items.filter(i => i.status === 'SUCCESS').length} artifacts`, 'success')
    } else {
      const item = { id: parseExtractionId(res.data?.output_file), artifact: res.data?.file_type || label,
        status: res.data?.success ? 'SUCCESS' : 'FAILED', size: formatBytes(res.data?.bytes_extracted || 0), time: now }
      setExtractions(p => [item, ...p].slice(0, 20))
      if (item.id) setExtractionId(item.id)
      showToast(`${item.artifact} extracted`, 'success')
    }
  }, [api, drive, showToast])

  // Convert to CSV
  const convert = useCallback(async (endpoint, label) => {
    if (!extractionId.trim()) { showToast('Enter extraction ID', 'error'); return }
    const res = await api(label, endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extraction_id: extractionId.trim() })
    })
    const item = { artifact: label, status: res.ok ? 'SUCCESS' : 'FAILED',
      records: res.data?.data?.records_parsed || '-', output: res.data?.data?.output_file || '-', time: new Date().toLocaleString() }
    setConversions(p => [item, ...p].slice(0, 20))
    if (res.ok && res.data?.data?.output_file) {
      await loadCsvData(res.data.data.output_file, label)
      showToast(`${label} converted: ${res.data.data.records_parsed || 0} records`, 'success')
    }
  }, [api, extractionId])

  // Convert All
  const convertAll = useCallback(async () => {
    if (!extractionId.trim()) { showToast('Enter extraction ID', 'error'); return }
    setLoading(p => ({ ...p, convertAll: true }))
    try {
      await convert('/analysis/mft/convert', 'MFT')
      await convert('/analysis/usnjrnl/convert', 'USN')
      await convert('/analysis/logfile/convert', 'LogFile')
      showToast('All artifacts converted', 'success')
    } finally {
      setLoading(p => ({ ...p, convertAll: false }))
    }
  }, [convert, extractionId, showToast])

  // Load CSV data
  const loadCsvData = useCallback(async (path, label) => {
    const urls = outputPathToCandidates(path)
    if (!urls.length) {
      showToast(`Could not determine URL for: ${path}`, 'error')
      return
    }
    for (const url of urls) {
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const text = await res.text()
        const parsed = parseCsvFull(text)
        if (!parsed.headers.length) continue
        const data = { headers: parsed.headers, rows: parsed.rows.slice(0, 50000) }
        const lbl = label.toLowerCase()
        const historyItem = { type: lbl.includes('mft') ? 'MFT' : lbl.includes('usn') ? 'USN' : 'LogFile', path: url, records: data.rows.length, loadedAt: new Date().toLocaleString() }
        setHistory(prev => [historyItem, ...prev.filter(h => h.path !== url)].slice(0, 50))
        if (lbl.includes('mft')) { setMftData(data); if (!mftColumns) setMftColumns(data.headers.slice(0, 15)) }
        else if (lbl.includes('usn')) { setUsnData(data); if (!usnColumns) setUsnColumns(data.headers.slice(0, 15)) }
        else if (lbl.includes('log')) { setLogData(data); if (!logColumns) setLogColumns(data.headers.slice(0, 15)) }
        showToast(`Loaded ${data.rows.length.toLocaleString()} records`, 'success')
        return
      } catch (e) { console.error('Load CSV error:', e) }
    }
    showToast(`Failed to load CSV: ${path}`, 'error')
  }, [mftColumns, showToast])

  // Detect timestomping
  const detectTimestomping = useCallback(() => {
    if (!mftData?.headers?.length) { showToast('MFT CSV required', 'error'); return }
    setLoading(p => ({ ...p, detect: true }))
    setTimeout(() => {
      const thresholdMs = Number(threshold || 0) * 60 * 1000
      const results = []
      const mftMap = Object.fromEntries(mftData.headers.map((h, i) => [h, i]))
      const usnMap = usnData?.headers ? Object.fromEntries(usnData.headers.map((h, i) => [h, i])) : {}
      const usnByFile = {}
      if (usnData?.rows?.length) {
        for (const row of usnData.rows) {
          const fn = chooseFirstCell(row, usnMap, ['filename', 'FN1_filename', 'name'])
          const ts = parseDateValue(chooseFirstCell(row, usnMap, ['timestamp', 'timestamp_utc', 'modified']))
          if (fn && ts && (!usnByFile[fn] || ts > usnByFile[fn])) usnByFile[fn] = ts
        }
      }
      for (const row of mftData.rows) {
        const fn = chooseFirstCell(row, mftMap, ['FN1_filename', 'filename', 'name']) || 'unknown'
        const siCreated = parseDateValue(getCell(row, mftMap, 'SI_created_utc'))
        const siModified = parseDateValue(getCell(row, mftMap, 'SI_modified_utc'))
        const siChanged = parseDateValue(getCell(row, mftMap, 'SI_mft_changed_utc'))
        const siAccessed = parseDateValue(getCell(row, mftMap, 'SI_accessed_utc'))
        const fnCreated = parseDateValue(getCell(row, mftMap, 'FN1_created_utc'))
        const fnModified = parseDateValue(getCell(row, mftMap, 'FN1_modified_utc'))
        const fnChanged = parseDateValue(getCell(row, mftMap, 'FN1_mft_changed_utc'))
        const fnAccessed = parseDateValue(getCell(row, mftMap, 'FN1_accessed_utc'))
        
        const formatTs = (ts) => ts ? new Date(ts).toISOString() : '-'
        const siAll = { created: formatTs(siCreated), modified: formatTs(siModified), changed: formatTs(siChanged), accessed: formatTs(siAccessed) }
        const fnAll = { created: formatTs(fnCreated), modified: formatTs(fnModified), changed: formatTs(fnChanged), accessed: formatTs(fnAccessed) }
        
        if (siCreated && fnCreated) {
          const diff = Math.abs(siCreated - fnCreated)
          if (diff >= thresholdMs) results.push({ file: fn, check: 'SI vs FN Created', diff: Math.round(diff / 60000),
            severity: diff > thresholdMs * 10 ? 'HIGH' : diff > thresholdMs * 3 ? 'MEDIUM' : 'LOW',
            a: formatTs(siCreated), b: formatTs(fnCreated), si: siAll, fn: fnAll })
        }
        if (siModified && fnModified) {
          const diff = Math.abs(siModified - fnModified)
          if (diff >= thresholdMs) results.push({ file: fn, check: 'SI vs FN Modified', diff: Math.round(diff / 60000),
            severity: diff > thresholdMs * 10 ? 'HIGH' : diff > thresholdMs * 3 ? 'MEDIUM' : 'LOW',
            a: formatTs(siModified), b: formatTs(fnModified), si: siAll, fn: fnAll })
        }
        const usnTs = usnByFile[fn], mftRef = siChanged || siModified
        if (usnTs && mftRef) {
          const diff = Math.abs(usnTs - mftRef)
          if (diff >= thresholdMs) results.push({ file: fn, check: 'MFT vs USN Journal', diff: Math.round(diff / 60000),
            severity: diff > thresholdMs * 10 ? 'HIGH' : diff > thresholdMs * 3 ? 'MEDIUM' : 'LOW',
            a: formatTs(mftRef), b: formatTs(usnTs), si: siAll, fn: fnAll })
        }
      }
      setFindings(results.slice(0, 1000))
      setLoading(p => ({ ...p, detect: false }))
      const high = results.filter(r => r.severity === 'HIGH').length
      showToast(results.length ? `Found ${results.length} anomalies (${high} high)` : 'No anomalies found', 'success')
    }, 100)
  }, [mftData, usnData, threshold, showToast])

  // Comprehensive detection - correlates SI, FN, USN, LogFile with FALSE POSITIVE REDUCTION
  const detectComprehensive = useCallback(() => {
    if (!mftData?.headers?.length) { showToast('MFT CSV required', 'error'); return }
    
    // Check if we have all 3 sources for best false positive reduction
    const hasUsn = usnData?.rows?.length > 0
    const hasLog = logData?.rows?.length > 0
    if (!hasUsn && !hasLog) {
      showToast('Load USN Journal and/or LogFile CSV for better accuracy', 'warning')
    }
    
    setLoading(p => ({ ...p, detectComp: true }))
    setTimeout(() => {
      const thresholdMs = Number(threshold || 0) * 60 * 1000
      const corroborationWindow = thresholdMs * 2 // Window to check for supporting evidence
      const results = []
      const mftMap = Object.fromEntries(mftData.headers.map((h, i) => [h, i]))
      const formatTs = (ts) => ts ? new Date(ts).toISOString() : '-'
      
      // Legitimate USN reasons that explain SI vs FN differences
      const legitimateReasons = [
        'FILE_CREATE', 'FILE_DELETE', 'RENAME_OLD_NAME', 'RENAME_NEW_NAME',
        'SECURITY_CHANGE', 'BASIC_INFO_CHANGE', 'DATA_OVERWRITE', 'DATA_EXTEND',
        'OBJECT_ID_CHANGE', 'REPARSE_POINT_CHANGE', 'STREAM_CHANGE', 'CLOSE'
      ]
      
      // System paths/patterns that commonly have legitimate timestamp quirks
      const systemPatterns = [
        /^\$/, /^ntuser\.dat/i, /^pagefile\.sys/i, /^swapfile\.sys/i,
        /^hiberfil\.sys/i, /^desktop\.ini/i, /^thumbs\.db/i, /^\.DS_Store/i
      ]
      
      // Build USN lookup by filename (normalized)
      const usnMap = usnData?.headers ? Object.fromEntries(usnData.headers.map((h, i) => [h, i])) : {}
      const usnByFile = {}
      if (usnData?.rows?.length) {
        for (const row of usnData.rows) {
          const fn = (chooseFirstCell(row, usnMap, ['filename', 'FN1_filename', 'name', 'FileName']) || '').toLowerCase()
          if (!fn) continue
          const ts = parseDateValue(chooseFirstCell(row, usnMap, ['timestamp', 'timestamp_utc', 'TimeStamp', 'Timestamp']))
          const reason = chooseFirstCell(row, usnMap, ['reason', 'Reason', 'reason_flags']) || ''
          if (!usnByFile[fn]) usnByFile[fn] = []
          usnByFile[fn].push({ ts, reason, formatted: formatTs(ts), reasons: reason.split(/[|,\s]+/).filter(Boolean) })
        }
      }
      
      // Build LogFile lookup by filename (normalized)
      const logMap = logData?.headers ? Object.fromEntries(logData.headers.map((h, i) => [h, i])) : {}
      const logByFile = {}
      if (logData?.rows?.length) {
        for (const row of logData.rows) {
          const fn = (chooseFirstCell(row, logMap, ['filename', 'FileName', 'name', 'file_name']) || '').toLowerCase()
          if (!fn) continue
          const ts = parseDateValue(chooseFirstCell(row, logMap, ['timestamp', 'TimeStamp', 'lsn_timestamp', 'Timestamp']))
          const op = chooseFirstCell(row, logMap, ['operation', 'Operation', 'op_type', 'redo_op']) || ''
          if (!logByFile[fn]) logByFile[fn] = []
          logByFile[fn].push({ ts, op, formatted: formatTs(ts) })
        }
      }
      
      // Helper: Check if USN/LogFile entries corroborate the timestamp difference
      const checkCorroboration = (filename, siTs, fnTs, usnEntries, logEntries) => {
        const lowerFn = filename.toLowerCase()
        const diff = Math.abs(siTs - fnTs)
        let corroborated = false
        let likelyLegitimate = false
        let supportingEvidence = []
        
        // Check if any USN entry explains the SI timestamp (legitimate file modification)
        for (const usn of usnEntries) {
          if (!usn.ts) continue
          // Check if USN timestamp is close to SI timestamp (file was actually modified)
          if (Math.abs(usn.ts - siTs) < corroborationWindow) {
            const hasLegitReason = usn.reasons.some(r => legitimateReasons.some(lr => r.toUpperCase().includes(lr)))
            if (hasLegitReason) {
              likelyLegitimate = true
              supportingEvidence.push(`USN: ${usn.reasons.join(', ')} at ${usn.formatted}`)
            }
          }
          // Check if USN timestamp matches neither SI nor FN (suspicious gap)
          if (Math.abs(usn.ts - siTs) >= corroborationWindow && Math.abs(usn.ts - fnTs) >= corroborationWindow) {
            corroborated = true
            supportingEvidence.push(`USN gap: ${usn.formatted}`)
          }
        }
        
        // Check LogFile for corroboration
        for (const log of logEntries) {
          if (!log.ts) continue
          // LogFile entry near SI timestamp suggests legitimate modification
          if (Math.abs(log.ts - siTs) < corroborationWindow) {
            likelyLegitimate = true
            supportingEvidence.push(`LogFile: ${log.op || 'operation'} at ${log.formatted}`)
          }
        }
        
        // If no USN/LogFile entries at all for a file with SI!=FN, that's suspicious
        if (usnEntries.length === 0 && logEntries.length === 0 && diff >= thresholdMs) {
          corroborated = true // No journal evidence = suspicious
          supportingEvidence.push('No USN/LogFile entries found')
        }
        
        return { corroborated, likelyLegitimate, supportingEvidence }
      }
      
      // Analyze each MFT record
      for (const row of mftData.rows) {
        const fn = chooseFirstCell(row, mftMap, ['FN1_filename', 'filename', 'name']) || 'unknown'
        const fnLower = fn.toLowerCase()
        const recordNum = getCell(row, mftMap, 'record_number') || getCell(row, mftMap, 'RecordNumber') || '-'
        
        // Skip known system files that commonly have timestamp oddities
        const isSystemFile = systemPatterns.some(p => p.test(fn))
        
        // Extract all SI timestamps
        const si = {
          created: parseDateValue(getCell(row, mftMap, 'SI_created_utc')),
          modified: parseDateValue(getCell(row, mftMap, 'SI_modified_utc')),
          changed: parseDateValue(getCell(row, mftMap, 'SI_mft_changed_utc')),
          accessed: parseDateValue(getCell(row, mftMap, 'SI_accessed_utc'))
        }
        
        // Extract all FN timestamps
        const fn1 = {
          created: parseDateValue(getCell(row, mftMap, 'FN1_created_utc')),
          modified: parseDateValue(getCell(row, mftMap, 'FN1_modified_utc')),
          changed: parseDateValue(getCell(row, mftMap, 'FN1_mft_changed_utc')),
          accessed: parseDateValue(getCell(row, mftMap, 'FN1_accessed_utc'))
        }
        
        // Get USN and LogFile entries for this file
        const usnEntries = usnByFile[fnLower] || []
        const logEntries = logByFile[fnLower] || []
        
        // Collect anomalies for this file with corroboration checks
        const anomalies = []
        let totalConfidence = 0
        let evidenceNotes = []
        let isFalsePositive = false
        
        // Check SI vs FN Created
        if (si.created && fn1.created) {
          const diff = Math.abs(si.created - fn1.created)
          if (diff >= thresholdMs) {
            const { corroborated, likelyLegitimate, supportingEvidence } = checkCorroboration(fn, si.created, fn1.created, usnEntries, logEntries)
            
            if (likelyLegitimate && !corroborated) {
              isFalsePositive = true
              evidenceNotes.push(...supportingEvidence)
            } else if (corroborated) {
              totalConfidence += 30
              anomalies.push({ type: 'SI_FN_CREATED', diff: Math.round(diff / 60000), corroborated })
              evidenceNotes.push(...supportingEvidence)
            } else {
              totalConfidence += 10
              anomalies.push({ type: 'SI_FN_CREATED', diff: Math.round(diff / 60000), corroborated: false })
            }
          }
        }
        
        // Check SI vs FN Modified
        if (si.modified && fn1.modified) {
          const diff = Math.abs(si.modified - fn1.modified)
          if (diff >= thresholdMs) {
            const { corroborated, likelyLegitimate, supportingEvidence } = checkCorroboration(fn, si.modified, fn1.modified, usnEntries, logEntries)
            
            if (likelyLegitimate && !corroborated) {
              isFalsePositive = true
              evidenceNotes.push(...supportingEvidence)
            } else if (corroborated) {
              totalConfidence += 30
              anomalies.push({ type: 'SI_FN_MODIFIED', diff: Math.round(diff / 60000), corroborated })
              evidenceNotes.push(...supportingEvidence)
            } else {
              totalConfidence += 10
              anomalies.push({ type: 'SI_FN_MODIFIED', diff: Math.round(diff / 60000), corroborated: false })
            }
          }
        }
        
        // Additional check: SI Created > SI Modified (impossible in normal operations)
        if (si.created && si.modified && si.created > si.modified + 60000) {
          totalConfidence += 40 // Very suspicious
          anomalies.push({ type: 'SI_CREATED_AFTER_MODIFIED', diff: Math.round((si.created - si.modified) / 60000), corroborated: true })
          evidenceNotes.push('SI_Created timestamp is after SI_Modified (highly suspicious)')
        }
        
        // Additional check: FN timestamps all identical but SI differ (copy/paste timestomping)
        if (fn1.created && fn1.modified && fn1.changed && fn1.accessed) {
          const fnTimes = [fn1.created, fn1.modified, fn1.changed, fn1.accessed]
          const fnAllSame = fnTimes.every(t => Math.abs(t - fnTimes[0]) < 1000)
          const siTimes = [si.created, si.modified, si.changed, si.accessed].filter(Boolean)
          const siVaries = siTimes.length > 1 && siTimes.some(t => Math.abs(t - siTimes[0]) > thresholdMs)
          
          if (fnAllSame && siVaries && !isSystemFile) {
            totalConfidence += 25
            anomalies.push({ type: 'FN_TIMESTAMPS_IDENTICAL', diff: 0, corroborated: true })
            evidenceNotes.push('All FN timestamps identical but SI varies (possible bulk timestomping)')
          }
        }
        
        // Skip if likely a false positive AND it's a low-risk file
        if (isFalsePositive && isSystemFile) continue
        if (anomalies.length === 0) continue
        if (isFalsePositive && totalConfidence < 20) continue
        
        // Calculate final confidence and severity
        // High confidence: corroborated by multiple sources OR impossible timestamp patterns
        // Medium: some anomalies but may be legitimate
        // Low/FP: likely false positive
        let confidence = 'LOW'
        let severity = 'LOW'
        
        if (totalConfidence >= 50 || (hasUsn && hasLog && anomalies.some(a => a.corroborated))) {
          confidence = 'HIGH'
          severity = 'HIGH'
        } else if (totalConfidence >= 25 || anomalies.length > 1) {
          confidence = 'MEDIUM'
          severity = 'MEDIUM'
        } else if (isFalsePositive) {
          confidence = 'LIKELY_FP'
          severity = 'LOW'
        }
        
        const maxDiff = Math.max(...anomalies.map(a => a.diff), 0)
        
        results.push({
          file: fn,
          recordNum,
          anomalyCount: anomalies.length,
          confidence,
          confidenceScore: totalConfidence,
          severity,
          isFalsePositive,
          anomalies,
          evidenceNotes,
          si: { created: formatTs(si.created), modified: formatTs(si.modified), changed: formatTs(si.changed), accessed: formatTs(si.accessed) },
          fn: { created: formatTs(fn1.created), modified: formatTs(fn1.modified), changed: formatTs(fn1.changed), accessed: formatTs(fn1.accessed) },
          usnCount: usnEntries.length,
          usnLatest: usnEntries.length ? usnEntries.sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] : null,
          logCount: logEntries.length,
          logLatest: logEntries.length ? logEntries.sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] : null,
          sources: ['MFT', hasUsn ? 'USN' : null, hasLog ? 'LogFile' : null].filter(Boolean)
        })
      }
      
      // Sort by confidence score (highest first), then severity
      results.sort((a, b) => {
        // Exclude likely FPs from top unless requested
        if (a.isFalsePositive !== b.isFalsePositive) return a.isFalsePositive ? 1 : -1
        if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore
        const sevOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
        return sevOrder[a.severity] - sevOrder[b.severity]
      })
      
      // Filter out likely false positives from main results unless very few findings
      const confirmed = results.filter(r => !r.isFalsePositive)
      const falsePositives = results.filter(r => r.isFalsePositive)
      const finalResults = confirmed.length > 0 ? confirmed : results
      
      setComprehensiveFindings(finalResults.slice(0, 500))
      setLoading(p => ({ ...p, detectComp: false }))
      
      const high = finalResults.filter(r => r.confidence === 'HIGH').length
      const filtered = falsePositives.length
      const msg = finalResults.length 
        ? `Found ${finalResults.length} suspicious files (${high} high confidence)${filtered ? `, ${filtered} likely FPs filtered` : ''}`
        : 'No suspicious files found'
      showToast(msg, finalResults.length ? 'success' : 'info')
    }, 100)
  }, [mftData, usnData, logData, threshold, showToast])

  // Handle CSV upload
  const handleCsvUpload = useCallback(async (kind, file) => {
    if (!file) return
    setLoading(p => ({ ...p, [`upload_${kind}`]: true }))
    try {
      const text = await file.text()
      const parsed = parseCsvFull(text)
      if (!parsed.headers.length) { showToast('Invalid CSV', 'error'); return }
      const data = { headers: parsed.headers, rows: parsed.rows.slice(0, 50000) }
      if (kind === 'mft') { setMftData(data); if (!mftColumns) setMftColumns(data.headers.slice(0, 15)) }
      else if (kind === 'usn') setUsnData(data)
      else if (kind === 'log') setLogData(data)
      showToast(`Loaded ${data.rows.length} ${kind.toUpperCase()} records`, 'success')
    } catch (e) { showToast(e.message, 'error') }
    finally { setLoading(p => ({ ...p, [`upload_${kind}`]: false })) }
  }, [mftColumns, showToast])

  const toggleMftColumn = useCallback((col) => {
    setMftColumns(prev => prev?.includes(col) ? prev.filter(c => c !== col) : [...(prev || []), col])
  }, [])

  const toggleUsnColumn = useCallback((col) => {
    setUsnColumns(prev => prev?.includes(col) ? prev.filter(c => c !== col) : [...(prev || []), col])
  }, [])

  const toggleLogColumn = useCallback((col) => {
    setLogColumns(prev => prev?.includes(col) ? prev.filter(c => c !== col) : [...(prev || []), col])
  }, [])

  const navigateTo = useCallback((p) => {
    setPage(p)
    setSidebarOpen(false)
  }, [])

  const exportFindings = useCallback(() => {
    if (!findings.length) return
    const headers = ['File', 'Check', 'Diff (min)', 'Severity', 'SI Created', 'SI Modified', 'SI Changed', 'SI Accessed', 'FN Created', 'FN Modified', 'FN Changed', 'FN Accessed']
    const rows = findings.map(f => [f.file, f.check, f.diff, f.severity, f.si?.created, f.si?.modified, f.si?.changed, f.si?.accessed, f.fn?.created, f.fn?.modified, f.fn?.changed, f.fn?.accessed])
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `findings_${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }, [findings])

  useEffect(() => { checkServer(); loadDrives(); loadExports(); const i = setInterval(checkServer, 30000); return () => clearInterval(i) }, [])

  // Load exports from API
  const loadExports = useCallback(async () => {
    const res = await api('exports', '/analysis/exports')
    if (res.ok && res.data?.data) {
      setExports(res.data.data)
      setCsvFiles(res.data.csv_files || [])
    }
  }, [api])

  const stats = useMemo(() => {
    // Calculate file sizes from exports
    const latestExport = exports[0]
    return {
      extractions: extractions.length,
      successful: extractions.filter(e => e.status === 'SUCCESS').length,
      mftRecords: mftData?.rows?.length || 0,
      usnRecords: usnData?.rows?.length || 0,
      logRecords: logData?.rows?.length || 0,
      findings: findings.length,
      highSeverity: findings.filter(f => f.severity === 'HIGH').length,
      mftSize: latestExport?.files?.mft?.size_mb || 0,
      usnSize: latestExport?.files?.usn_journal?.size_mb || 0,
      logSize: latestExport?.files?.logfile?.size_mb || 0
    }
  }, [extractions, mftData, usnData, logData, findings, exports])

  return (
    <div className="app">
      <div className={`sidebar-overlay ${sidebarOpen ? 'active' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo"><Icons.Detect /><span>NTFS Detection</span></div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>&times;</button>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">Main</div>
          <div className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => navigateTo('dashboard')}>Dashboard</div>
          <div className={`nav-item ${page === 'extract' ? 'active' : ''}`} onClick={() => navigateTo('extract')}>Extract</div>
          <div className={`nav-item ${page === 'convert' ? 'active' : ''}`} onClick={() => navigateTo('convert')}>Convert</div>
          <div className={`nav-item ${page === 'detect' ? 'active' : ''}`} onClick={() => navigateTo('detect')}>Detect</div>
          <div className="nav-section">Analyzers</div>
          <div className={`nav-item ${page === 'mft' ? 'active' : ''}`} onClick={() => navigateTo('mft')}>MFT Analyzer</div>
          <div className={`nav-item ${page === 'usn' ? 'active' : ''}`} onClick={() => navigateTo('usn')}>USN Journal</div>
          <div className={`nav-item ${page === 'logfile' ? 'active' : ''}`} onClick={() => navigateTo('logfile')}>LogFile</div>
          <div className="nav-section">History</div>
          <div className={`nav-item ${page === 'history' ? 'active' : ''}`} onClick={() => navigateTo('history')}>Loaded Files</div>
        </nav>
        <div className="sidebar-footer">Server: {serverStatus}</div>
      </aside>
      <main className="main">
        <header className="header">
          <button className="menu-toggle" onClick={() => setSidebarOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
          </button>
          <h1 className="header-title">{page.charAt(0).toUpperCase() + page.slice(1)}</h1>
          {isLoading && <Spinner size="sm" />}
        </header>
        <div className="content">
          {page === 'dashboard' && (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-label">MFT Records</div>
                  <div className="stat-value">{stats.mftRecords.toLocaleString()}</div>
                  {stats.mftSize > 0 && <div className="stat-sub">{stats.mftSize} MB extracted</div>}
                </div>
                <div className="stat-card">
                  <div className="stat-label">USN Records</div>
                  <div className="stat-value">{stats.usnRecords.toLocaleString()}</div>
                  {stats.usnSize > 0 && <div className="stat-sub">{stats.usnSize} MB extracted</div>}
                </div>
                <div className="stat-card">
                  <div className="stat-label">Log Records</div>
                  <div className="stat-value">{stats.logRecords.toLocaleString()}</div>
                  {stats.logSize > 0 && <div className="stat-sub">{stats.logSize} MB extracted</div>}
                </div>
                <div className="stat-card danger">
                  <div className="stat-label">Anomalies Found</div>
                  <div className="stat-value">{stats.findings}</div>
                  {stats.highSeverity > 0 && <div className="stat-sub">{stats.highSeverity} high severity</div>}
                </div>
              </div>
              <div className="card">
                <div className="card-header"><div className="card-title">Quick Actions</div></div>
                <div className="card-body">
                  <div className="btn-group">
                    <button className="btn btn-primary" onClick={() => setPage('extract')}>Extract Artifacts</button>
                    <button className="btn btn-success" onClick={() => setPage('convert')}>Convert to CSV</button>
                    <button className="btn btn-danger" onClick={() => setPage('detect')}>Run Detection</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {page === 'extract' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Extract NTFS Artifacts</div>
                <button className="btn btn-outline btn-sm" onClick={loadDrives} disabled={loading.drives}>
                  {loading.drives ? <Spinner size="sm" /> : 'Refresh Drives'}
                </button>
              </div>
              <div className="card-body">
                <div className="drive-grid">
                  {drives.map((d, i) => (
                    <div key={i} className={`drive-card ${selectedDrive === d.letter ? 'selected' : ''}`} onClick={() => setSelectedDrive(d.letter)}>
                      <div className="drive-letter">{d.letter}:</div>
                      <div className="drive-info">{d.free_gb} GB free</div>
                    </div>
                  ))}
                </div>
                {selectedDrive && (
                  <div className="extract-actions">
                    <LoadingButton loading={loading.extractAll} onClick={() => extract('/extract/extract-all', 'extractAll')} className="btn btn-primary btn-lg">
                      Extract All Artifacts from {selectedDrive}:
                    </LoadingButton>
                    <p className="text-muted text-sm">Extracts MFT, USN Journal, and LogFile in one operation</p>
                  </div>
                )}
                {extractions.length > 0 && (
                  <div className="table-container-sm">
                    <table>
                      <thead><tr><th>ID</th><th>Artifact</th><th>Status</th><th>Size</th><th>Time</th></tr></thead>
                      <tbody>
                        {extractions.map((e, i) => (
                          <tr key={i} className="clickable" onClick={() => e.id && setExtractionId(e.id)}>
                            <td className="font-medium">{e.id || '-'}</td>
                            <td>{e.artifact}</td>
                            <td><span className={`status-badge ${e.status === 'OK' ? 'success' : 'error'}`}>{e.status}</span></td>
                            <td>{e.size}</td>
                            <td>{e.time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {page === 'convert' && (
            <div className="card">
              <div className="card-header"><div className="card-title">Convert to CSV</div></div>
              <div className="card-body">
                <div className="form-group">
                  <label className="form-label">Extraction ID</label>
                  <input className="form-input" value={extractionId} onChange={e => setExtractionId(e.target.value)} placeholder="e.g. C_20260301_120000" />
                </div>
                <div className="extract-actions">
                  <LoadingButton loading={loading.convertAll || loading.mft || loading.usn || loading.log} onClick={convertAll} className="btn btn-success btn-lg">
                    Convert All Artifacts to CSV
                  </LoadingButton>
                  <p className="text-muted text-sm">Converts MFT, USN Journal, and LogFile to CSV format</p>
                </div>
                {conversions.length > 0 && (
                  <div className="table-container-sm">
                    <table>
                      <thead><tr><th>Artifact</th><th>Status</th><th>Records</th><th>Time</th><th>Actions</th></tr></thead>
                      <tbody>
                        {conversions.map((c, i) => (
                          <tr key={i}>
                            <td>{c.artifact}</td>
                            <td><span className={`status-badge ${c.status === 'SUCCESS' ? 'success' : 'error'}`}>{c.status}</span></td>
                            <td>{c.records}</td>
                            <td>{c.time}</td>
                            <td>
                              {c.output && c.output !== '-' && (
                                <div className="btn-group-sm">
                                  <a href={`http://localhost:3000/exports/${c.output.replace(/^.*exports[\\/]/, '')}`} download className="btn btn-outline btn-xs">Download</a>
                                  <button className="btn btn-outline btn-xs" onClick={() => { 
                                    loadCsvData(c.output, c.artifact); 
                                    navigateTo(c.artifact.toLowerCase().includes('mft') ? 'mft' : c.artifact.toLowerCase().includes('usn') ? 'usn' : 'logfile'); 
                                  }}>View</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {page === 'detect' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Timestomping Detection</div>
                <div className="btn-group">
                  <button className={`btn ${detectTab === 'sifn' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDetectTab('sifn')}>SI vs FN</button>
                  <button className={`btn ${detectTab === 'comprehensive' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDetectTab('comprehensive')}>Comprehensive</button>
                </div>
              </div>
              <div className="card-body">
                <div className="form-group">
                  <label className="form-label">Threshold (minutes)</label>
                  <input type="number" className="form-input" value={threshold} onChange={e => setThreshold(e.target.value)} style={{ maxWidth: 150 }} />
                </div>
                <div className="upload-grid">
                  <div className="upload-card">
                    <div className="upload-header">MFT CSV</div>
                    <label className="upload-area">
                      <Icons.Upload />
                      <span>{mftData ? `${mftData.rows.length.toLocaleString()} records loaded` : 'Click to upload'}</span>
                      <input type="file" accept=".csv" hidden onChange={e => handleCsvUpload('mft', e.target.files?.[0])} />
                    </label>
                    {mftData && <span className="status-badge success">Loaded</span>}
                  </div>
                  <div className="upload-card">
                    <div className="upload-header">USN Journal CSV</div>
                    <label className="upload-area">
                      <Icons.Upload />
                      <span>{usnData ? `${usnData.rows.length.toLocaleString()} records loaded` : 'Click to upload'}</span>
                      <input type="file" accept=".csv" hidden onChange={e => handleCsvUpload('usn', e.target.files?.[0])} />
                    </label>
                    {usnData && <span className="status-badge success">Loaded</span>}
                  </div>
                  <div className="upload-card">
                    <div className="upload-header">LogFile CSV</div>
                    <label className="upload-area">
                      <Icons.Upload />
                      <span>{logData ? `${logData.rows.length.toLocaleString()} records loaded` : 'Click to upload'}</span>
                      <input type="file" accept=".csv" hidden onChange={e => handleCsvUpload('log', e.target.files?.[0])} />
                    </label>
                    {logData && <span className="status-badge success">Loaded</span>}
                  </div>
                </div>
                <div className="data-info">
                  <span>MFT: {mftData ? `${mftData.rows.length} records` : 'Not loaded'} {stats.mftSize > 0 && <small className="text-muted">({stats.mftSize} MB)</small>}</span>
                  <span>USN: {usnData ? `${usnData.rows.length} records` : 'Not loaded'} {stats.usnSize > 0 && <small className="text-muted">({stats.usnSize} MB)</small>}</span>
                  <span>LogFile: {logData ? `${logData.rows.length} records` : 'Not loaded'} {stats.logSize > 0 && <small className="text-muted">({stats.logSize} MB)</small>}</span>
                </div>
                
                {detectTab === 'sifn' && (
                  <>
                    <div className="mb-3">
                      <button className="btn btn-primary" onClick={detectTimestomping} disabled={loading.detect}>
                        {loading.detect ? <Spinner size="sm" /> : 'Run SI vs FN Detection'}
                      </button>
                    </div>
                    {findings.length > 0 ? (
                      <div className="table-container-xl" style={{ overflowX: 'auto', overflowY: 'auto' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>File</th>
                              <th>Check</th>
                              <th>Diff (min)</th>
                              <th>Severity</th>
                              <th>SI Created</th>
                              <th>SI Modified</th>
                              <th>SI Changed</th>
                              <th>SI Accessed</th>
                              <th>FN Created</th>
                              <th>FN Modified</th>
                              <th>FN Changed</th>
                              <th>FN Accessed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {findings.map((f, i) => (
                              <tr key={i}>
                                <td className="font-medium" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file}</td>
                                <td className="text-nowrap">{f.check}</td>
                                <td className="text-danger font-bold">{f.diff}</td>
                                <td><span className={`status-badge ${f.severity === 'HIGH' ? 'error' : f.severity === 'MEDIUM' ? 'warning' : 'info'}`}>{f.severity}</span></td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.7rem' }}>{f.si?.created || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.7rem' }}>{f.si?.modified || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.7rem' }}>{f.si?.changed || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.7rem' }}>{f.si?.accessed || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.7rem' }}>{f.fn?.created || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.7rem' }}>{f.fn?.modified || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.7rem' }}>{f.fn?.changed || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.7rem' }}>{f.fn?.accessed || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState icon={<Icons.Alert />} title="No Anomalies" message="Run detection after loading MFT data" />
                    )}
                  </>
                )}
                
                {detectTab === 'comprehensive' && (
                  <>
                    <div className="mb-3">
                      <button className="btn btn-primary" onClick={detectComprehensive} disabled={loading.detectComp}>
                        {loading.detectComp ? <Spinner size="sm" /> : 'Run Comprehensive Analysis'}
                      </button>
                      <p className="text-muted text-sm mt-2">Correlates SI, FN, USN Journal, and LogFile timestamps - filters false positives</p>
                    </div>
                    {comprehensiveFindings.length > 0 ? (
                      <div className="table-container-xl" style={{ overflowX: 'auto', overflowY: 'auto' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>File</th>
                              <th>Record #</th>
                              <th>Confidence</th>
                              <th>Score</th>
                              <th>Anomalies</th>
                              <th>Evidence</th>
                              <th>Sources</th>
                              <th>SI Created</th>
                              <th>SI Modified</th>
                              <th>FN Created</th>
                              <th>FN Modified</th>
                              <th>USN Latest</th>
                              <th>LogFile Latest</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comprehensiveFindings.map((f, i) => (
                              <tr key={i} className={f.isFalsePositive ? 'opacity-60' : ''}>
                                <td className="font-medium" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.file}>{f.file}</td>
                                <td>{f.recordNum}</td>
                                <td>
                                  <span className={`status-badge ${f.confidence === 'HIGH' ? 'error' : f.confidence === 'MEDIUM' ? 'warning' : f.confidence === 'LIKELY_FP' ? 'info' : 'info'}`}>
                                    {f.confidence}
                                  </span>
                                </td>
                                <td className="text-center font-mono">{f.confidenceScore}</td>
                                <td>
                                  <span className="text-danger font-bold">{f.anomalyCount}</span>
                                  <span className="text-muted text-xs ml-1">({f.anomalies.map(a => a.type.replace(/_/g, ' ')).join(', ')})</span>
                                </td>
                                <td className="text-xs" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.evidenceNotes?.join(' | ')}>
                                  {f.evidenceNotes?.length > 0 ? f.evidenceNotes.slice(0, 2).join('; ') : '-'}
                                </td>
                                <td>{f.sources.map(s => <span key={s} className="status-badge info mr-1" style={{ fontSize: '0.65rem' }}>{s}</span>)}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.65rem' }}>{f.si?.created || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.65rem' }}>{f.si?.modified || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.65rem' }}>{f.fn?.created || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.65rem' }}>{f.fn?.modified || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.65rem' }} title={f.usnLatest?.reason}>{f.usnLatest?.formatted || '-'}</td>
                                <td className="td-mono text-nowrap" style={{ fontSize: '0.65rem' }} title={f.logLatest?.op}>{f.logLatest?.formatted || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState icon={<Icons.Alert />} title="No Suspicious Files" message="Run comprehensive analysis after loading data (MFT required, USN & LogFile optional)" />
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {page === 'mft' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">MFT Analyzer</div>
                <div className="btn-group-responsive">
                  <label className="btn btn-outline btn-sm">
                    <Icons.Upload /> Upload CSV
                    <input type="file" accept=".csv" hidden onChange={e => handleCsvUpload('mft', e.target.files?.[0])} />
                  </label>
                  {mftData && <span className="badge">{mftData.rows.length.toLocaleString()} records</span>}
                </div>
              </div>
              <div className="card-body">
                {mftData ? (
                  <DataTable data={mftData} maxHeight="xl" selectedColumns={mftColumns} onColumnToggle={toggleMftColumn} showColumnFilter searchable />
                ) : (
                  <EmptyState icon={<Icons.Data />} title="No MFT Data" message="Convert MFT artifact or upload a CSV file" />
                )}
              </div>
            </div>
          )}

          {page === 'usn' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">USN Journal Analyzer</div>
                <div className="btn-group-responsive">
                  <label className="btn btn-outline btn-sm">
                    <Icons.Upload /> Upload CSV
                    <input type="file" accept=".csv" hidden onChange={e => handleCsvUpload('usn', e.target.files?.[0])} />
                  </label>
                  {usnData && <span className="badge">{usnData.rows.length.toLocaleString()} records</span>}
                </div>
              </div>
              <div className="card-body">
                {usnData ? (
                  <DataTable data={usnData} maxHeight="xl" selectedColumns={usnColumns} onColumnToggle={toggleUsnColumn} showColumnFilter searchable />
                ) : (
                  <EmptyState icon={<Icons.Data />} title="No USN Data" message="Convert USN artifact or upload a CSV file" />
                )}
              </div>
            </div>
          )}

          {page === 'logfile' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">LogFile Analyzer</div>
                <div className="btn-group-responsive">
                  <label className="btn btn-outline btn-sm">
                    <Icons.Upload /> Upload CSV
                    <input type="file" accept=".csv" hidden onChange={e => handleCsvUpload('log', e.target.files?.[0])} />
                  </label>
                  {logData && <span className="badge">{logData.rows.length.toLocaleString()} records</span>}
                </div>
              </div>
              <div className="card-body">
                {logData ? (
                  <DataTable data={logData} maxHeight="xl" selectedColumns={logColumns} onColumnToggle={toggleLogColumn} showColumnFilter searchable />
                ) : (
                  <EmptyState icon={<Icons.Data />} title="No LogFile Data" message="Convert LogFile artifact or upload a CSV file" />
                )}
              </div>
            </div>
          )}

          {page === 'history' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">File History</div>
                <div className="btn-group-responsive">
                  <div className="btn-group">
                    <button className={`btn ${historyTab === 'bin' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setHistoryTab('bin')}>Extracted (.bin)</button>
                    <button className={`btn ${historyTab === 'csv' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setHistoryTab('csv')}>Converted (.csv)</button>
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={loadExports} disabled={loading.exports}>
                    {loading.exports ? <Spinner size="sm" /> : 'Refresh'}
                  </button>
                </div>
              </div>
              <div className="card-body">
                {historyTab === 'bin' && (
                  <>
                    <p className="text-muted text-sm mb-3">Raw extracted NTFS artifacts in binary format</p>
                    {exports.length > 0 ? (
                      <div className="table-container-lg">
                        <table>
                          <thead><tr><th>Extraction ID</th><th>Drive</th><th>Created</th><th>MFT</th><th>LogFile</th><th>USN Journal</th><th>Actions</th></tr></thead>
                          <tbody>
                            {exports.map((exp, i) => (
                              <tr key={i}>
                                <td className="font-medium">{exp.id}</td>
                                <td>{exp.drive}</td>
                                <td>{new Date(exp.created).toLocaleString()}</td>
                                <td>
                                  {exp.files?.mft ? (
                                    <div className="file-info">
                                      <span className="status-badge success">{exp.files.mft.size_mb} MB</span>
                                      <a href={`http://localhost:3000/exports/${exp.files.mft.relative_path}`} download className="btn btn-outline btn-xs">Download</a>
                                    </div>
                                  ) : <span className="text-muted">-</span>}
                                </td>
                                <td>
                                  {exp.files?.logfile ? (
                                    <div className="file-info">
                                      <span className="status-badge info">{exp.files.logfile.size_mb} MB</span>
                                      <a href={`http://localhost:3000/exports/${exp.files.logfile.relative_path}`} download className="btn btn-outline btn-xs">Download</a>
                                    </div>
                                  ) : <span className="text-muted">-</span>}
                                </td>
                                <td>
                                  {exp.files?.usn_journal ? (
                                    <div className="file-info">
                                      <span className="status-badge warning">{exp.files.usn_journal.size_mb} MB</span>
                                      <a href={`http://localhost:3000/exports/${exp.files.usn_journal.relative_path}`} download className="btn btn-outline btn-xs">Download</a>
                                    </div>
                                  ) : <span className="text-muted">-</span>}
                                </td>
                                <td>
                                  <button className="btn btn-success btn-xs" onClick={() => { setExtractionId(exp.id); navigateTo('convert'); }}>Convert All</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState icon={<Icons.Data />} title="No Extracted Files" message="Extract NTFS artifacts to see them here" />
                    )}
                  </>
                )}

                {historyTab === 'csv' && (
                  <>
                    <p className="text-muted text-sm mb-3">Converted CSV files ready for analysis</p>
                    {csvFiles.length > 0 ? (
                      <div className="table-container-xl">
                        <table>
                          <thead><tr><th>Artifact</th><th>Extraction ID</th><th>Drive</th><th>File</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead>
                          <tbody>
                            {csvFiles.map((f, i) => (
                              <tr key={i}>
                                <td><span className={`status-badge ${f.artifact_type === 'MFT' ? 'info' : f.artifact_type === 'UsnJrnl' ? 'warning' : 'success'}`}>{f.artifact_type}</span></td>
                                <td className="font-medium">{f.extraction_id}</td>
                                <td>{f.drive}</td>
                                <td className="td-mono text-sm">{f.filename}</td>
                                <td><span className="status-badge">{f.size_mb} MB</span></td>
                                <td>{new Date(f.modified).toLocaleString()}</td>
                                <td>
                                  <div className="btn-group-sm">
                                    <a href={`http://localhost:3000/exports/${f.relative_path}`} download className="btn btn-outline btn-xs">Download</a>
                                    <button className="btn btn-outline btn-xs" onClick={async () => { 
                                      await loadCsvData(f.relative_path, f.artifact_type); 
                                      navigateTo(f.artifact_type === 'MFT' ? 'mft' : f.artifact_type === 'UsnJrnl' ? 'usn' : 'logfile'); 
                                    }}>View</button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState icon={<Icons.Data />} title="No CSV Files" message="Convert extracted artifacts to CSV to see them here" />
                    )}

                    {history.length > 0 && (
                      <>
                        <h3 className="mt-4 mb-2 font-medium">Recently Loaded in Memory</h3>
                        <div className="table-container-sm">
                          <table>
                            <thead><tr><th>Type</th><th>Records</th><th>Loaded At</th><th>Actions</th></tr></thead>
                            <tbody>
                              {history.map((h, i) => (
                                <tr key={i}>
                                  <td><span className={`status-badge ${h.type === 'MFT' ? 'info' : h.type === 'USN' ? 'warning' : 'success'}`}>{h.type}</span></td>
                                  <td>{h.records.toLocaleString()}</td>
                                  <td>{h.loadedAt}</td>
                                  <td>
                                    <button className="btn btn-outline btn-xs" onClick={() => navigateTo(h.type.toLowerCase() === 'logfile' ? 'logfile' : h.type.toLowerCase())}>View</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  )

}

export default App

