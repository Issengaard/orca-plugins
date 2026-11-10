import test from 'node:test'
import assert from 'node:assert/strict'
import { sineWavePcm16 } from '../src/tone.ts'

function decode(base64) {
  const buf = Buffer.from(base64, 'base64')
  const out = []
  for (let i = 0; i < buf.length; i += 2) out.push(buf.readInt16LE(i))
  return { bytes: buf.length, samples: out }
}

test('one second at 24 kHz is 24000 samples', () => {
  const t = sineWavePcm16(440, 1, 24000)
  assert.equal(t.samples, 24000)
  assert.equal(decode(t.base64).bytes, 48000)
})

test('first sample is zero and peak is near full scale', () => {
  const { samples } = decode(sineWavePcm16(440, 1, 24000).base64)
  assert.equal(samples[0], 0)
  const peak = Math.max(...samples.map(Math.abs))
  assert.ok(peak >= 30000 && peak <= 32767, `peak ${peak}`)
})
