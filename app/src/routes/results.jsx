import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000'

/* ── sessionStorage helpers ── */
const STORAGE_PREFIX = 'csv_state_'
function saveArtifactState(extractionId, key, state) {
	try { sessionStorage.setItem(`${STORAGE_PREFIX}${extractionId}_${key}`, JSON.stringify(state)) } catch {}
}
function loadArtifactState(extractionId, key) {
	try {
		const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${extractionId}_${key}`)
		if (raw) return JSON.parse(raw)
	} catch {}
	return null
}

const ARTIFACTS = [
	{
		key: 'mft',
		label: '$MFT',
		fullName: 'Master File Table',
		desc: 'Core metadata — every file & directory entry with $SI and $FN timestamps.',
		convertEndpoint: '/analysis/mft/convert',
		csvFileKey: 'mft_csv',
		icon: (c) => (
			<svg viewBox="0 0 24 24" fill="none" className={c}>
				<path d="M4 4h16v16H4z" stroke="currentColor" strokeWidth="1.6" rx="2" />
				<path d="M4 9h16M9 9v11" stroke="currentColor" strokeWidth="1.6" />
				<circle cx="6.5" cy="6.5" r="1" fill="currentColor" />
			</svg>
		),
	},
	{
		key: 'logfile',
		label: '$LogFile',
		fullName: 'Transaction Log',
		desc: 'NTFS redo/undo journal — low-level transactional metadata operations.',
		convertEndpoint: '/analysis/logfile/convert',
		csvFileKey: 'logfile_csv',
		icon: (c) => (
			<svg viewBox="0 0 24 24" fill="none" className={c}>
				<rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" />
				<path d="M8 8h8M8 12h6M8 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: 'usnjrnl',
		label: '$UsnJrnl',
		fullName: 'Change Journal',
		desc: 'Records every file system operation with timestamps and reason codes.',
		convertEndpoint: '/analysis/usnjrnl/convert',
		csvFileKey: 'usn_csv',
		icon: (c) => (
			<svg viewBox="0 0 24 24" fill="none" className={c}>
				<path d="M6 4v16M10 4v16M14 4v16M18 4v16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
				<path d="M3 12h18" stroke="currentColor" strokeWidth="1.6" />
			</svg>
		),
	},
]

/* ── Main page ────────────────────────────────────────────────── */
export default function ResultsPage() {
	const [searchParams] = useSearchParams()
	const navigate = useNavigate()
	const partition = searchParams.get('partition') || ''
	const driveLetter = partition.replace(/[:\\\/]/g, '').trim().toUpperCase()

	const [extractionId, setExtractionId] = useState('')
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const autoConvertTriggered = useRef(false)

	// Per-artifact state
	const [artifacts, setArtifacts] = useState(() =>
		ARTIFACTS.reduce((acc, a) => ({
			...acc,
			[a.key]: { status: 'idle', error: '', csvInfo: null },
		}), {})
	)

	/* ── Build csvInfo from an existing CSV file entry returned by exports API ── */
	function csvInfoFromExport(fileInfo) {
		return {
			outputFile: fileInfo.path || fileInfo.relative_path,
			relativePath: fileInfo.relative_path,
			inputSizeMb: null,
			outputSizeMb: fileInfo.size_mb,
			recordsParsed: null,
			columns: null,
		}
	}

	/* ── Discover extraction + detect existing CSVs ── */
	useEffect(() => {
		let cancelled = false

		async function discover() {
			setLoading(true)
			setError('')
			try {
				const res = await fetch(`${API_BASE}/analysis/exports`)
				if (!res.ok) throw new Error(`Failed to list exports (${res.status})`)
				const data = await res.json()

				const extractions = (data?.data || [])
					.filter((e) => e.drive?.replace(':', '').toUpperCase() === driveLetter)
					.sort((a, b) => (b.created || '').localeCompare(a.created || ''))

				if (extractions.length === 0)
					throw new Error(`No extractions found for partition ${partition}`)

				const ext = extractions[0]
				if (cancelled) return

				setExtractionId(ext.id)

				// Pre-populate artifacts that already have CSVs (on disk or from sessionStorage)
				const initial = {}
				for (const a of ARTIFACTS) {
					// 1. Check sessionStorage first
					const cached = loadArtifactState(ext.id, a.key)
					if (cached?.status === 'done' && cached.csvInfo) {
						initial[a.key] = cached
						continue
					}
					// 2. Check if CSV already exists on disk (from exports API)
					const existingCsv = ext.files?.[a.csvFileKey]
					if (existingCsv) {
						const state = { status: 'done', error: '', csvInfo: csvInfoFromExport(existingCsv) }
						saveArtifactState(ext.id, a.key, state)
						initial[a.key] = state
						continue
					}
					initial[a.key] = { status: 'idle', error: '', csvInfo: null }
				}
				setArtifacts((prev) => ({ ...prev, ...initial }))
			} catch (err) {
				if (!cancelled) setError(err.message)
			} finally {
				if (!cancelled) setLoading(false)
			}
		}

		if (driveLetter) discover()
		return () => { cancelled = true }
	}, [driveLetter, partition])

	/* ── Convert a single artifact ── */
	const convertArtifact = useCallback(async (artifact) => {
		if (!extractionId) return

		setArtifacts((prev) => ({
			...prev,
			[artifact.key]: { status: 'converting', error: '', csvInfo: null },
		}))

		try {
			const res = await fetch(`${API_BASE}${artifact.convertEndpoint}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ extraction_id: extractionId }),
			})

			if (!res.ok) {
				const body = await res.json().catch(() => ({}))
				throw new Error(body.detail || `Conversion failed (${res.status})`)
			}

			const result = await res.json()
			const d = result.data || result

			const state = {
				status: 'done',
				error: '',
				csvInfo: {
					outputFile: d.output_file,
					inputSizeMb: d.input_size_mb,
					outputSizeMb: d.output_size_mb,
					recordsParsed: d.records_parsed,
					columns: d.columns,
				},
			}
			saveArtifactState(extractionId, artifact.key, state)
			setArtifacts((prev) => ({ ...prev, [artifact.key]: state }))
		} catch (err) {
			setArtifacts((prev) => ({
				...prev,
				[artifact.key]: { status: 'error', error: err.message, csvInfo: null },
			}))
		}
	}, [extractionId])

	/* ── Auto-convert all artifacts that aren't done yet ── */
	useEffect(() => {
		if (!extractionId || loading || autoConvertTriggered.current) return
		autoConvertTriggered.current = true

		ARTIFACTS.forEach((a) => {
			if (artifacts[a.key].status !== 'done') convertArtifact(a)
		})
	}, [extractionId, loading, artifacts, convertArtifact])

	const doneCount = ARTIFACTS.filter((a) => artifacts[a.key].status === 'done').length
	const convertingCount = ARTIFACTS.filter((a) => artifacts[a.key].status === 'converting').length
	const allDone = doneCount === ARTIFACTS.length

	/* ── Download URL helper ── */
	function getCsvDownloadUrl(csvInfo) {
		if (csvInfo?.relativePath) return `${API_BASE}/exports/${csvInfo.relativePath}`
		if (!csvInfo?.outputFile) return ''
		const rel = csvInfo.outputFile
			.split('exports\\').pop()
			?.split('exports/').pop()
			?.replace(/\\/g, '/')
			|| ''
		return `${API_BASE}/exports/${encodeURIComponent(rel)}`
	}

	/* ── Render ── */
	return (
		<main className="min-h-screen bg-theme-bg px-6 py-10 text-theme-fg">
			<section className="mx-auto max-w-4xl">

				{/* Breadcrumb */}
				<nav className="mb-6 flex items-center gap-2 text-xs text-theme-fg/50">
					<Link to="/partitions" className="transition hover:text-theme-accent">Partitions</Link>
					<span>/</span>
					<Link to={`/analyze?partition=${encodeURIComponent(partition)}`} className="transition hover:text-theme-accent">Extraction</Link>
					<span>/</span>
					<span className="font-medium text-theme-fg/80">Results</span>
				</nav>

				{/* ── Header panel ──────────────────────────────────── */}
				<div className="rounded-2xl border border-theme-border bg-theme-surface shadow-sm">
					<div className="flex flex-wrap items-center justify-between gap-4 border-b border-theme-border px-6 py-5">
						<div>
							<h1 className="text-xl font-bold leading-tight sm:text-2xl">Converted CSV Files</h1>
							<p className="mt-1 text-xs text-theme-fg/50">
								Partition <span className="font-mono font-semibold text-theme-accent">{partition || '—'}</span>
								{extractionId && (
									<>
										{' — ID '}
										<span className="font-mono text-theme-fg/40">{extractionId}</span>
									</>
								)}
							</p>
						</div>
						<div className="flex items-center gap-2">

							<Link
								to="/partitions"
								className="rounded-lg border border-theme-border px-3 py-1.5 text-xs font-semibold transition hover:bg-theme-accent/5"
							>
								Back
							</Link>
						</div>
					</div>

					{/* Stats row */}
					<div className="grid grid-cols-3 divide-x divide-theme-border">
						<div className="px-6 py-3.5 text-center">
							<p className="text-[11px] font-medium uppercase tracking-wider text-theme-fg/40">Total Artifacts</p>
							<p className="mt-0.5 text-2xl font-bold tabular-nums">{ARTIFACTS.length}</p>
						</div>
						<div className="px-6 py-3.5 text-center">
							<p className="text-[11px] font-medium uppercase tracking-wider text-theme-fg/40">Converted</p>
							<p className="mt-0.5 text-2xl font-bold tabular-nums text-theme-accent">{doneCount}</p>
						</div>
						<div className="px-6 py-3.5 text-center">
							<p className="text-[11px] font-medium uppercase tracking-wider text-theme-fg/40">Status</p>
							<p className={`mt-0.5 text-lg font-bold ${allDone ? 'text-theme-accent' : convertingCount > 0 ? 'text-amber-600' : 'text-theme-fg/40'}`}>
								{allDone ? 'All Done' : convertingCount > 0 ? 'Converting…' : 'Preparing…'}
							</p>
						</div>
					</div>
				</div>

				{/* ── Loading / Error ── */}
				{loading && (
					<div className="mt-6 flex flex-col items-center rounded-2xl border border-theme-border bg-theme-surface py-16">
						<div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-theme-border border-t-theme-accent" />
						<p className="text-sm text-theme-fg/50">Discovering extractions…</p>
					</div>
				)}

				{!loading && error && (
					<div className="mt-6 rounded-2xl border border-red-200 bg-red-50/80 p-6 text-center">
						<p className="font-semibold text-red-700">Error</p>
						<p className="mt-1 text-sm text-red-600/80">{error}</p>
					</div>
				)}

				{/* ── Artifact Cards ── */}
				{!loading && !error && extractionId && (
					<div className="mt-5 space-y-3">
						{ARTIFACTS.map((artifact) => {
							const state = artifacts[artifact.key]
							const { status, csvInfo } = state
							const isIdle = status === 'idle'
							const isConverting = status === 'converting'
							const isDone = status === 'done'
							const isError = status === 'error'

							return (
								<div
									key={artifact.key}
className={`rounded-2xl border bg-theme-surface shadow-sm transition-all ${
										isDone
											? 'border-theme-accent/25'
											: isConverting
												? 'border-amber-300/40'
												: isError
													? 'border-red-300/40'
													: 'border-theme-border'
									}`}
								>
									<div className="flex items-center gap-5 px-6 py-5">
										{/* Icon */}
										<div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border transition-all ${
											isDone
												? 'border-theme-accent/30 bg-theme-accent/8 text-theme-accent'
												: isConverting
													? 'border-amber-300/40 bg-amber-50 text-amber-600'
													: isError
														? 'border-red-300 bg-red-50 text-red-500'
														: 'border-theme-fg/10 bg-theme-fg/[0.03] text-theme-fg/30'
										}`}>
											{isDone ? (
												<svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
													<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
												</svg>
											) : isConverting ? (
												<svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
													<circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
													<path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
												</svg>
											) : (
												artifact.icon('h-5 w-5')
											)}
										</div>

										{/* Info */}
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												<h3 className="text-sm font-semibold">{artifact.label}</h3>
												<span className="text-xs text-theme-fg/40">{artifact.fullName}</span>
											</div>
											<p className={`mt-0.5 text-xs leading-relaxed ${
												isError ? 'text-red-500/80' : 'text-theme-fg/50'
											}`}>
												{isError ? state.error : artifact.desc}
											</p>

											{/* CSV info stats */}
											{isDone && csvInfo && (
												<div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px] text-theme-fg/45">
													<span className="inline-flex items-center gap-1">
														<svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-theme-accent/60">
															<path d="M4 1.5a.5.5 0 01.5-.5h7a.5.5 0 01.354.854L8.354 5.354A.5.5 0 008 5.707V13.5a.5.5 0 01-.854.354l-3-3A.5.5 0 014 10.5V1.5z" />
														</svg>
														{csvInfo.recordsParsed?.toLocaleString() ?? '—'} records
													</span>
													<span className="text-theme-fg/20">|</span>
													<span>{csvInfo.columns ?? '—'} columns</span>
													<span className="text-theme-fg/20">|</span>
													<span>Input: {csvInfo.inputSizeMb ?? '—'} MB</span>
													<span className="text-theme-fg/20">|</span>
													<span>CSV: {csvInfo.outputSizeMb ?? '—'} MB</span>
												</div>
											)}

											{/* Converting progress bar */}
											{isConverting && (
												<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-amber-100/60">
													<div className="h-full w-full origin-left animate-pulse rounded-full bg-amber-400/50" />
												</div>
											)}
										</div>

										{/* Actions */}
										<div className="flex shrink-0 items-center gap-2">
											{isIdle && (
												<span className="flex items-center gap-1.5 rounded-lg bg-theme-fg/5 px-3 py-2 text-xs font-semibold text-theme-fg/40">
													Waiting…
												</span>
											)}

											{isConverting && (
												<span className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
													<span className="relative flex h-1.5 w-1.5">
														<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-50" />
														<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
													</span>
													Converting…
												</span>
											)}

											{isError && (
												<button
													onClick={() => convertArtifact(artifact)}
													className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100"
												>
													Retry
												</button>
											)}

											{isDone && (
												<div className="flex items-center gap-2">
													{/* Download CSV */}
													<a
														href={getCsvDownloadUrl(csvInfo)}
														download
														className="inline-flex items-center gap-1.5 rounded-lg border border-theme-border px-3 py-2 text-xs font-semibold text-theme-accent transition hover:bg-theme-accent/5"
													>
														<svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
															<path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
														</svg>
														Download .csv
													</a>

													{/* View CSV */}
													<button
														onClick={() => navigate(
															`/viewcsv?partition=${encodeURIComponent(partition)}&type=${artifact.key}&extraction_id=${encodeURIComponent(extractionId)}`
														)}
														className="inline-flex items-center gap-1.5 rounded-lg bg-theme-accent px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
													>
														<svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
															<path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
															<path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
														</svg>
														View CSV
													</button>
												</div>
											)}
										</div>
									</div>
								</div>
							)
						})}
					</div>
				)}

				{/* ── Info footer ── */}
				{!loading && !error && extractionId && (
					<div className="mt-4 rounded-2xl border border-theme-border bg-theme-surface/80 px-6 py-4">
						<p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-theme-fg/40">How it works</p>
						<div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-theme-fg/50">
							<span className="flex items-center gap-1.5">
								<span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-theme-accent/10 text-[10px] font-bold text-theme-accent">1</span>
								Conversion runs <strong className="ml-0.5">automatically</strong> on page load
							</span>
							<span className="flex items-center gap-1.5">
								<span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-theme-accent/10 text-[10px] font-bold text-theme-accent">2</span>
								<strong>Download</strong> the .csv file to your machine
							</span>
							<span className="flex items-center gap-1.5">
								<span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-theme-accent/10 text-[10px] font-bold text-theme-accent">3</span>
								<strong>View CSV</strong> to inspect data in the browser
							</span>
						</div>
					</div>
				)}

			</section>
		</main>
	)
}
