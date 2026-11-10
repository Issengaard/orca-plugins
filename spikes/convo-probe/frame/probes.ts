import { extra, record, register } from './ui.ts'

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])
}

function errText(e: unknown): string {
  const x = e as { name?: string; message?: string }
  return `${x?.name ?? 'Error'}: ${x?.message ?? String(e)}`
}

function panel(title: string): HTMLDivElement {
  const box = document.createElement('div')
  box.style.cssText = 'border:1px solid var(--orca-border);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px'
  box.innerHTML = `<b>${title}</b>`
  extra.prepend(box)
  return box
}

function button(box: HTMLElement, label: string, fn: () => void | Promise<void>): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = () => {
    void fn()
  }
  box.append(b)
  return b
}

export async function probeMic(): Promise<void> {
  const got = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true }).catch((e) => e as Error), 10000)
  if (got === 'timeout') return record('mic', 'fail', 'no answer in 10 s')
  if (got instanceof Error || !(got instanceof MediaStream)) return record('mic', 'fail', errText(got))
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(got)
  const an = ctx.createAnalyser()
  src.connect(an)
  const buf = new Float32Array(an.fftSize)
  let peak = 0
  const end = Date.now() + 2000
  while (Date.now() < end) {
    an.getFloatTimeDomainData(buf)
    for (const v of buf) peak = Math.max(peak, Math.abs(v))
    await new Promise((r) => setTimeout(r, 50))
  }
  got.getTracks().forEach((t) => t.stop())
  const labels = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput').map((d) => d.label)
  const sampleRate = ctx.sampleRate
  await ctx.close()
  await record('mic', 'pass', `mic open, peak level ${peak.toFixed(3)}, ${labels.length} inputs`, { sampleRate, peakLevel: peak, labels })
}

export async function probeSpeech(): Promise<void> {
  if (!('speechSynthesis' in window)) return record('speech', 'fail', 'speechSynthesis is missing')
  const voices = speechSynthesis.getVoices().length
  const done = new Promise<string>((resolve) => {
    const u = new SpeechSynthesisUtterance('Convo probe, testing one two three')
    u.onend = () => resolve('end')
    u.onerror = (e) => resolve(`error ${e.error}`)
    speechSynthesis.speak(u)
  })
  const got = await withTimeout(done, 15000)
  if (got === 'end') return record('speech', 'pass', `spoke; ${voices} voices`, { voices })
  await record('speech', 'fail', got === 'timeout' ? 'no end event in 15 s' : got, { voices })
}

export async function probeWebAudio(): Promise<void> {
  const tone = (await orca.plugin.request('probe.tone')) as unknown as { base64: string; sampleRate: number }
  const bin = atob(tone.base64)
  const n = bin.length / 2
  const ctx = new AudioContext()
  await ctx.resume()
  if (ctx.state !== 'running') {
    await record('webaudio', 'fail', `context stayed ${ctx.state}`)
    return
  }
  const ab = ctx.createBuffer(1, n, tone.sampleRate)
  const ch = ab.getChannelData(0)
  for (let i = 0; i < n; i++) {
    const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)
    ch[i] = (v >= 32768 ? v - 65536 : v) / 32768
  }
  const s = ctx.createBufferSource()
  s.buffer = ab
  s.connect(ctx.destination)
  const ended = new Promise<void>((r) => (s.onended = () => r()))
  s.start()
  const got = await withTimeout(ended, 5000)
  const contextState = ctx.state
  await ctx.close()
  if (got === 'timeout') return record('webaudio', 'fail', 'tone never ended', { contextState })
  await record('webaudio', 'pass', 'played a 1 s tone from the worker', { contextState })
}

async function mockupHtml(): Promise<string> {
  const res = (await orca.plugin.request('probe.mockup')) as unknown as { html: string }
  return res.html
}

export async function probeMockupIframe(): Promise<void> {
  const box = panel('Mockup in an iframe')
  const f = document.createElement('iframe')
  f.setAttribute('sandbox', 'allow-scripts')
  f.style.cssText = 'width:100%;height:120px;border:1px solid var(--orca-border);border-radius:6px'
  let loaded = false
  let ran = false
  const onMsg = (e: MessageEvent) => {
    if ((e.data as { mockupRan?: boolean })?.mockupRan) ran = true
  }
  window.addEventListener('message', onMsg)
  f.onload = () => {
    loaded = true
  }
  f.srcdoc = await mockupHtml()
  box.append(f)
  await new Promise((r) => setTimeout(r, 3000))
  window.removeEventListener('message', onMsg)
  if (ran) return record('mockup-iframe', 'pass', 'srcdoc iframe loaded and its script ran')
  if (loaded) return record('mockup-iframe', 'partial', 'loaded, scripts did not run')
  await record('mockup-iframe', 'fail', 'iframe never loaded')
}

