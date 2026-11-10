import { PROBES, type ProbeId, type ProbeResult, type ProbeStatus } from '../src/results.ts'

export async function record(id: ProbeId, status: ProbeStatus, detail: string, data?: object): Promise<void> {
  await orca.plugin.request('probe.record', { id, status, detail, data: data ?? {} } as never)
  await refresh()
}

export type Runner = () => Promise<void>
const runners = new Map<ProbeId, Runner>()

export function register(id: ProbeId, fn: Runner): void {
  runners.set(id, fn)
}

const style = document.createElement('style')
style.textContent = [
  'body{margin:0;font:13px/1.5 system-ui,sans-serif;color:var(--orca-foreground);background:var(--orca-background)}',
  'main{max-width:900px;margin:0 auto;padding:20px;display:flex;flex-direction:column;gap:16px}',
  'h1{font-size:18px;margin:0}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}',
  'button{font:inherit;color:inherit;background:var(--orca-secondary);border:1px solid var(--orca-border);border-radius:8px;padding:8px 10px;text-align:left;cursor:pointer}',
  'button:hover{border-color:var(--orca-foreground)}',
  '.q{color:var(--orca-muted-foreground);font-size:11px;display:block}',
  '#extra{display:flex;flex-direction:column;gap:8px}',
  'table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--orca-border);padding:4px 6px;text-align:left;vertical-align:top}',
  '.pass{color:#2c8a4b}.fail{color:#c0392b}.partial{color:#b7791f}',
  'pre{white-space:pre-wrap;background:var(--orca-secondary);padding:10px;border-radius:8px}'
].join('\n')
document.head.append(style)

const main = document.createElement('main')
main.innerHTML =
  '<h1>Convo Probe</h1><p>Press each button. Each records one row below. Some ask you to do something; follow the prompt that appears.</p>' +
  '<div class="grid" id="buttons"></div><div id="extra"></div>' +
  '<h1>Results</h1><table id="results"></table>' +
  '<button id="report">Show report</button><pre id="md" hidden></pre>'
document.body.append(main)

export const extra = document.getElementById('extra') as HTMLDivElement

const buttons = document.getElementById('buttons') as HTMLDivElement
for (const p of PROBES) {
  const b = document.createElement('button')
  b.innerHTML = `<span class="q">Question ${p.question}</span>${p.title}`
  b.onclick = async () => {
    const fn = runners.get(p.id)
    if (!fn) {
      await record(p.id, 'partial', 'not implemented')
      return
    }
    try {
      await fn()
    } catch (e) {
      await record(p.id, 'fail', `threw ${(e as Error).name}: ${(e as Error).message}`)
    }
  }
  buttons.append(b)
}

async function refresh(): Promise<void> {
  const got = (await orca.plugin.request('probe.results')) as unknown
  const list = Array.isArray(got) ? (got as ProbeResult[]) : []
  const t = document.getElementById('results') as HTMLTableElement
  t.innerHTML =
    '<tr><th>Probe</th><th>Result</th><th>Detail</th></tr>' +
    list
      .map((r) => `<tr><td>${r.id}</td><td class="${r.status}">${r.status}</td><td>${escapeHtml(r.detail)}</td></tr>`)
      .join('')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

;(document.getElementById('report') as HTMLButtonElement).onclick = async () => {
  const res = (await orca.plugin.request('probe.report')) as unknown as { markdown: string }
  const md = res.markdown
  const pre = document.getElementById('md') as HTMLPreElement
  pre.textContent = md
  pre.hidden = false
}

refresh().catch(() => {})
