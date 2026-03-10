import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'

const ARTIFACTS = [
	{ key: 'mft', label: '$MFT', desc: 'Master File Table — file metadata & timestamps' },
	{ key: 'usnjrnl', label: '$UsnJrnl', desc: 'USN Journal — file change event log' },
	{ key: 'logfile', label: '$LogFile', desc: 'NTFS transaction log entries' },
]

function PulseRing() {
	return (
		<span className="relative flex h-3 w-3">
			<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-theme-accent opacity-40" />
			<span className="relative inline-flex h-3 w-3 rounded-full bg-theme-accent" />
		</span>
	)
}

function SpinnerIcon({ className = '' }) {
	return (
		<svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
			<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
			<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
		</svg>
	)
}

function CheckIcon({ className = '' }) {
	return (
		<svg className={className} viewBox="0 0 20 20" fill="currentColor">
			<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
		</svg>
	)
}

function DriveIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-theme-accent">
			<rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
			<path d="M3 15h18" stroke="currentColor" strokeWidth="1.8" />
			<circle cx="17" cy="18" r="1" fill="currentColor" />
			<path d="M7 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M7 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}

export default function AnalyzePage() {
	const [searchParams] = useSearchParams()
	const partition = searchParams.get('partition') || ''

	// Simulated extraction progress per artifact
	const [progress, setProgress] = useState(() =>
		ARTIFACTS.reduce((acc, a) => ({ ...acc, [a.key]: { status: 'pending', pct: 0 } }), {})
	)

	useEffect(() => {
		let cancelled = false

		async function runSequence() {
			for (const artifact of ARTIFACTS) {
				if (cancelled) return
				// Mark as extracting
				setProgress((prev) => ({
					...prev,
					[artifact.key]: { status: 'extracting', pct: 0 },
				}))

				// Animate progress 0→100
				const steps = 20
				for (let i = 1; i <= steps; i++) {
					if (cancelled) return
					await new Promise((r) => setTimeout(r, 120))
					setProgress((prev) => ({
						...prev,
						[artifact.key]: { status: 'extracting', pct: Math.round((i / steps) * 100) },
					}))
				}

				// Mark done
				setProgress((prev) => ({
					...prev,
					[artifact.key]: { status: 'done', pct: 100 },
				}))
			}
		}

		runSequence()
		return () => { cancelled = true }
	}, [partition])

	const allDone = ARTIFACTS.every((a) => progress[a.key]?.status === 'done')
	const currentIdx = ARTIFACTS.findIndex((a) => progress[a.key]?.status === 'extracting')
	const overallPct = Math.round(
		ARTIFACTS.reduce((sum, a) => sum + (progress[a.key]?.pct || 0), 0) / ARTIFACTS.length
	)

	return (
		<main className="min-h-screen bg-theme-bg px-6 py-10 text-theme-fg">
			<section className="mx-auto max-w-3xl">
				{/* Header card */}
				<div className="rounded-3xl border border-theme-accent/25 bg-theme-bg/85 p-8 shadow-md backdrop-blur-sm">
					<div className="flex items-center gap-4">
						<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-theme-accent/10">
							{allDone ? (
								<CheckIcon className="h-8 w-8 text-green-500" />
							) : (
								<DriveIcon />
							)}
						</div>
						<div className="flex-1">
							<p className="mb-1 inline-block rounded-full bg-theme-accent/15 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-theme-accent">
								{allDone ? 'Extraction Complete' : 'Live Extraction'}
							</p>
							<h1 className="text-2xl font-bold leading-tight sm:text-3xl">
								{allDone ? 'Artifacts Ready' : 'Extracting NTFS Artifacts'}
							</h1>
							<p className="mt-1 text-sm text-theme-fg/60">
								Partition <span className="font-mono font-bold text-theme-accent">{partition || '—'}</span>
							</p>
						</div>
					</div>

					{/* Overall progress */}
					{!allDone && (
						<div className="mt-6">
							<div className="flex items-center justify-between text-xs text-theme-fg/60">
								<span className="flex items-center gap-2">
									<PulseRing />
									Extracting from live partition…
								</span>
								<span className="font-semibold text-theme-fg">{overallPct}%</span>
							</div>
							<div className="mt-2 h-2.5 overflow-hidden rounded-full bg-theme-accent/10">
								<div
									className="h-full rounded-full bg-theme-accent transition-all duration-300 ease-out"
									style={{ width: `${overallPct}%` }}
								/>
							</div>
						</div>
					)}
				</div>

				{/* Artifact cards */}
				<div className="mt-6 space-y-4">
					{ARTIFACTS.map((artifact, idx) => {
						const { status, pct } = progress[artifact.key] || {}
						const isPending = status === 'pending'
						const isExtracting = status === 'extracting'
						const isDone = status === 'done'

						return (
							<div
								key={artifact.key}
								className={`rounded-2xl border-2 p-5 transition-all duration-300 ${
									isExtracting
										? 'border-theme-accent bg-theme-accent/5 shadow-md shadow-theme-accent/10'
										: isDone
											? 'border-green-400/40 bg-green-50/50'
											: 'border-theme-accent/10 bg-theme-bg/80 opacity-50'
								}`}
							>
								<div className="flex items-center gap-4">
									{/* Status icon */}
									<div className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${
										isDone
											? 'bg-green-100 text-green-600'
											: isExtracting
												? 'bg-theme-accent/15 text-theme-accent'
												: 'bg-theme-fg/5 text-theme-fg/30'
									}`}>
										{isDone && <CheckIcon className="h-5 w-5" />}
										{isExtracting && <SpinnerIcon className="h-5 w-5 text-theme-accent" />}
										{isPending && <span className="text-sm font-bold">{idx + 1}</span>}
									</div>

									{/* Info */}
									<div className="flex-1">
										<div className="flex items-baseline gap-2">
											<h3 className="font-bold">{artifact.label}</h3>
											{isDone && <span className="text-xs font-semibold text-green-600">Complete</span>}
											{isExtracting && <span className="text-xs font-semibold text-theme-accent">Extracting…</span>}
											{isPending && <span className="text-xs text-theme-fg/40">Waiting</span>}
										</div>
										<p className={`mt-0.5 text-xs ${isDone ? 'text-green-700/60' : isExtracting ? 'text-theme-fg/60' : 'text-theme-fg/30'}`}>
											{artifact.desc}
										</p>
									</div>

									{/* Percentage */}
									{isExtracting && (
										<span className="text-lg font-bold tabular-nums text-theme-accent">{pct}%</span>
									)}
								</div>

								{/* Progress bar for active artifact */}
								{isExtracting && (
									<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-theme-accent/10">
										<div
											className="h-full rounded-full bg-theme-accent transition-all duration-150 ease-out"
											style={{ width: `${pct}%` }}
										/>
									</div>
								)}
							</div>
						)
					})}
				</div>

				{/* Completion CTA */}
				{allDone && (
					<div className="mt-8 flex flex-col items-center rounded-3xl border border-green-400/30 bg-green-50/60 px-6 py-8 text-center backdrop-blur-sm">
						<div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
							<CheckIcon className="h-7 w-7 text-green-600" />
						</div>
						<h2 className="text-lg font-bold text-green-800">All Artifacts Extracted</h2>
						<p className="mt-1 text-sm text-green-700/70">
							$MFT, $UsnJrnl and $LogFile have been extracted from <span className="font-mono font-bold">{partition}</span>.
						</p>
						<Link
							to={`/analyze/results?partition=${encodeURIComponent(partition)}`}
							className="mt-5 inline-flex items-center gap-2 rounded-xl bg-theme-accent px-6 py-3 text-sm font-semibold text-white shadow-md shadow-theme-accent/20 transition hover:opacity-90"
						>
							View Analysis Results
							<svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
						</Link>
					</div>
				)}
			</section>
		</main>
	)
}
