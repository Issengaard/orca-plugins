import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { claudeProjectDir, lastAssistantText, pickSession } from '../src/logs.ts'

test('dots and slashes become dashes', () => {
  assert.ok(claudeProjectDir('/Users/x', '/Users/x/.claude').endsWith('/projects/-Users-x--claude'))
})

test('spaces become dashes', () => {
  assert.ok(claudeProjectDir('/Users/x', '/Users/x/My Repo').endsWith('/projects/-Users-x-My-Repo'))
})

test('newest session since launch wins', () => {
  const files = [{ path: 'a', mtimeMs: 100 }, { path: 'c', mtimeMs: 300 }, { path: 'b', mtimeMs: 200 }]
  assert.equal(pickSession(files, 150), 'c')
  assert.equal(pickSession(files, 400), null)
})

test('last assistant text joins text parts', () => {
  const jsonl = readFileSync(new URL('./fixtures/claude-session.jsonl', import.meta.url), 'utf8')
  assert.equal(lastAssistantText(jsonl), 'Done. Drafts dedupe on the server now.')
})
