import type { OrcaWorkerApi } from 'orca/worker'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { dataDir } from './datadir.ts'
import { claudeProjectDir, lastAssistantText, pickSession } from './logs.ts'
import type { ProbeResult } from './results.ts'

type Save = (r: Omit<ProbeResult, 'at'>) => Promise<void>
type Ws = { id: string; name: string; path: string; branch: string | null }
type Agent = { terminalId: string | null; title: string | null; agent: string | null; state: string; stateStartedAt: number }

const SKIP = new Set(['node_modules', '.git', 'Library', '.Trash'])

async function find(root: string, test: (name: string) => boolean, depth: number): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string, d: number): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (d < depth && !SKIP.has(e.name)) await walk(p, d + 1)
      } else if (test(e.name)) out.push(p)
    }
  }
  await walk(root, 0)
  return out
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile('git', ['-C', cwd, ...args], { timeout: 8000 }, (err, out) => resolve(err ? '' : String(out))))
}

async function focusedWorkspace(orca: OrcaWorkerApi): Promise<Ws | null> {
  const ctx = (await orca.host.call('workspace.readContext')) as unknown as { branch: string; displayName: string } | null
  const { workspaces } = (await orca.host.call('workspace.list')) as unknown as { workspaces: Ws[] }
  if (!ctx) return null
  return workspaces.find((w) => w.branch === ctx.branch && w.name === ctx.displayName) ?? workspaces.find((w) => w.branch === ctx.branch) ?? null
}

const squash = (s: string) => s.replace(/\s+/g, '')

export function registerWorkerProbes(orca: OrcaWorkerApi, save: Save): void {
  orca.panels.handle('probe.datadir', async () => {
    const dir = path.join(dataDir(process.platform, process.env, os.homedir()), 'probe')
    try {
      await mkdir(dir, { recursive: true })
      const file = path.join(dir, 'write-test.bin')
      const bytes = randomBytes(1024 * 1024)
      await writeFile(file, bytes)
      const back = await readFile(file)
      await rm(file)
      if (!back.equals(bytes)) throw Object.assign(new Error('read back different bytes'), { code: 'MISMATCH' })
      await save({ id: 'datadir', status: 'pass', detail: `wrote, read and removed 1 MB in ${dir}`, data: { path: dir } })
    } catch (e) {
      await save({ id: 'datadir', status: 'fail', detail: `${(e as { code?: string }).code ?? 'error'}: ${(e as Error).message}`, data: { path: dir } })
    }
    return { ok: true }
  })

  orca.panels.handle('probe.sessionlog', async () => {
    const { agents } = (await orca.host.call('agents.list')) as unknown as { agents: Agent[] }
    if (!agents.length) {
      await save({ id: 'sessionlog', status: 'fail', detail: 'no agents in this workspace' })
      return { ok: true }
    }
    const ws = await focusedWorkspace(orca)
    const home = os.homedir()
    const per: Record<string, unknown>[] = []
    let claude = 0
    let matched = 0
    for (const a of agents) {
      const kind = (a.agent ?? '').toLowerCase()
      const lines = a.terminalId ? ((await orca.host.call('terminal.read', { terminalId: a.terminalId, maxLines: 200 })) as unknown as { lines: string[] }).lines : []
      if (kind.includes('claude') && ws) {
        claude++
        const dir = claudeProjectDir(home, ws.path)
        const files = await Promise.all((await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.jsonl')).map(async (f) => ({ path: path.join(dir, f), mtimeMs: (await stat(path.join(dir, f))).mtimeMs })))
        const pick = pickSession(files, a.stateStartedAt - 24 * 3600 * 1000)
        const text = pick ? lastAssistantText(await readFile(pick, 'utf8')) : null
        const ok = !!text && squash(lines.join('')).includes(squash(text.slice(0, 40)))
        if (ok) matched++
        per.push({ agent: a.title ?? kind, kind, dir, log: pick, lastText: text?.slice(0, 80) ?? null, matched: ok })
      } else if (kind.includes('codex')) {
        const logs = (await find(path.join(home, '.codex'), (n) => n.endsWith('.jsonl'), 4)).slice(-3)
        per.push({ agent: a.title ?? kind, kind, codexLogs: logs, terminalSample: lines.slice(-5) })
      } else {
        per.push({ agent: a.title ?? kind, kind, terminalSample: lines.slice(-20) })
      }
    }
    const status = claude === 0 ? 'partial' : matched === claude ? 'pass' : matched ? 'partial' : 'fail'
    const detail = claude === 0 ? `no Claude agents to match; ${agents.length} others sampled` : `${matched} of ${claude} Claude agents matched their session log`
    await save({ id: 'sessionlog', status, detail, data: { agents: per } })
    return { ok: true }
  })

  orca.panels.handle('probe.untitled', async () => {
    const ws = await focusedWorkspace(orca)
    if (!ws) {
      await save({ id: 'untitled-location', status: 'fail', detail: 'no focused workspace' })
      return { ok: true }
    }
    const found = await find(ws.path, (n) => n.endsWith('.convoprobe'), 4)
    if (!found.length) {
      const elsewhere = await find(os.homedir(), (n) => n.endsWith('.convoprobe'), 3)
      await save({ id: 'untitled-location', status: 'fail', detail: `none in the worktree; found ${elsewhere.length} elsewhere`, data: { workspace: ws.path, elsewhere } })
      return { ok: true }
    }
    const status = await git(ws.path, ['status', '--porcelain', '--untracked-files=all'])
    const inGitStatus = found.filter((f) => status.includes(path.relative(ws.path, f)))
    await save({
      id: 'untitled-location',
      status: inGitStatus.length ? 'partial' : 'pass',
      detail: inGitStatus.length ? `inside the worktree and shown by git status: ${path.relative(ws.path, inGitStatus[0])}` : `inside the worktree, hidden from git status`,
      data: { workspace: ws.path, found, inGitStatus }
    })
    return { ok: true }
  })

  let armed: number | null = null
  let last: { delayMs: number; waitedMs: number; text: string } | null = null
  orca.hooks.on('terminal.send', async (event, next) => {
    if (armed === null) return next(event)
    const delayMs = armed
    armed = null
    const start = Date.now()
    await new Promise((r) => setTimeout(r, delayMs))
    last = { delayMs, waitedMs: Date.now() - start, text: event.text.slice(0, 40) }
    return next(event)
  })
  orca.panels.handle('probe.hookArm', async (input) => {
    armed = (input as unknown as { delayMs: number }).delayMs
    last = null
    return { ok: true }
  })
  orca.panels.handle('probe.hookResult', async () => (last ?? { none: true }) as never)

  let presses: number[] = []
  orca.commands.register('convo-probe.talk', () => {
    presses.push(Date.now())
    orca.panels.post('probe.talk', { at: Date.now() })
    return 'Convo Probe heard the shortcut'
  })
  orca.panels.handle('probe.keyResult', async (input) => {
    if ((input as unknown as { reset?: boolean })?.reset) presses = []
    return { presses } as never
  })

  orca.settings.onDidChange((change) => {
    void save({ id: 'settings-change', status: 'pass', detail: `worker heard a change to "${change.key}"`, data: { key: change.key } })
  })
}
