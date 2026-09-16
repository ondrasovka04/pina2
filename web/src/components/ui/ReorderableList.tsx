import type { ReactNode } from 'react'
import { useRef, useState } from 'react'

import { GripIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { moveItem, shift, targetIndex } from '@/lib/reorder'

interface ReorderableListProps<T> {
	items: T[]
	getKey: (item: T) => number
	getLabel: (item: T) => string
	renderItem: (item: T) => ReactNode
	/** Zavolá se až po dotažení, ne v průběhu. */
	onReorder: (items: T[]) => void
}

interface DragState {
	key: number
	fromIndex: number
	targetIndex: number
	/** Posun taženého řádku od výchozí pozice. */
	offsetY: number
	height: number
	// Středy řádků v dokumentových souřadnicích — přežijí odrolování.
	midpoints: number[]
	startPageY: number
}

/** Kolik pixelů od okraje okna začíná samočinné rolování a jak rychle jede. */
const SCROLL_ZONE = 72
const SCROLL_STEP = 14

/**
 * Pointer Events, ne HTML5 drag-and-drop — to na dotykových displejích nefunguje.
 * Během tažení se pořadí nemění — rozměry se změří jednou, ostatní řádky se jen posunou.
 */
export function ReorderableList<T>({ items, getKey, getLabel, renderItem, onReorder }: ReorderableListProps<T>) {
	// Lokálně jen pořadí klíčů — server řídí obsah, aby se seznam neposkokal.
	const [orderKeys, setOrderKeys] = useState(() => items.map(getKey))
	const [drag, setDrag] = useState<DragState | null>(null)
	const containerRef = useRef<HTMLUListElement>(null)

	const byKey = new Map(items.map((item) => [getKey(item), item]))
	const known = orderKeys.map((key) => byKey.get(key)).filter((item) => item !== undefined)
	// Co přibylo na serveru (nová položka sazebníku), jde na konec.
	const added = items.filter((item) => !orderKeys.includes(getKey(item)))
	const order = [...known, ...added]

	function commit(from: number, to: number) {
		if (to === from || to < 0 || to >= order.length) {
			return
		}

		const next = moveItem(order, from, to)
		setOrderKeys(next.map(getKey))
		onReorder(next)
	}

	function startDrag(index: number, key: number, clientY: number) {
		const rows = containerRef.current?.children
		if (rows === undefined) {
			return
		}

		const midpoints: number[] = []
		let height = 0

		for (let position = 0; position < rows.length; position++) {
			const rect = rows[position]?.getBoundingClientRect()
			if (rect === undefined) {
				continue
			}

			midpoints.push(rect.top + window.scrollY + rect.height / 2)
			if (position === index) {
				height = rect.height
			}
		}

		setDrag({
			key,
			fromIndex: index,
			targetIndex: index,
			offsetY: 0,
			height,
			midpoints,
			startPageY: clientY + window.scrollY,
		})
	}

	function onMove(clientY: number) {
		setDrag((current) => {
			if (current === null) {
				return current
			}

			const pageY = clientY + window.scrollY

			return {
				...current,
				offsetY: pageY - current.startPageY,
				targetIndex: targetIndex(current.midpoints, pageY),
			}
		})

		// U pětačtyřiceti položek se bez samočinného rolování nedá dotáhnout
		// položka z konce seznamu nahoru.
		if (clientY < SCROLL_ZONE) {
			window.scrollBy(0, -SCROLL_STEP)
		} else if (clientY > window.innerHeight - SCROLL_ZONE) {
			window.scrollBy(0, SCROLL_STEP)
		}
	}

	function endDrag() {
		if (drag !== null) {
			commit(drag.fromIndex, drag.targetIndex)
		}

		setDrag(null)
	}

	function shiftOf(index: number): number {
		if (drag === null) {
			return 0
		}

		// Tažený řádek sleduje prst, ostatní uhýbají o jeho výšku.
		return index === drag.fromIndex ? drag.offsetY : shift(index, drag.fromIndex, drag.targetIndex, drag.height)
	}

	return (
		<ul ref={containerRef} className="divide-line/50 divide-y">
			{order.map((item, index) => {
				const key = getKey(item)
				const dragged = drag?.key === key

				return (
					<li
						key={key}
						style={{ transform: `translateY(${shiftOf(index)}px)` }}
						className={cn(
							'bg-surface-1 flex items-stretch gap-2',
							dragged && 'relative z-10 shadow-lg',
							// Animace jen během tažení — po puštění musí posuny zmizet.
							drag !== null && !dragged && 'transition-transform duration-150',
						)}
					>
						<button
							type="button"
							aria-label={`Přesunout ${getLabel(item)}`}
							className={cn(
								'text-ink-faint hover:text-ink shrink-0 touch-none px-4',
								dragged ? 'cursor-grabbing' : 'cursor-grab',
							)}
							onPointerDown={(event) => {
								event.currentTarget.setPointerCapture(event.pointerId)
								startDrag(index, key, event.clientY)
							}}
							onPointerMove={(event) => {
								if (dragged) {
									onMove(event.clientY)
								}
							}}
							onPointerUp={endDrag}
							onPointerCancel={() => setDrag(null)}
							onKeyDown={(event) => {
								const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
								if (step === 0) {
									return
								}

								event.preventDefault()
								commit(index, index + step)
							}}
						>
							<GripIcon className="size-5" />
						</button>

						<div className="min-w-0 flex-1 py-3 pr-4">{renderItem(item)}</div>
					</li>
				)
			})}
		</ul>
	)
}
