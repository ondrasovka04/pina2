import { useEffect, useRef, useState } from 'react'

import { initials } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
/** Server z obrázku dělá nejvýš 512 px, dvojnásobek stačí i na retina displej. */
const MAX_EDGE = 1024

/**
 * Nejdelší strana po zmenšení. Nikdy nezvětšuje — malý znak klubu se roztažením
 * jen rozmaže a serveru je to jedno.
 */
export function scaledSize(width: number, height: number): { width: number; height: number } {
	const scale = Math.min(1, MAX_EDGE / Math.max(width, height))

	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	}
}

export async function imageDataUrl(file: File): Promise<string> {
	if (!ACCEPTED_TYPES.includes(file.type)) {
		throw new Error('Vyberte obrázek ve formátu JPEG, PNG, GIF nebo WebP.')
	}
	if (file.size > MAX_IMAGE_BYTES) {
		throw new Error('Obrázek může mít nejvýše 20 MB.')
	}

	const original = await readDataUrl(file)

	return (await downscaled(original, file.type)) ?? original
}

function readDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.addEventListener('load', () => {
			if (typeof reader.result === 'string') resolve(reader.result)
			else reject(new Error('Obrázek se nepodařilo načíst.'))
		})
		reader.addEventListener('error', () => reject(new Error('Obrázek se nepodařilo načíst.')))
		reader.readAsDataURL(file)
	})
}

/**
 * Zmenšení ještě v telefonu, nebo `null`, když to prohlížeč neumí — pak se pošle
 * původní soubor a poradí si server.
 *
 * Server z obrázku stejně dělá 512px PNG, takže protlačovat mobilními daty deset
 * megabajtů je práce pro nic. Vedle toho to řeší **otočení fotky**: `<canvas>`
 * respektuje EXIF, ale GD na serveru ne, takže fotka nafocená na výšku by přišla
 * položená na bok.
 */
async function downscaled(dataUrl: string, type: string): Promise<string | null> {
	try {
		const canvas = document.createElement('canvas')
		const context = canvas.getContext('2d')
		if (context === null) return null

		const image = await loadImage(dataUrl)
		if (image === null) return null

		const size = scaledSize(image.naturalWidth, image.naturalHeight)
		canvas.width = size.width
		canvas.height = size.height
		context.drawImage(image, 0, 0, size.width, size.height)

		// Fotka jde jako JPEG: průhlednost nemá a v PNG by byla několikanásobně
		// větší. Zbytek zůstává bezztrátový, protože znak klubu bývá průhledný.
		const encoded = type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png')

		return encoded.startsWith('data:image/') ? encoded : null
	} catch {
		return null
	}
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const image = new Image()
		image.addEventListener('load', () => resolve(image))
		image.addEventListener('error', () => resolve(null))
		image.src = src
	})
}

interface ImageUploadProps {
	name: string
	imageUrl: string | null
	shape?: 'circle' | 'rounded'
	onSave: (image: string | null) => Promise<void>
}

export function ImageUpload({ name, imageUrl, shape = 'circle', onSave }: ImageUploadProps) {
	const input = useRef<HTMLInputElement>(null)
	const [preview, setPreview] = useState<string | null>(imageUrl)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => setPreview(imageUrl), [imageUrl])

	async function save(next: string | null) {
		setBusy(true)
		setError(null)
		setPreview(next)

		try {
			await onSave(next)
		} catch (cause) {
			setPreview(imageUrl)
			setError(cause instanceof ApiError || cause instanceof Error ? cause.message : 'Obrázek se nepodařilo uložit.')
		} finally {
			setBusy(false)
		}
	}

	async function choose(file: File | undefined) {
		if (file === undefined) return

		// Zhasnout hned po výběru, ne až se odesílá — přečíst a zmenšit velkou fotku chvíli trvá.
		setBusy(true)
		setError(null)
		try {
			await save(await imageDataUrl(file))
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Obrázek se nepodařilo načíst.')
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-4">
			<div
				className={cn(
					'bg-surface-3 text-ink-muted grid size-20 shrink-0 place-items-center overflow-hidden text-xl font-semibold',
					// Znak dostane odsazení, jinak mu zaoblený roh ukrojí kraj.
					shape === 'circle' ? 'rounded-full' : 'rounded-lg p-2',
				)}
			>
				{preview === null ? (
					initials(name)
				) : (
					// Stejně jako server: tvář se oseká, znak se vepíše celý.
					<img
						src={preview}
						alt=""
						className={cn('size-full', shape === 'circle' ? 'object-cover' : 'object-contain')}
						onError={() => setPreview(null)}
					/>
				)}
			</div>

			<div className="min-w-0 flex-1">
				<input
					ref={input}
					type="file"
					accept={ACCEPTED_TYPES.join(',')}
					// Ovládá se tlačítkem vedle, takže samotné pole nemá být ani
					// vidět, ani v pořadí tabulátoru — jinak se fokus zastaví na ničem.
					className="sr-only"
					tabIndex={-1}
					aria-hidden="true"
					onChange={(event) => {
						const file = event.target.files?.[0]
						event.target.value = ''
						void choose(file)
					}}
				/>
				<div className="flex flex-wrap justify-end gap-2">
					<Button type="button" size="sm" loading={busy} onClick={() => input.current?.click()}>
						Vybrat obrázek
					</Button>
					{imageUrl === null ? null : (
						<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
							Odebrat
						</Button>
					)}
				</div>
				{error === null ? null : (
					<p role="alert" className="text-debt mt-2 text-right text-sm">
						{error}
					</p>
				)}
			</div>
		</div>
	)
}
