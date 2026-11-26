import { describe, expect, it } from 'vitest'
import { csvToObjects, formatSerial, parseCsv } from './format'

describe('formatSerial', () => {
  const d = new Date(2026, 2, 7)
  it('renders tokens like the server', () => {
    expect(formatSerial('UPS-{YY}-{SEQ:4}', 1, d)).toBe('UPS-26-0001')
    expect(formatSerial('{MSE}-{MM}{DD}-{SEQ}', 12, d)).toBe('MSE-0307-0012')
    expect(formatSerial('{TYPE}-{SEQ:2}', 5, d, 'Access Point')).toBe('ACCESS_POINT-05')
  })
})

describe('csv', () => {
  it('handles quotes, commas and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
    expect(csvToObjects('Serial Number,Asset Type\nS1,Laptop')).toEqual([{ serial_number: 'S1', asset_type: 'Laptop' }])
  })
})