export async function probeMockupShadow(): Promise<void> {
  const box = panel('Mockup in a shadow root')
  const host = document.createElement('div')
  box.append(host)
  const root = host.attachShadow({ mode: 'open' })
  delete document.body.dataset.ran
  root.innerHTML = (await mockupHtml()).replace(/<\/?(html|head|body|!doctype)[^>]*>/gi, '')
  for (const old of Array.from(root.querySelectorAll('script'))) {
    const s = document.createElement('script')
    s.textContent = old.textContent
    old.replaceWith(s)
  }
  await new Promise((r) => setTimeout(r, 500))
  const shown = root.textContent?.includes('Mockup sample') ?? false
  if (document.body.dataset.ran === 'yes') return record('mockup-shadow', 'pass', 'HTML shown and its script ran')
  if (shown) return record('mockup-shadow', 'partial', 'HTML shown, script did not run')
  await record('mockup-shadow', 'fail', 'nothing shown')
}

export async function startDictationWatch(): Promise<void> {
  const box = panel('Orca dictation: focus the box, then use Orca\'s dictation shortcut and speak')
  const t = document.createElement('textarea')
  t.rows = 3
  t.placeholder = 'Dictate here with Orca\'s dictation'
  t.style.cssText = 'font:inherit;padding:6px;border-radius:6px;border:1px solid var(--orca-border);background:var(--orca-secondary);color:inherit'
  box.append(t)
  let lastKey = 0
  let lastType = ''
  let done = false
  t.addEventListener('keydown', () => {
    lastKey = Date.now()
  })
  t.addEventListener('beforeinput', (e) => {
    lastType = (e as InputEvent).inputType
  })
  t.addEventListener('input', () => {
    if (done || !t.value.trim() || Date.now() - lastKey < 1000) return
    done = true
    void record('dictation', 'pass', `text arrived without typing (${lastType || 'unknown input type'})`, { inputType: lastType, text: t.value })
  })
  button(box, 'Nothing arrived', () => {
    if (done) return
    done = true
    return record('dictation', 'fail', 'Orca dictation did not type into the tab')
  })
  t.focus()
}

let beat: ReturnType<typeof setInterval> | null = null

export async function startHeartbeat(): Promise<void> {
  if (beat) return
  const box = panel('Hidden tab: switch to another Orca tab for 20 seconds, come back, then press Finish')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const track = stream.getAudioTracks()[0]
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  g.gain.value = 0
  osc.connect(g).connect(ctx.destination)
  osc.start()
  await orca.plugin.request('probe.heartbeat', { reset: true } as never)
  beat = setInterval(() => {
    void orca.plugin.request('probe.heartbeat', {
      t: Date.now(),
      visible: document.visibilityState === 'visible',
      ctx: ctx.state,
      mic: track.readyState === 'live' && track.enabled
    } as never)
  }, 1000)
  button(box, 'Finish hidden-tab test', async () => {
    if (beat) clearInterval(beat)
    beat = null
    osc.stop()
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close()
    await finishHiddenTab()
  })
}

export async function finishHiddenTab(): Promise<void> {
  const beats = (await orca.plugin.request('probe.beats')) as unknown as { t: number; visible: boolean; ctx: string; mic: boolean }[]
  let maxHiddenGapMs = 0
  let hiddenBeats = 0
  let micStayed = true
  let audioStayed = true
  for (let i = 1; i < beats.length; i++) {
    const a = beats[i - 1]
    const b = beats[i]
    if (!a.visible || !b.visible) maxHiddenGapMs = Math.max(maxHiddenGapMs, b.t - a.t)
    if (!b.visible) {
      hiddenBeats++
      if (!b.mic) micStayed = false
      if (b.ctx !== 'running') audioStayed = false
    }
  }
  const data = { maxHiddenGapMs, hiddenBeats, micStayed, audioStayed }
  if (hiddenBeats === 0) return record('hidden-tab', 'fail', 'no beats while hidden: the tab stopped, or it was never hidden', data)
  if (maxHiddenGapMs <= 1500 && micStayed) return record('hidden-tab', 'pass', `kept running; longest hidden gap ${maxHiddenGapMs} ms`, data)
  await record('hidden-tab', 'partial', `beats continued (longest gap ${maxHiddenGapMs} ms) but mic ${micStayed ? 'stayed' : 'stopped'}, audio ${audioStayed ? 'stayed' : 'stopped'}`, data)
}

export async function probeSherpa(): Promise<void> {
  const box = panel('sherpa-onnx speed: running the benchmark in the worker, about 20 seconds')
  await orca.plugin.request('probe.sherpa', undefined as never, { timeoutMs: 310000 } as never)
  box.remove()
}

