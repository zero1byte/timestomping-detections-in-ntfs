import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000'

const ARTIFACT_META = {
	mft:      { label: '$MFT',      fullName: 'Master File Table',   csvKey: 'mft_csv',     folder: 'MFT',     prefix: 'MFT_' },
	logfile:  { label: '$LogFile',   fullName: 'Transaction Log',    csvKey: 'logfile_csv',  folder: 'LogFile', prefix: 'LogFile_' },
	usnjrnl:  { label: '$UsnJrnl',   fullName: 'Change Journal',     csvKey: 'usn_csv',      folder: 'UsnJrnl', prefix: 'UsnJrnl_' },
}

const PAGE_SIZES = [25, 50, 100, 200]

/* ── CSV parser (handles quoted fields with commas) ── */
function parseCsv(text) {
	const lines = text.split('\n')
	if (lines.length < 2) return { headers: [], rows: [] }

	function splitRow(line) {
		const fields = []
		let current = ''
		let inQuotes = false
		for (let i = 0; i < line.length; i++) {
			const ch = line[i]
			if (ch === '"') {
				if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
				else inQuotes = !inQuotes
			} else if (ch === ',' && !inQuotes) {
				fields.push(current.trim())
				current = ''
			} else {
				current += ch
			}
		}
		fields.push(current.trim())
		return fields
	}

	const headers = splitRow(lines[0])
	const rows = []
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim()
		if (!line) continue
		const vals = splitRow(line)
		const obj = {}
		headers.forEach((h, idx) => { obj[h] = vals[idx] ?? '' })
		rows.push(obj)
	}
	return { headers, rows }
}

