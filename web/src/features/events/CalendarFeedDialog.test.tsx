import { describe, expect, it } from 'vitest'

import { calendarFeedUrls } from './CalendarFeedDialog'

describe('calendarFeedUrls', () => {
	it('převede veřejný HTTPS endpoint na systémové schéma webcal', () => {
		const urls = calendarFeedUrls('abc123', 'https://pinaprosek.eu')

		expect(urls.http).toBe('https://pinaprosek.eu/api/v1/calendar/abc123.ics')
		expect(urls.webcal).toBe('webcal://pinaprosek.eu/api/v1/calendar/abc123.ics')
	})
})
