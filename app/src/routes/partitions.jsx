import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000'

function formatGb(value) {
	if (value === null || value === undefined) return 'N/A'
	return `${Number(value).toFixed(2)} GB`
}

function usagePercent(total, free) {
	if (!total || total <= 0) return 0
	const used = total - (free ?? 0)
	return Math.min(100, Math.max(0, (used / total) * 100))
}

function DriveIcon({ selected }) {
	return (
		<svg viewBox="0 0 24 24" fill="none" className={`h-7 w-7 transition ${selected ? 'text-white' : 'text-theme-accent'}`}>
			<rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
			<path d="M3 15h18" stroke="currentColor" strokeWidth="1.8" />
			<circle cx="17" cy="18" r="1" fill="currentColor" />
			<path d="M7 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M7 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}

function CheckIcon() {
	return (
		<svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
			<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
		</svg>
	)
}

export default function PartitionsPage() {
	const navigate = useNavigate()
	const [drives, setDrives] = useState([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [isLiveMode, setIsLiveMode] = useState(false)
	const [selectedPartition, setSelectedPartition] = useState('')

	const buildPartitionIdentifier = (partition) => {
		if (partition?.drive) return String(partition.drive).trim()
		if (partition?.mountpoint) return String(partition.mountpoint).trim()
		return ''
	}

	const goToAnalyze = () => {
		if (!selectedPartition) return
		navigate(`/analyze?partition=${encodeURIComponent(selectedPartition)}`)
	}

	const fetchPartitions = async () => {
		setLoading(true)
		setError('')
		try {
			const res = await fetch(`${API_BASE}/drives/`)
			if (!res.ok) throw new Error(`Request failed (${res.status})`)
			const data = await res.json()
			setDrives(Array.isArray(data?.drives) ? data.drives : [])
		} catch (err) {
			setError(err.message || 'Could not load partitions')
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchPartitions()
	}, [])

	useEffect(() => {
		if (!isLiveMode) return
		const timer = setInterval(() => {
			fetchPartitions()
		}, 5000)
		return () => clearInterval(timer)
	}, [isLiveMode])

	const driveCount = useMemo(() => drives.length, [drives])

	return (
		<main className="min-h-screen bg-theme-bg px-6 py-10 text-theme-fg">
			<section className="mx-auto max-w-6xl">
				{/* Header card */}
				<div className="mb-8 rounded-3xl border border-theme-accent/25 bg-theme-bg/85 p-8 shadow-md backdrop-blur-sm">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div>
							<p className="mb-3 inline-block rounded-full bg-theme-accent/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-theme-accent">
								NTFS Partitions
							</p>
							<h1 className="text-3xl font-bold leading-tight sm:text-4xl">Select a Partition</h1>
							<p className="mt-2 max-w-xl text-sm leading-6 text-theme-fg/70">
								Choose an NTFS partition to extract and analyze for timestomping artifacts. Click a partition card below, then proceed to analysis.
							</p>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => setIsLiveMode((prev) => !prev)}
								className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
									isLiveMode
										? 'bg-red-500/90 text-white hover:bg-red-500'
										: 'bg-theme-accent text-white hover:opacity-90'
								}`}
							>
								<span className="flex items-center gap-2">
									{isLiveMode && <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-white" /></span>}
									{isLiveMode ? 'Stop Live' : 'Start Live'}
								</span>
							</button>
							<button
								type="button"
								onClick={fetchPartitions}
								className="rounded-xl border border-theme-accent/30 bg-theme-bg/80 px-4 py-2.5 text-sm font-semibold text-theme-fg transition hover:bg-theme-accent/10"
							>
								<span className="flex items-center gap-1.5">
									<svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" /></svg>
									Refresh
								</span>
							</button>
						</div>
					</div>

					{/* Status bar */}
					<div className="mt-6 flex flex-wrap items-center gap-3">
						<span className="rounded-xl bg-theme-accent/10 px-3 py-1.5 text-xs font-semibold">
							{driveCount} partition{driveCount !== 1 ? 's' : ''} found
						</span>
						<span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold ${isLiveMode ? 'bg-green-100 text-green-700' : 'bg-theme-fg/5 text-theme-fg/50'}`}>
							<span className={`h-1.5 w-1.5 rounded-full ${isLiveMode ? 'bg-green-500' : 'bg-theme-fg/30'}`} />
							{isLiveMode ? 'Live monitoring (5s)' : 'Live off'}
						</span>
						{selectedPartition && (
							<span className="inline-flex items-center gap-1.5 rounded-xl bg-theme-accent/15 px-3 py-1.5 text-xs font-semibold text-theme-accent">
								<CheckIcon /> {selectedPartition}
							</span>
						)}
					</div>
				</div>

				{/* Loading state */}
				{loading && (
					<div className="flex flex-col items-center justify-center rounded-3xl border border-theme-accent/20 bg-theme-bg/85 py-16 backdrop-blur-sm">
						<div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-theme-accent/20 border-t-theme-accent" />
						<p className="text-sm text-theme-fg/60">Scanning partitions…</p>
					</div>
				)}

				{/* Error state */}
				{!loading && error && (
					<div className="rounded-3xl border border-red-300/50 bg-red-50/80 p-8 text-center backdrop-blur-sm">
						<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
							<svg viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6 text-red-500"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
						</div>
						<p className="font-semibold text-red-700">Failed to fetch partitions</p>
						<p className="mt-1 text-sm text-red-600/80">{error}</p>
						<button onClick={fetchPartitions} className="mt-4 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600">
							Try Again
						</button>
					</div>
				)}

				{/* Empty state */}
				{!loading && !error && drives.length === 0 && (
					<div className="rounded-3xl border border-theme-accent/20 bg-theme-bg/85 py-16 text-center backdrop-blur-sm">
						<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-theme-accent/10">
							<svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-theme-accent"><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" /><path d="M3 15h18" stroke="currentColor" strokeWidth="1.8" /><circle cx="17" cy="18" r="1" fill="currentColor" /></svg>
						</div>
						<p className="font-semibold">No NTFS partitions detected</p>
						<p className="mt-1 text-sm text-theme-fg/60">Make sure the backend is running and the system has NTFS volumes.</p>
					</div>
				)}

				{/* Partition cards grid */}
				{!loading && !error && drives.length > 0 && (
					<>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{drives.map((item, index) => {
								const partitionId = buildPartitionIdentifier(item)
								const isSelected = selectedPartition === partitionId
								const pct = usagePercent(item.total_gb, item.free_gb)
								const usedGb = item.total_gb != null && item.free_gb != null
									? (item.total_gb - item.free_gb)
									: null

								return (
									<button
										key={`${item.drive}-${index}`}
										type="button"
										onClick={() => setSelectedPartition(partitionId)}
										className={`group relative rounded-2xl border-2 p-5 text-left transition-all duration-200 ${
											isSelected
												? 'border-theme-accent bg-theme-accent shadow-lg shadow-theme-accent/15 text-white scale-[1.02]'
												: 'border-theme-accent/20 bg-theme-bg/90 hover:border-theme-accent/40 hover:shadow-md'
										}`}
									>
										{/* Selection indicator */}
										{isSelected && (
											<span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-white/25">
												<CheckIcon />
											</span>
										)}

										{/* Drive header */}
										<div className="flex items-center gap-3">
											<div className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
												isSelected ? 'bg-white/20' : 'bg-theme-accent/10'
											}`}>
												<DriveIcon selected={isSelected} />
											</div>
											<div>
												<h3 className="text-lg font-bold leading-tight">{item.drive || 'Unknown'}</h3>
												<p className={`text-xs ${isSelected ? 'text-white/70' : 'text-theme-fg/50'}`}>
													{item.mountpoint || 'No mountpoint'}
												</p>
											</div>
										</div>

										{/* Filesystem badge */}
										<div className="mt-4">
											<span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
												isSelected ? 'bg-white/20 text-white' : 'bg-theme-accent/10 text-theme-accent'
											}`}>
												{item.fstype || 'N/A'}
											</span>
										</div>

										{/* Storage bar */}
										<div className="mt-4">
											<div className="flex items-baseline justify-between text-xs">
												<span className={isSelected ? 'text-white/70' : 'text-theme-fg/50'}>Storage</span>
												<span className="font-semibold">{formatGb(item.total_gb)}</span>
											</div>
											<div className={`mt-1.5 h-2 overflow-hidden rounded-full ${isSelected ? 'bg-white/20' : 'bg-theme-accent/10'}`}>
												<div
													className={`h-full rounded-full transition-all duration-500 ${
														isSelected ? 'bg-white/70' : pct > 85 ? 'bg-red-400' : 'bg-theme-accent/60'
													}`}
													style={{ width: `${pct}%` }}
												/>
											</div>
											<div className="mt-1.5 flex justify-between text-[11px]">
												<span className={isSelected ? 'text-white/60' : 'text-theme-fg/40'}>
													{usedGb != null ? `${usedGb.toFixed(1)} GB used` : '—'}
												</span>
												<span className={isSelected ? 'text-white/60' : 'text-theme-fg/40'}>
													{formatGb(item.free_gb)} free
												</span>
											</div>
										</div>
									</button>
								)
							})}
						</div>

						{/* Analyze CTA */}
						<div className="mt-8 flex flex-col items-center rounded-3xl border border-theme-accent/20 bg-theme-bg/85 px-6 py-8 backdrop-blur-sm">
							{selectedPartition ? (
								<>
									<p className="mb-4 text-sm text-theme-fg/70">
										Ready to analyze <span className="font-bold text-theme-accent">{selectedPartition}</span>
									</p>
									<button
										type="button"
										onClick={goToAnalyze}
										className="inline-flex items-center gap-2 rounded-xl bg-theme-accent px-6 py-3 text-sm font-semibold text-white shadow-md shadow-theme-accent/20 transition hover:opacity-90 hover:shadow-lg"
									>
										Continue to Analysis
										<svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
									</button>
								</>
							) : (
								<p className="text-sm text-theme-fg/50">Select a partition above to continue</p>
							)}
						</div>
					</>
				)}
			</section>
		</main>
	)
}
