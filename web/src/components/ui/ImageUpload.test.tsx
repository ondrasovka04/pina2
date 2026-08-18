import { fireEvent, render, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import { ImageUpload, imageDataUrl, scaledSize } from '@/components/ui/ImageUpload'

describe('imageDataUrl', () => {
	it('odmítne nepodporovaný typ a příliš velký soubor', async () => {
		await expect(imageDataUrl(new File(['text'], 'obrazek.svg', { type: 'image/svg+xml' }))).rejects.toThrow(
			'JPEG, PNG, GIF nebo WebP',
		)

		const tooLarge = new File(['x'], 'velky.png', { type: 'image/png' })
		Object.defineProperty(tooLarge, 'size', { value: 20 * 1024 * 1024 + 1 })
		await expect(imageDataUrl(tooLarge)).rejects.toThrow('nejvýše 20 MB')
	})
})

describe('scaledSize', () => {
	it('zkrátí nejdelší stranu na 1024 a nechá poměr stran', () => {
		expect(scaledSize(4032, 3024)).toEqual({ width: 1024, height: 768 })
		expect(scaledSize(600, 2400)).toEqual({ width: 256, height: 1024 })
	})

	it('nezvětšuje malý obrázek a nespadne na nule', () => {
		expect(scaledSize(120, 40)).toEqual({ width: 120, height: 40 })
		expect(scaledSize(2000, 1)).toEqual({ width: 1024, height: 1 })
	})
})

describe('ImageUpload', () => {
	// jsdom `<canvas>` neumí, takže zmenšení se přeskočí a pošle se původní soubor
	// — přesně jako v prohlížeči, který ho nezvládne. Přiřazení jen umlčí hlášku,
	// kterou by jsdom jinak vypsal doprostřed výstupu testů.
	beforeAll(() => {
		HTMLCanvasElement.prototype.getContext = () => null
	})

	it('po výběru pošle datový obrázek a dovolí ho odebrat', async () => {
		const save = vi.fn<(image: string | null) => Promise<void>>().mockResolvedValue(undefined)
		const { container, getByRole } = render(<ImageUpload name="Ondřej Kopáč" imageUrl="/avatar.png" onSave={save} />)
		const input = container.querySelector('input[type="file"]')
		expect(input).not.toBeNull()

		fireEvent.change(input!, {
			target: { files: [new File(['png'], 'avatar.png', { type: 'image/png' })] },
		})

		await waitFor(() => expect(save).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/)))

		fireEvent.click(getByRole('button', { name: 'Odebrat' }))
		await waitFor(() => expect(save).toHaveBeenLastCalledWith(null))
	})
})
