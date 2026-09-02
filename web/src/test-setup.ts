import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

// Node 26 vystavuje neaktivní `localStorage`, který jinak přebije úložiště jsdom.
const values = new Map<string, string>()
const testStorage: Storage = {
	get length() {
		return values.size
	},
	clear: () => values.clear(),
	getItem: (key) => values.get(key) ?? null,
	key: (index) => [...values.keys()][index] ?? null,
	removeItem: (key) => values.delete(key),
	setItem: (key, value) => values.set(key, value),
}

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: testStorage })
Object.defineProperty(window, 'localStorage', { configurable: true, value: testStorage })

beforeEach(() => testStorage.clear())

// jsdom drží typy <dialog>, ale jeho modální metody zatím neimplementuje.
HTMLDialogElement.prototype.showModal ??= function showModal() {
	this.open = true
}

HTMLDialogElement.prototype.close ??= function close() {
	this.open = false
}