export async function startHookTiming(): Promise<void> {
  const box = panel('Hook timing. For each delay: press Arm, then in another terminal run the command shown, and say what happened.')
  const seen: { delayMs: number; waited: boolean }[] = []
  const status = document.createElement('div')
  box.append(status)
  for (const delayMs of [500, 1500, 3000]) {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center'
    row.innerHTML = `<b>${delayMs} ms</b><code>orca terminal send --terminal &lt;handle from orca terminal list&gt; --text "probe ${delayMs}"</code>`
    box.append(row)
    button(row, 'Arm', async () => {
      await orca.plugin.request('probe.hookArm', { delayMs } as never)
      status.textContent = `Armed for ${delayMs} ms. Send the text now.`
    })
    const answer = (waited: boolean) => async () => {
      const r = (await orca.plugin.request('probe.hookResult')) as unknown as { delayMs?: number; waitedMs?: number }
      seen.push({ delayMs, waited })
      status.textContent = `${delayMs} ms: ${waited ? 'after the delay' : 'immediately'} (hook waited ${r.waitedMs ?? '?'} ms)`
      if (seen.length === 3) {
        const honored = seen.filter((s) => s.waited).map((s) => s.delayMs)
        const most = honored.length ? Math.max(...honored) : 0
        await record('hook-timing', most >= 1500 ? 'pass' : 'fail', `Orca waited for ${honored.join(' and ') || 'none'} ms; did not wait for ${seen.filter((s) => !s.waited).map((s) => s.delayMs).join(' and ') || 'none'} ms`, { seen })
      }
    }
    button(row, 'Text appeared immediately', answer(false))
    button(row, 'After the delay', answer(true))
  }
}

export async function startKeybinding(): Promise<void> {
  const box = panel('Talk shortcut: do all three, then press Record')
  await orca.plugin.request('probe.keyResult', { reset: true } as never)
  box.insertAdjacentHTML(
    'beforeend',
    '<ol style="margin:0;padding-left:18px"><li>Click into another Orca tab and press ⌘⌥Space (Ctrl+Alt+Space on Windows/Linux).</li>' +
      '<li>Come back, click inside this tab, and hold ⌥Space (Alt+Space) for about 2 seconds.</li>' +
      '<li>Open Settings → Keyboard shortcuts and look for "Convo Probe: Talk". Can you change its key?</li></ol>'
  )
  let down = 0
  let holdMs = 0
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.altKey && !down) down = performance.now()
  })
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && down) {
      holdMs = Math.round(performance.now() - down)
      down = 0
      shown.textContent = `Held for ${holdMs} ms inside the tab.`
    }
  })
  const shown = document.createElement('div')
  box.append(shown)
  const label = document.createElement('label')
  label.innerHTML = '<input type="checkbox" id="rebind"> I could change the shortcut in Settings'
  box.append(label)
  button(box, 'Record', async () => {
    const { presses } = (await orca.plugin.request('probe.keyResult')) as unknown as { presses: number[] }
    const rebindable = (document.getElementById('rebind') as HTMLInputElement).checked
    const commandPresses = presses.length
    const data = { commandPresses, frameHoldMs: holdMs, rebindable }
    if (!commandPresses) return record('keybinding', 'fail', 'the shortcut never reached the worker', data)
    if (holdMs >= 1500 && rebindable) return record('keybinding', 'pass', `command fired ${commandPresses}×; hold worked in the tab (${holdMs} ms); rebindable`, data)
    await record('keybinding', 'partial', `command fired ${commandPresses}× (press only); hold in tab ${holdMs ? holdMs + ' ms' : 'not seen'}; rebindable: ${rebindable ? 'yes' : 'no'}`, data)
  })
}

export async function showSettingsChange(): Promise<void> {
  panel('Settings change: open Settings → Plugins → Convo Probe and type anything into "Probe · Note". A row appears below by itself if the worker hears it.')
}

register('datadir', async () => {
  await orca.plugin.request('probe.datadir')
})
register('sessionlog', async () => {
  await orca.plugin.request('probe.sessionlog')
})
register('untitled-location', async () => {
  await orca.plugin.request('probe.untitled')
})
register('hook-timing', startHookTiming)
register('keybinding', startKeybinding)
register('settings-change', showSettingsChange)
register('sherpa', probeSherpa)
register('mic', probeMic)
register('speech', probeSpeech)
register('webaudio', probeWebAudio)
register('mockup-iframe', probeMockupIframe)
register('mockup-shadow', probeMockupShadow)
register('dictation', startDictationWatch)
register('hidden-tab', startHeartbeat)
