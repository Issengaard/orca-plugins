import test from 'node:test'
import assert from 'node:assert/strict'
import { PROBES, recordResult, renderReport } from '../src/results.ts'

const meta = { orca: '1.4.255', platform: 'darwin', arch: 'arm64', when: '2026-11-10' }

test('recording a probe twice keeps only the newest', () => {
  let list = recordResult([], { id: 'mic', status: 'fail', detail: 'x', at: 1 })
  list = recordResult(list, { id: 'mic', status: 'pass', detail: 'y', at: 2 })
  assert.equal(list.length, 1)
  assert.equal(list[0].status, 'pass')
  assert.equal(list[0].at, 2)
})

test('report lists every probe, with not run for missing ones', () => {
  const list = recordResult([], { id: 'mic', status: 'pass', detail: 'ok', at: 1 })
  const md = renderReport(list, meta)
  assert.ok(md.includes('| 2 | Microphone in the tab | pass |'))
  assert.ok(md.includes('| 1 | Orca dictation types into the tab | not run |'))
  const rows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l))
  assert.equal(rows.length, PROBES.length)
})

test('report header names Orca version and platform', () => {
  const md = renderReport([], meta)
  assert.ok(md.startsWith('# Convo Mode probe results'))
  assert.ok(md.includes('Orca 1.4.255 · darwin arm64 · 2026-11-10'))
})

test('detail with a pipe or newline does not break the table', () => {
  const list = recordResult([], { id: 'speech', status: 'partial', detail: 'a|b\nc', at: 1 })
  assert.ok(renderReport(list, meta).includes('a\\|b c'))
})
