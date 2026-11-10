import test from 'node:test'
import assert from 'node:assert/strict'
import { judge } from '../bench/thresholds.mjs'

test('fast numbers pass', () => {
  const j = judge({ sttRtf: 0.3, vadRtf: 0.01, ttsFirstAudioMs: { piper: 400, kokoro: 900 } })
  assert.equal(j.status, 'pass')
  assert.deepEqual(j.reasons, [])
})

test('slow kokoro is partial with a reason', () => {
  const j = judge({ sttRtf: 0.3, vadRtf: 0.01, ttsFirstAudioMs: { piper: 400, kokoro: 1840 } })
  assert.equal(j.status, 'partial')
  assert.ok(j.reasons.includes('kokoro first audio 1840 ms > 1000 ms'))
})

test('speech-to-text slower than real time fails', () => {
  const j = judge({ sttRtf: 1.2, vadRtf: 0.01, ttsFirstAudioMs: { piper: 400, kokoro: 900 } })
  assert.equal(j.status, 'fail')
})
