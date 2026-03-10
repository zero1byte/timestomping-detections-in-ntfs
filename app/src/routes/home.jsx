import { Link } from 'react-router-dom'

export default function HomePage() {
	return (
		<main className="min-h-screen bg-theme-bg text-theme-fg">
			<section className="mx-auto max-w-6xl px-6 py-12">
				<div className="rounded-3xl border border-theme-accent/25 bg-theme-bg/85 p-8 shadow-md backdrop-blur-sm">
					<p className="mb-3 inline-block rounded-full bg-theme-accent/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-theme-accent">
						NTFS Timeline Integrity
					</p>
					<h1 className="text-3xl font-bold leading-tight sm:text-4xl">
						Time Stomping Detection in NTFS
					</h1>
					<p className="mt-4 max-w-3xl text-sm leading-7 sm:text-base">
						Time stomping is an anti-forensics technique where an attacker modifies file timestamps to hide activity.
						This project detects timestamp tampering by correlating evidence across multiple NTFS sources instead of
						trusting one artifact alone.
					</p>
					<div className="mt-6">
						<Link
							to="/partitions"
							className="inline-flex items-center rounded-lg bg-theme-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
						>
							Start Live Detection
						</Link>
					</div>
				</div>

				<div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
					  <article className="rounded-2xl border border-theme-accent/20 bg-theme-bg/90 p-5">
						<h2 className="text-base font-semibold">$MFT - $SI</h2>
						<p className="mt-2 text-sm leading-6">
							$STANDARD_INFORMATION stores core file timestamps. Attackers often modify $SI first, so it is useful but
							cannot be treated as a single source of truth.
						</p>
					</article>

					  <article className="rounded-2xl border border-theme-accent/20 bg-theme-bg/90 p-5">
						<h2 className="text-base font-semibold">$MFT - $FN</h2>
						<p className="mt-2 text-sm leading-6">
							$FILE_NAME also keeps timestamp values. A mismatch between $SI and $FN is a common timestomping signal,
							especially when only one set appears altered.
						</p>
					</article>

					  <article className="rounded-2xl border border-theme-accent/20 bg-theme-bg/90 p-5">
						<h2 className="text-base font-semibold">$USN Journal</h2>
						<p className="mt-2 text-sm leading-6">
							The USN Journal records file change events over time. If journal activity conflicts with claimed file
							times, it helps expose timeline manipulation.
						</p>
					</article>

					  <article className="rounded-2xl border border-theme-accent/20 bg-theme-bg/90 p-5">
						<h2 className="text-base font-semibold">$LogFile</h2>
						<p className="mt-2 text-sm leading-6">
							$LogFile captures NTFS transaction behavior. Correlating transaction sequence with $MFT and USN history
							strengthens confidence when flagging suspicious timestamp edits.
						</p>
					</article>
				</div>

				<section className="mt-8 rounded-3xl border border-theme-accent/25 bg-theme-bg/92 p-8">
					<h2 className="text-2xl font-semibold">How To Use This Tool</h2>
					<ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7 sm:text-base">
						<li>Select the target drive and extract NTFS artifacts ($MFT, $USN Journal, $LogFile).</li>
						<li>Convert extracted artifacts to CSV for parsing and cross-source analysis.</li>
						<li>Run detection to compare $SI vs $FN and validate against USN + LogFile timelines.</li>
						<li>Review flagged entries and prioritize files with multi-artifact inconsistencies.</li>
					</ol>
					<p className="mt-4 rounded-xl bg-theme-accent/10 p-4 text-sm leading-6">
						Interpretation tip: one mismatch can be noise, but repeated mismatches across multiple artifacts are a
						stronger timestomping indicator.
					</p>
				</section>
			</section>
		</main>
	)
}
