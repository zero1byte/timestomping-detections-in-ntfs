import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000'

const ARTIFACTS = [
	{
		key: 'mft',
		label: '$MFT',
		fullName: 'Master File Table',
		desc: 'Core metadata store — every file & directory entry with $SI and $FN timestamps.',
		endpoint: '/extract/extract-mft',
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
		endpoint: '/extract/extract-logfile',
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
		fullName: 'Update Sequence Number Journal',
		desc: 'Change journal — records every file system operation with reason codes.',
		endpoint: '/extract/extract-usnjrnl',
		icon: (c) => (
			<svg viewBox="0 0 24 24" fill="none" className={c}>
				<path d="M6 4v16M10 4v16M14 4v16M18 4v16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
				<path d="M3 12h18" stroke="currentColor" strokeWidth="1.6" />
			</svg>
		),
	},
]

function formatElapsed(seconds) {
	if (seconds < 60) return `${seconds}s`
	const m = Math.floor(seconds / 60)
	const s = seconds % 60
	return `${m}m ${s}s`
}

function formatBytes(bytes) {
	if (!bytes || bytes === 0) return '0 B'
	const units = ['B', 'KB', 'MB', 'GB']
	let i = 0
	let val = bytes
	while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
	return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`
}

export default function AnalyzePage() {
	const [searchParams] = useSearchParams()
	const partition = searchParams.get('partition') || ''
	const driveLetter = partition.replace(/[:\\\/]/g, '').trim().toUpperCase()

	const [progress, setProgress] = useState(() =>
		ARTIFACTS.reduce((acc, a) => ({
			...acc,
			[a.key]: { status: 'pending', error: '', result: null },
		}), {})
	)
	const [elapsed, setElapsed] = useState(0)
	const timerRef = useRef(null)
	const cancelledRef = useRef(false)

	// Elapsed timer
	useEffect(() => {
		timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
		return () => clearInterval(timerRef.current)
	}, [])

	// Sequential extraction using real API
	useEffect(() => {
		cancelledRef.current = false

		async function extractAll() {
			for (const artifact of ARTIFACTS) {
				if (cancelledRef.current) return

				setProgress((prev) => ({
					...prev,
					[artifact.key]: { status: 'extracting', error: '', result: null },
				}))

				try {
					const res = await fetch(`${API_BASE}${artifact.endpoint}`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ drive: driveLetter }),
					})

					if (!res.ok) {
						const body = await res.json().catch(() => ({}))
						throw new Error(body.detail || `HTTP ${res.status}`)
					}

					const data = await res.json()

					if (cancelledRef.current) return
					setProgress((prev) => ({
						...prev,
						[artifact.key]: { status: 'done', error: '', result: data },
					}))
				} catch (err) {
					if (cancelledRef.current) return
					setProgress((prev) => ({
						...prev,
						[artifact.key]: { status: 'error', error: err.message, result: null },
					}))
				}
			}

			// Stop timer
			if (timerRef.current) clearInterval(timerRef.current)
		}

		extractAll()
		return () => { cancelledRef.current = true }
	}, [driveLetter])

	const allDone = ARTIFACTS.every((a) => {
		const s = progress[a.key]?.status
		return s === 'done' || s === 'error'
	})
	const successCount = ARTIFACTS.filter((a) => progress[a.key]?.status === 'done').length
	const errorCount = ARTIFACTS.filter((a) => progress[a.key]?.status === 'error').length
	const extractingKey = ARTIFACTS.find((a) => progress[a.key]?.status === 'extracting')?.key

	// Retry a single artifact
	const retryArtifact = useCallback(async (artifact) => {
		setProgress((prev) => ({
			...prev,
			[artifact.key]: { status: 'extracting', error: '', result: null },
		}))
		try {
			const res = await fetch(`${API_BASE}${artifact.endpoint}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ drive: driveLetter }),
			})
			if (!res.ok) {
				const body = await res.json().catch(() => ({}))
				throw new Error(body.detail || `HTTP ${res.status}`)
			}
			const data = await res.json()
			setProgress((prev) => ({
				...prev,
				[artifact.key]: { status: 'done', error: '', result: data },
			}))
		} catch (err) {
			setProgress((prev) => ({
				...prev,
				[artifact.key]: { status: 'error', error: err.message, result: null },
			}))
		}
	}, [driveLetter])

	return (
		<main className="min-h-screen bg-theme-bg px-6 py-10 text-theme-fg">
			<section className="mx-auto max-w-4xl">

				{/* Breadcrumb */}
				<nav className="mb-6 flex items-center gap-2 text-xs text-theme-fg/50">
					<Link to="/partitions" className="transition hover:text-theme-accent">Partitions</Link>
					<span>/</span>
					<span className="font-medium text-theme-fg/80">Extraction</span>
				</nav>

				{/* ── Top panel ─────────────────────────────────────── */}
				<div className="rounded-2xl border border-theme-accent/15 bg-white/50 shadow-sm backdrop-blur">
					{/* Header bar */}
					<div className="flex items-center justify-between border-b border-theme-accent/10 px-6 py-4">
						<div className="flex items-center gap-3">
							{allDone ? (
								<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-theme-accent/10">
									<svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-theme-accent">
										<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
									</svg>
								</span>
							) : (
								<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-theme-accent/10">
									<svg className="h-4 w-4 animate-spin text-theme-accent" viewBox="0 0 24 24" fill="none">
										<circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
										<path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
									</svg>
								</span>
							)}
							<div>
								<h1 className="text-base font-semibold leading-tight">
									{allDone ? 'Extraction Complete' : 'Extracting NTFS Artifacts'}
								</h1>
								<p className="text-xs text-theme-fg/50">
									Drive <span className="font-mono font-semibold text-theme-accent">{partition || '—'}</span>
								</p>
							</div>
						</div>

						<div className="flex items-center gap-4 text-xs text-theme-fg/50">
							<span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span>
							<span className={`rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${
								allDone
									? errorCount > 0
										? 'bg-red-100/80 text-red-600'
										: 'bg-theme-accent/10 text-theme-accent'
									: 'bg-amber-100/80 text-amber-700'
							}`}>
								{allDone ? (errorCount > 0 ? `${errorCount} Failed` : 'Done') : 'In Progress'}
							</span>
						</div>
					</div>

					{/* Progress shimmer while extracting */}
					{!allDone && (
						<div className="h-1 overflow-hidden bg-theme-accent/5">
							<div className="h-full w-1/3 animate-pulse rounded-full bg-theme-accent/40" style={{
								animation: 'shimmer 1.5s ease-in-out infinite',
							}} />
							<style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
						</div>
					)}

					{/* Stats row */}
					<div className="grid grid-cols-3 divide-x divide-theme-accent/10 border-b border-theme-accent/10">
						<div className="px-6 py-3.5 text-center">
							<p className="text-[11px] font-medium uppercase tracking-wider text-theme-fg/40">Artifacts</p>
							<p className="mt-0.5 text-lg font-bold tabular-nums">
								{successCount}<span className="text-theme-fg/30">/{ARTIFACTS.length}</span>
							</p>
						</div>
						<div className="px-6 py-3.5 text-center">
							<p className="text-[11px] font-medium uppercase tracking-wider text-theme-fg/40">Status</p>
							<p className="mt-0.5 text-lg font-bold tabular-nums text-theme-accent">
								{allDone ? 'Complete' : extractingKey ? ARTIFACTS.find(a => a.key === extractingKey)?.label : '…'}
							</p>
						</div>
						<div className="px-6 py-3.5 text-center">
							<p className="text-[11px] font-medium uppercase tracking-wider text-theme-fg/40">Elapsed</p>
							<p className="mt-0.5 text-lg font-bold tabular-nums">{formatElapsed(elapsed)}</p>
						</div>
					</div>

					{/* ── Artifact rows ─────────────────────────────── */}
					<div className="divide-y divide-theme-accent/8">
						{ARTIFACTS.map((artifact, idx) => {
							const state = progress[artifact.key] || {}
							const { status, error, result } = state
							const isPending = status === 'pending'
							const isExtracting = status === 'extracting'
							const isDone = status === 'done'
							const isError = status === 'error'

							return (
								<div key={artifact.key}>
									<div className={`flex items-center gap-5 px-6 py-5 transition-colors duration-300 ${
										isExtracting ? 'bg-theme-accent/[0.03]' : ''
									}`}>
										{/* Step icon */}
										<div className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all duration-300 ${
											isDone
												? 'border-theme-accent/30 bg-theme-accent/8 text-theme-accent'
												: isError
													? 'border-red-300 bg-red-50 text-red-500'
													: isExtracting
														? 'border-theme-accent/30 bg-theme-accent/8 text-theme-accent'
														: 'border-theme-fg/10 bg-theme-fg/[0.02] text-theme-fg/25'
										}`}>
											{isDone ? (
												<svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
													<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
												</svg>
											) : isError ? (
												<svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
													<path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
												</svg>
											) : isExtracting ? (
												<>
													{artifact.icon('h-5 w-5')}
													<span className="absolute -inset-0.5 animate-ping rounded-xl border border-theme-accent/20" style={{ animationDuration: '2s' }} />
												</>
											) : (
												<span className="text-sm font-bold">{idx + 1}</span>
											)}
										</div>

										{/* Info */}
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												<h3 className={`text-sm font-semibold ${isPending ? 'text-theme-fg/35' : ''}`}>
													{artifact.label}
												</h3>
												<span className={`text-xs ${isPending ? 'text-theme-fg/20' : 'text-theme-fg/40'}`}>
													{artifact.fullName}
												</span>
											</div>
											<p className={`mt-0.5 text-xs leading-relaxed ${
												isDone ? 'text-theme-fg/50' : isExtracting ? 'text-theme-fg/55' : isError ? 'text-red-500/70' : 'text-theme-fg/25'
											}`}>
												{isError ? error : artifact.desc}
											</p>

											{/* Extracting shimmer bar */}
											{isExtracting && (
												<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-theme-accent/10">
													<div className="h-full w-full origin-left animate-pulse rounded-full bg-theme-accent/30" />
												</div>
											)}


										</div>

										{/* Right side */}
										<div className="flex shrink-0 items-center gap-2">
											{isDone && (
												<span className="rounded-md bg-theme-accent/10 px-2 py-1 text-[11px] font-bold text-theme-accent">
													Extracted
												</span>
											)}
											{isExtracting && (
												<span className="flex items-center gap-1.5 rounded-md bg-theme-accent/10 px-2 py-1 text-[11px] font-bold text-theme-accent">
													<span className="relative flex h-1.5 w-1.5">
														<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-theme-accent opacity-50" />
														<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-theme-accent" />
													</span>
													Reading
												</span>
											)}
											{isError && (
												<button
													onClick={() => retryArtifact(artifact)}
													className="rounded-md bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600 transition hover:bg-red-100"
												>
													Retry
												</button>
											)}
											{isPending && (
												<span className="rounded-md bg-theme-fg/5 px-2 py-1 text-[11px] font-medium text-theme-fg/30">
													Queued
												</span>
											)}
										</div>
									</div>
								</div>
							)
						})}
					</div>
				</div>

				{/* ── Exported files summary ────────────────────────── */}
				{allDone && successCount > 0 && (
					<div className="mt-4 rounded-2xl border border-theme-accent/15 bg-white/50 shadow-sm backdrop-blur">
						<div className="border-b border-theme-accent/10 px-6 py-3.5">
							<h2 className="text-sm font-semibold">Exported Files</h2>
							<p className="text-[11px] text-theme-fg/40">Files are stored on the server at the paths shown below</p>
						</div>
						<div className="divide-y divide-theme-accent/8">
							{ARTIFACTS.map((artifact) => {
								const state = progress[artifact.key] || {}
								if (state.status !== 'done' || !state.result) return null
								const r = state.result
								const relativePath = r.output_file
									?.split('exports\\').pop()
									?.split('exports/').pop()
									?.replace(/\\/g, '/')
									|| ''

								return (
									<div key={artifact.key} className="flex items-center gap-4 px-6 py-3.5">
										<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-theme-accent/8 text-theme-accent">
											{artifact.icon('h-4 w-4')}
										</div>
										<div className="flex-1 min-w-0">
											<p className="text-xs font-semibold">{artifact.label}</p>
											<p className="mt-0.5 truncate font-mono text-[11px] text-theme-fg/45" title={r.output_file}>
												{r.output_file}
											</p>
										</div>
										<div className="flex shrink-0 items-center gap-3 text-[11px]">
											<span className="tabular-nums text-theme-fg/40">{formatBytes(r.bytes_extracted)}</span>
											<a
												href={`${API_BASE}/exports/${encodeURIComponent(relativePath)}`}
												download
												className="inline-flex items-center gap-1 rounded-lg border border-theme-accent/20 px-2.5 py-1.5 font-semibold text-theme-accent transition hover:bg-theme-accent/5"
											>
												<svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
													<path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
												</svg>
												Download .bin
											</a>
										</div>
									</div>
								)
							})}
						</div>
					</div>
				)}

				{/* ── Completion CTA ────────────────────────────────── */}
				{allDone && (
					<div className="mt-4 rounded-2xl border border-theme-accent/15 bg-white/50 p-6 shadow-sm backdrop-blur">
						<div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex items-center gap-3">
								<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-theme-accent/10">
									<svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-theme-accent">
										<path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
									</svg>
								</span>
								<div>
									<p className="text-sm font-semibold">
										{successCount === ARTIFACTS.length
											? 'All 3 artifacts extracted successfully'
											: `${successCount} of ${ARTIFACTS.length} artifacts extracted`
										}
									</p>
									<p className="text-xs text-theme-fg/50">
										{partition} — completed in {formatElapsed(elapsed)}
									</p>
								</div>
							</div>
							<Link
								to={`/results?partition=${encodeURIComponent(partition)}`}
								className="inline-flex items-center gap-2 rounded-xl bg-theme-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
							>
								View Analysis
								<svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
									<path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
								</svg>
							</Link>
						</div>
					</div>
				)}

			</section>
		</main>
	)
}
