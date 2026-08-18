import '@testing-library/jest-dom/vitest'

// jsdom drží typy <dialog>, ale jeho modální metody zatím neimplementuje.
HTMLDialogElement.prototype.showModal ??= function showModal() {
	this.open = true
}

HTMLDialogElement.prototype.close ??= function close() {
	this.open = false
}
