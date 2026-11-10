import type { OrcaWorkerApi } from 'orca/worker'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recordResult, renderReport, type ProbeResult } from './results.ts'
import { sineWavePcm16 } from './tone.ts'
import { registerWorkerProbes } from './workerProbes.ts'

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

const MOCKUP =
  '<!doctype html><html><body style="font:14px system-ui;margin:12px"><h3>Mockup sample</h3><p>If scripts run, this page tells the tab.</p>' +
  '<script>document.body.dataset.ran = "yes"; parent.postMessage({ mockupRan: true }, "*")</script></body></html>'

type Beat = { t: number; visible: boolean; ctx: string; mic: boolean }

export default function activate(orca: OrcaWorkerApi): void {
  registerWorkerProbes(orca, (r) => saveResult(orca, r))
  orca.panels.handle('probe.tone', async () => ({ base64: sineWavePcm16(440, 1, 24000).base64, sampleRate: 24000 }))
  orca.panels.handle('probe.mockup', async () => ({ html: MOCKUP }))
  orca.panels.handle('probe.heartbeat', async (input) => {
    const b = input as unknown as Beat & { reset?: boolean }
    if (b.reset) {
      await orca.storage.set('beats', [])
      return { ok: true }
    }
    const prev = await orca.storage.get('beats')
    const beats = (Array.isArray(prev) ? (prev as unknown as Beat[]) : []).concat([{ t: b.t, visible: b.visible, ctx: b.ctx, mic: b.mic }]).slice(-600)
    await orca.storage.set('beats', beats as never)
    return { ok: true }
  })
  orca.panels.handle('probe.sherpa', async () => {
    const bench = fileURLToPath(new URL('../bench/bench.mjs', import.meta.url))
    if (!existsSync(bench)) {
      await saveResult(orca, { id: 'sherpa', status: 'fail', detail: `bench not found at ${bench}` })
      return { ok: false }
    }
    const out = await new Promise<string | null>((resolve) => {
      execFile(
        process.execPath,
        [bench, '--json'],
        { timeout: 300000, maxBuffer: 8 * 1024 * 1024, cwd: path.dirname(bench), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
        (err, stdout) => resolve(err && !stdout ? null : String(stdout))
      )
    })
    const line = out?.trim().split('\n').pop()
    if (!line) {
      await saveResult(orca, { id: 'sherpa', status: 'fail', detail: `bench produced no output under ${process.execPath}` })
      return { ok: false }
    }
    const r = JSON.parse(line) as { judge: { status: 'pass' | 'partial' | 'fail'; reasons: string[] }; sttRtf: number; ttsFirstAudioMs: Record<string, number> }
    const detail = `in Orca's worker: STT RTF ${r.sttRtf?.toFixed(2)}, piper ${r.ttsFirstAudioMs.piper} ms, kokoro ${r.ttsFirstAudioMs.kokoro} ms${r.judge.reasons.length ? '; ' + r.judge.reasons.join('; ') : ''}`
    await saveResult(orca, { id: 'sherpa', status: r.judge.status, detail, data: { ...r, execPath: process.execPath } })
    return { ok: true }
  })
  orca.panels.handle('probe.beats', async () => {
    const v = await orca.storage.get('beats')
    return (Array.isArray(v) ? v : []) as never
  })
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
