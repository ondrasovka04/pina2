import { useEffect, useState } from 'react'

import { ClubMark } from '@/components/ClubMark'
import { cn } from '@/lib/cn'

/** Nahraný znak družstva; bez něj se kreslí klubový `ClubMark`. */
export function TeamLogo({ src, className }: { src: string | null; className?: string }) {
	const [failed, setFailed] = useState(false)

	useEffect(() => setFailed(false), [src])

	if (src === null || failed) return <ClubMark className={cn(className)} />

	// Znak se vepisuje, neosekává: logo na šířku nesmí přijít o kraje. Volající
	// proto zadává jen výšku (`h-8`) a šířka dojede podle poměru stran.
	return (
		<img
			src={src}
			alt=""
			className={cn('shrink-0 rounded-md object-contain', className)}
			onError={() => setFailed(true)}
		/>
	)
}