export default function ViewCsvPage() {
	const [searchParams] = useSearchParams()
	const partition = searchParams.get('partition') || ''
	const type = searchParams.get('type') || ''
	const extractionId = searchParams.get('extraction_id') || ''

	const meta = ARTIFACT_META[type] || { label: type.toUpperCase(), fullName: '', csvKey: '', folder: '', prefix: '' }

	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [headers, setHeaders] = useState([])
	const [rows, setRows] = useState([])

	// Table features
	const [search, setSearch] = useState('')
	const [sortCol, setSortCol] = useState('')
	const [sortDir, setSortDir] = useState('asc')
	const [page, setPage] = useState(0)
	const [pageSize, setPageSize] = useState(50)
	const [hiddenCols, setHiddenCols] = useState(new Set())
	const [colMenuOpen, setColMenuOpen] = useState(false)
	const colMenuRef = useRef(null)

	/* ── Close column menu on outside click ── */
	useEffect(() => {
		function handleClick(e) {
			if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false)
		}
		document.addEventListener('mousedown', handleClick)
		return () => document.removeEventListener('mousedown', handleClick)
	}, [])

	/* ── Fetch CSV ── */
	useEffect(() => {
		let cancelled = false

		async function loadCsv() {
			setLoading(true)
			setError('')
			try {
				// 1. List exports to find the CSV file path
				const listRes = await fetch(`${API_BASE}/analysis/exports`)
				if (!listRes.ok) throw new Error(`Failed to list exports (${listRes.status})`)
				const listData = await listRes.json()

				const driveLetter = partition.replace(/[:\\\/]/g, '').trim().toUpperCase()

				// Find the extraction matching our ID
				const extraction = (listData?.data || []).find((e) => e.id === extractionId)
				if (!extraction) throw new Error(`Extraction "${extractionId}" not found`)

				// Get the CSV file info
				const csvFile = extraction.files?.[meta.csvKey]
				if (!csvFile) throw new Error(`${meta.label} CSV not found. Convert it first from the Results page.`)

				const relativePath = csvFile.relative_path
				if (!relativePath) throw new Error('CSV file path not available')

				// 2. Fetch CSV content via static mount
				const csvRes = await fetch(`${API_BASE}/exports/${relativePath}`)
				if (!csvRes.ok) throw new Error(`Failed to download CSV (${csvRes.status})`)

				const csvText = await csvRes.text()
				if (cancelled) return

				const { headers: h, rows: r } = parseCsv(csvText)
				if (h.length === 0) throw new Error('CSV file is empty or invalid')

				setHeaders(h)
				setRows(r)
			} catch (err) {
				if (!cancelled) setError(err.message)
			} finally {
				if (!cancelled) setLoading(false)
			}
		}

		if (extractionId && type) loadCsv()
		else { setError('Missing extraction_id or type parameter'); setLoading(false) }

		return () => { cancelled = true }
	}, [extractionId, type, partition, meta.csvKey, meta.label])

	/* ── Visible columns ── */
	const visibleHeaders = useMemo(() => headers.filter((h) => !hiddenCols.has(h)), [headers, hiddenCols])

	/* ── Sort toggle ── */
	const toggleSort = useCallback((col) => {
		if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
		else { setSortCol(col); setSortDir('asc') }
		setPage(0)
	}, [sortCol])

	/* ── Column visibility ── */
	const toggleCol = useCallback((col) => {
		setHiddenCols((prev) => {
			const next = new Set(prev)
			if (next.has(col)) next.delete(col)
			else next.add(col)
			return next
		})
	}, [])

	const showAllCols = useCallback(() => setHiddenCols(new Set()), [])
	const hideEmptyCols = useCallback(() => {
		const empty = new Set()
		headers.forEach((h) => {
			if (rows.every((r) => !r[h] || r[h] === '' || r[h] === '0' || r[h] === 'None')) empty.add(h)
		})
		setHiddenCols(empty)
	}, [headers, rows])

	/* ── Filtered + sorted rows ── */
	const processed = useMemo(() => {
		let result = rows

		// Search
		if (search.trim()) {
			const q = search.toLowerCase()
			result = result.filter((row) =>
				visibleHeaders.some((h) => (row[h] || '').toLowerCase().includes(q))
			)
		}

		// Sort
		if (sortCol) {
			result = [...result].sort((a, b) => {
				const va = a[sortCol] ?? ''
				const vb = b[sortCol] ?? ''
				const na = Number(va), nb = Number(vb)
				if (!Number.isNaN(na) && !Number.isNaN(nb) && va !== '' && vb !== '') {
					return sortDir === 'asc' ? na - nb : nb - na
				}
				return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
			})
		}

		return result
	}, [rows, search, sortCol, sortDir, visibleHeaders])

	const totalPages = Math.max(1, Math.ceil(processed.length / pageSize))
	const pageRows = processed.slice(page * pageSize, (page + 1) * pageSize)

	/* ── Jump to page ── */
	const goToPage = useCallback((p) => {
		setPage(Math.max(0, Math.min(p, totalPages - 1)))
	}, [totalPages])

	/* ── Render ── */
	return (
		<main className="min-h-screen bg-theme-bg px-6 py-10 text-theme-fg">
			<section className="mx-auto max-w-[98rem]">

				{/* Breadcrumb */}
				<nav className="mb-6 flex items-center gap-2 text-xs text-theme-fg/50">
					<Link to="/partitions" className="transition hover:text-theme-accent">Partitions</Link>
					<span>/</span>
					<Link to={`/results?partition=${encodeURIComponent(partition)}`} className="transition hover:text-theme-accent">Results</Link>
					<span>/</span>
					<span className="font-medium text-theme-fg/80">View {meta.label} CSV</span>
				</nav>

				{/* ── Header ── */}
				<div className="rounded-2xl border border-theme-border bg-theme-surface shadow-sm">
					<div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
						<div>
							<h1 className="text-xl font-bold leading-tight sm:text-2xl">
								{meta.label} <span className="font-normal text-theme-fg/40">CSV Viewer</span>
							</h1>
							<p className="mt-1 text-xs text-theme-fg/50">
								{meta.fullName}
								{partition && (
									<>
										{' — Partition '}
										<span className="font-mono font-semibold text-theme-accent">{partition}</span>
									</>
								)}
								{!loading && rows.length > 0 && (
									<>
										{' — '}
										<span className="tabular-nums font-semibold">{rows.length.toLocaleString()}</span> rows
										{' · '}
										<span className="tabular-nums">{headers.length}</span> columns
									</>
								)}
							</p>
						</div>
						<Link
							to={`/results?partition=${encodeURIComponent(partition)}`}
							className="rounded-lg border border-theme-border px-3 py-1.5 text-xs font-semibold transition hover:bg-theme-accent/5"
						>
							Back to Results
						</Link>
					</div>
				</div>

				{/* ── Loading ── */}
				{loading && (
					<div className="mt-6 flex flex-col items-center rounded-2xl border border-theme-border bg-theme-surface py-20">
						<div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-theme-border border-t-theme-accent" />
						<p className="text-sm text-theme-fg/50">Loading CSV data…</p>
					</div>
				)}

				{/* ── Error ── */}
				{!loading && error && (
					<div className="mt-6 rounded-2xl border border-red-200 bg-red-50/80 p-6 text-center">
						<p className="font-semibold text-red-700">Error</p>
						<p className="mt-1 text-sm text-red-600/80">{error}</p>
						<Link
							to={`/results?partition=${encodeURIComponent(partition)}`}
							className="mt-3 inline-block rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-700"
						>
							Go to Results
						</Link>
					</div>
				)}

				{/* ── Table UI ── */}
				{!loading && !error && rows.length > 0 && (
					<>
						{/* Toolbar */}
						<div className="mt-4 flex flex-wrap items-center gap-3">
							{/* Search */}
							<div className="relative flex-1 min-w-[200px]">
								<svg viewBox="0 0 20 20" fill="currentColor" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-fg/30">
									<path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
								</svg>
								<input
									type="text"
									placeholder="Search across all visible columns…"
									value={search}
									onChange={(e) => { setSearch(e.target.value); setPage(0) }}
									className="w-full rounded-xl border border-theme-border bg-theme-surface py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-theme-accent/40 focus:ring-2 focus:ring-theme-accent/10"
								/>
							</div>

							{/* Column visibility dropdown */}
							<div className="relative" ref={colMenuRef}>
								<button
									onClick={() => setColMenuOpen((v) => !v)}
									className="inline-flex items-center gap-1.5 rounded-xl border border-theme-border bg-theme-surface px-3 py-2.5 text-xs font-medium transition hover:bg-theme-accent/5"
								>
									<svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-theme-fg/40">
										<path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
										<path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
									</svg>
									Columns
									{hiddenCols.size > 0 && (
										<span className="rounded-full bg-theme-accent/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-theme-accent">
											{visibleHeaders.length}/{headers.length}
										</span>
									)}
								</button>
								{colMenuOpen && (
									<div className="absolute right-0 z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl border border-theme-border bg-theme-surface shadow-xl">
										<div className="sticky top-0 flex gap-2 border-b border-theme-border bg-theme-surface px-3 py-2">
											<button onClick={showAllCols} className="rounded-md bg-theme-accent/10 px-2 py-1 text-[10px] font-bold text-theme-accent transition hover:bg-theme-accent/20">Show All</button>
											<button onClick={hideEmptyCols} className="rounded-md bg-theme-fg/5 px-2 py-1 text-[10px] font-bold text-theme-fg/50 transition hover:bg-theme-fg/10">Hide Empty</button>
										</div>
										{headers.map((h) => (
											<label key={h} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition hover:bg-theme-fg/[0.03]">
												<input
													type="checkbox"
													checked={!hiddenCols.has(h)}
													onChange={() => toggleCol(h)}
													className="rounded border-theme-fg/20 text-theme-accent focus:ring-theme-accent/30"
												/>
												<span className="truncate font-mono text-[11px]">{h}</span>
											</label>
										))}
									</div>
								)}
							</div>

							{/* Page size */}
							<select
								value={pageSize}
								onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
								className="rounded-xl border border-theme-border bg-theme-surface px-2.5 py-2.5 text-xs outline-none transition focus:border-theme-accent/40"
							>
								{PAGE_SIZES.map((s) => (
									<option key={s} value={s}>{s} rows</option>
								))}
							</select>

							{/* Row count */}
							<span className="text-xs text-theme-fg/40 tabular-nums">
								{processed.length.toLocaleString()} result{processed.length !== 1 ? 's' : ''}
								{search && ` of ${rows.length.toLocaleString()}`}
							</span>
						</div>

						{/* Table */}
						<div className="mt-3 overflow-hidden rounded-2xl border border-theme-border bg-theme-surface shadow-sm">
							<div className="overflow-x-auto">
								<table className="min-w-full text-[12px]">
									<thead>
										<tr className="border-b border-theme-border bg-theme-fg/[0.02]">
											<th className="sticky left-0 z-10 bg-theme-surface px-3 py-2.5 text-center text-[10px] font-bold text-theme-fg/30">#</th>
											{visibleHeaders.map((h) => (
												<th
													key={h}
													onClick={() => toggleSort(h)}
													className="cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider transition hover:text-theme-accent"
												>
													<span className="inline-flex items-center gap-1">
														{h}
														{sortCol === h && (
															<svg viewBox="0 0 12 12" fill="currentColor" className={`h-2.5 w-2.5 text-theme-accent transition ${sortDir === 'asc' ? 'rotate-180' : ''}`}>
																<path d="M6 8L2 4h8z" />
															</svg>
														)}
													</span>
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{pageRows.length === 0 && (
											<tr>
												<td colSpan={visibleHeaders.length + 1} className="px-6 py-12 text-center text-sm text-theme-fg/40">
													No rows match your search.
												</td>
											</tr>
										)}
										{pageRows.map((row, idx) => (
											<tr
												key={idx}
												className="border-b border-theme-border/50 transition last:border-0 hover:bg-theme-accent/[0.03]"
											>
												<td className="sticky left-0 z-10 bg-theme-surface px-3 py-2 text-center font-mono text-[10px] text-theme-fg/25">
													{page * pageSize + idx + 1}
												</td>
												{visibleHeaders.map((h) => (
													<td key={h} className="max-w-[280px] truncate whitespace-nowrap px-3 py-2 font-mono text-[11px]" title={row[h] || ''}>
														{row[h] || <span className="text-theme-fg/15">—</span>}
													</td>
												))}
											</tr>
										))}
									</tbody>
								</table>
							</div>

							{/* Pagination */}
							<div className="flex items-center justify-between border-t border-theme-border px-4 py-2.5">
								<div className="flex items-center gap-1.5">
									<button
										disabled={page === 0}
										onClick={() => goToPage(0)}
										className="rounded-md border border-theme-border px-2 py-1 text-[11px] font-medium transition enabled:hover:bg-theme-accent/5 disabled:opacity-30"
										title="First page"
									>
										««
									</button>
									<button
										disabled={page === 0}
										onClick={() => goToPage(page - 1)}
										className="rounded-md border border-theme-border px-2.5 py-1 text-[11px] font-medium transition enabled:hover:bg-theme-accent/5 disabled:opacity-30"
									>
										Prev
									</button>
								</div>
								<span className="text-[11px] text-theme-fg/40 tabular-nums">
									Page {page + 1} of {totalPages}
									<span className="ml-2 text-theme-fg/25">
										(rows {(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, processed.length).toLocaleString()})
									</span>
								</span>
								<div className="flex items-center gap-1.5">
									<button
										disabled={page >= totalPages - 1}
										onClick={() => goToPage(page + 1)}
										className="rounded-md border border-theme-border px-2.5 py-1 text-[11px] font-medium transition enabled:hover:bg-theme-accent/5 disabled:opacity-30"
									>
										Next
									</button>
									<button
										disabled={page >= totalPages - 1}
										onClick={() => goToPage(totalPages - 1)}
										className="rounded-md border border-theme-border px-2 py-1 text-[11px] font-medium transition enabled:hover:bg-theme-accent/5 disabled:opacity-30"
										title="Last page"
									>
										»»
									</button>
								</div>
							</div>
						</div>
					</>
				)}

			</section>
		</main>
	)
}
