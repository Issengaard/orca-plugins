export type ProbeId =
  | 'dictation'
  | 'mic'
  | 'speech'
  | 'webaudio'
  | 'mockup-iframe'
  | 'mockup-shadow'
  | 'sherpa'
  | 'datadir'
  | 'sessionlog'
  | 'hidden-tab'
  | 'untitled-location'
  | 'hook-timing'
  | 'keybinding'
  | 'settings-change'

export type ProbeStatus = 'pass' | 'fail' | 'partial'

export type ProbeResult = {
  id: ProbeId
  status: ProbeStatus
  detail: string
  data?: Record<string, unknown>
  at: number
}

export const PROBES: readonly { id: ProbeId; question: number; title: string }[] = [
  { id: 'dictation', question: 1, title: 'Orca dictation types into the tab' },
  { id: 'mic', question: 2, title: 'Microphone in the tab' },
  { id: 'speech', question: 3, title: 'Speech synthesis in the tab' },
  { id: 'webaudio', question: 3, title: 'Web Audio playback from the worker' },
  { id: 'mockup-iframe', question: 4, title: 'Mockup in an iframe with scripts' },
  { id: 'mockup-shadow', question: 4, title: 'Mockup in a shadow root with scripts' },
  { id: 'sherpa', question: 5, title: 'sherpa-onnx WebAssembly speed' },
  { id: 'datadir', question: 6, title: 'Where models can be stored' },
  { id: 'sessionlog', question: 7, title: 'Terminal matched to its session log' },
  { id: 'hidden-tab', question: 8, title: 'Tab keeps running while hidden' },
  { id: 'untitled-location', question: 9, title: 'Where New Convo files land' },
  { id: 'hook-timing', question: 10, title: 'How long Orca waits on a hook' },
  { id: 'keybinding', question: 11, title: 'Talk shortcut: press, hold and rebind' },
  { id: 'settings-change', question: 12, title: 'Worker hears settings changes' }
]

export function recordResult(list: ProbeResult[], r: ProbeResult): ProbeResult[] {
  return [...list.filter((x) => x.id !== r.id), r]
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

export function renderReport(
  list: ProbeResult[],
  meta: { orca: string; platform: string; arch: string; when: string }
): string {
  const byId = new Map(list.map((r) => [r.id, r]))
  const rows = PROBES.map((p) => {
    const r = byId.get(p.id)
    return `| ${p.question} | ${p.title} | ${r ? r.status : 'not run'} | ${r ? cell(r.detail) : ''} |`
  })
  return [
    '# Convo Mode probe results',
    '',
    `Orca ${meta.orca} · ${meta.platform} ${meta.arch} · ${meta.when}`,
    '',
    '| Q | Probe | Result | Detail |',
    '| --- | --- | --- | --- |',
    ...rows,
    ''
  ].join('\n')
}
