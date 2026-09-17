import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, setAccessToken, setSupportTeamId } from '@/lib/api'

const fetchMock = vi.fn<typeof fetch>()

describe('oprávnění podpory v požadavcích', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock)
		fetchMock.mockReset()
		setAccessToken(null)
	})

	afterEach(() => {
		setAccessToken(null)
		vi.unstubAllGlobals()
	})

	it('posílá vybrané družstvo jen po dobu podpory a zruší je při odhlášení', async () => {
		fetchMock.mockImplementation(() => Promise.resolve(Response.json({ ok: true })))
		setAccessToken('token')
		await api.get('/teams/1')
		setSupportTeamId(2)
		await api.patch('/teams/2', { name: 'Nový název' })
		setSupportTeamId(null)
		await api.get('/teams/1')
		setSupportTeamId(2)
		setAccessToken(null)
		await api.get('/me')
		expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('X-Support-Team'))).toEqual([
			null,
			'2',
			null,
			null,
		])
	})

	it('opakovaný zápis po obnovení tokenu zachová původní družstvo', async () => {
		setAccessToken('starý token')
		setSupportTeamId(2)
		fetchMock
			.mockResolvedValueOnce(Response.json({}, { status: 401 }))
			.mockImplementationOnce(() => {
				setSupportTeamId(3)
				return Promise.resolve(Response.json({ accessToken: 'nový token' }))
			})
			.mockResolvedValueOnce(Response.json({ ok: true }))
		await api.patch('/teams/2', { name: 'Nový název' })
		expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/auth/refresh')
		const retry = fetchMock.mock.calls[2]?.[1]
		expect(new Headers(retry?.headers).get('X-Support-Team')).toBe('2')
		expect(new Headers(retry?.headers).get('Authorization')).toBe('Bearer nový token')
		expect(retry?.body).toBe(JSON.stringify({ name: 'Nový název' }))
	})
})
