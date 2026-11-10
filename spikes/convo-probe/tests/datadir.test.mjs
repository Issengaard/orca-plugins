import test from 'node:test'
import assert from 'node:assert/strict'
import { dataDir } from '../src/datadir.ts'

test('mac data dir', () => {
  assert.equal(dataDir('darwin', {}, '/Users/x'), '/Users/x/Library/Application Support/convo-mode')
})

test('windows uses APPDATA', () => {
  const p = dataDir('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'C:\\Users\\x')
  assert.ok(p.startsWith('C:\\Users\\x\\AppData\\Roaming'))
  assert.ok(p.endsWith('convo-mode'))
})

test('linux honors XDG_DATA_HOME', () => {
  assert.equal(dataDir('linux', { XDG_DATA_HOME: '/data' }, '/home/x'), '/data/convo-mode')
  assert.equal(dataDir('linux', {}, '/home/x'), '/home/x/.local/share/convo-mode')
})
