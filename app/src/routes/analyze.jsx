import { Link, useSearchParams } from 'react-router-dom'

export default function AnalyzePage() {
	const [searchParams] = useSearchParams()
	const partition = searchParams.get('partition') || ''

	return (
		<main className="min-h-screen bg-theme-bg px-6 py-10 text-theme-fg">
			<div>
				<div>
					Extracting $MFT data for partition <span className="font-mono font-bold">{partition}</span>...
				</div>
			</div>
		</main>
	)
}
