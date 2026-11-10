import type { OrcaWorkerApi } from 'orca/worker'
import { execFile } from 'node:child_process'
import os from 'node:os'
import { recordResult, renderReport, type ProbeResult } from './results.ts'

const RESULTS = 'results'
const APP_CLI = '/Applications/Orca.app/Contents/Resources/bin/orca'

function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, out) => resolve(err ? null : String(out)))
  })
}

async function orcaVersion(): Promise<string> {
  const out = (await run('orca', ['--version'])) ?? (await run(APP_CLI, ['--version']))
  return out ? out.trim().split('\n')[0] : 'unknown'
}

export async function loadResults(orca: OrcaWorkerApi): Promise<ProbeResult[]> {
  const v = await orca.storage.get(RESULTS)
  return Array.isArray(v) ? (v as unknown as ProbeResult[]) : []
}

export async function saveResult(orca: OrcaWorkerApi, r: Omit<ProbeResult, 'at'>): Promise<void> {
  const list = recordResult(await loadResults(orca), { ...r, at: Date.now() })
  await orca.storage.set(RESULTS, list as never)
  orca.panels.post('probe.changed', { count: list.length })
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('probe.record', async (input) => {
    await saveResult(orca, input as unknown as Omit<ProbeResult, 'at'>)
    return { ok: true }
  })
  orca.panels.handle('probe.results', async () => (await loadResults(orca)) as never)
  orca.panels.handle('probe.report', async () => ({
    markdown: renderReport(await loadResults(orca), {
      orca: await orcaVersion(),
      platform: process.platform,
      arch: os.arch(),
      when: new Date().toISOString().slice(0, 10)
    })
  }))
}
