import { record } from './ui.ts'

const card = document.createElement('section')
card.style.cssText =
  'border:2px solid var(--orca-foreground);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:14px;max-width:900px;margin:20px auto 0'
card.innerHTML = `
<h2 style="margin:0;font-size:18px">Finish the last 3</h2>
<div class="step" id="s1"><b>1 · Dictation</b> <span class="tick" id="t1">○</span>
  <div>Click in the box, then start Orca's dictation the way you normally do and say a sentence. It records by itself when text arrives.</div>
  <textarea id="dict" rows="2" placeholder="Dictate here"></textarea>
  <button id="none1">No text arrived</button></div>
<div class="step" id="s2"><b>2 · Talk shortcut</b> <span class="tick" id="t2">○</span>
  <div>a. Click any other Orca tab and press <b>⌘⌥Space</b>. Presses heard: <b id="presses">0</b></div>
  <div>b. Click this box and hold <b>⌥Space</b> for 2 seconds: <span id="holdbox" tabindex="0" style="display:inline-block;padding:4px 10px;border:1px dashed var(--orca-border);border-radius:6px">click here, then hold ⌥Space</span> Held: <b id="held">0</b> ms</div>
  <div>c. Open Settings → Keyboard shortcuts, look for "Convo Probe: Talk", then answer: <button id="rebindYes">I could change it</button> <button id="rebindNo">I couldn't</button></div></div>
<div class="step" id="s3"><b>3 · Settings change</b> <span class="tick" id="t3">○</span>
  <div><button id="setnow">Change the probe's setting now</button> <span id="setmsg"></span></div></div>`
const style = document.createElement('style')
style.textContent =
  '.step{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--orca-border);padding-top:10px}' +
  '.tick{font-weight:700}.done{color:#2c8a4b}' +
  '#dict{font:inherit;padding:6px;border-radius:6px;border:1px solid var(--orca-border);background:var(--orca-secondary);color:inherit}' +
  '#holdbox:focus{outline:2px solid var(--orca-foreground)}'
document.head.append(style)
document.body.prepend(card)

function tick(n: number): void {
  const t = document.getElementById(`t${n}`) as HTMLSpanElement
  t.textContent = '✓ recorded'
  t.className = 'tick done'
}

const dict = document.getElementById('dict') as HTMLTextAreaElement
let lastKey = 0
let lastType = ''
let dictDone = false
dict.addEventListener('keydown', () => {
  lastKey = Date.now()
})
dict.addEventListener('beforeinput', (e) => {
  lastType = (e as InputEvent).inputType
})
dict.addEventListener('input', () => {
  if (dictDone || !dict.value.trim() || Date.now() - lastKey < 1000) return
  dictDone = true
  void record('dictation', 'pass', `Orca dictation typed into the tab (${lastType || 'unknown input type'})`, { inputType: lastType, text: dict.value }).then(() => tick(1))
})
;(document.getElementById('none1') as HTMLButtonElement).onclick = () => {
  if (dictDone) return
  dictDone = true
  void record('dictation', 'fail', 'Orca dictation did not type into the tab').then(() => tick(1))
}
dict.focus()

let presses = 0
let heldMs = 0
let down = 0
orca.plugin.on('probe.talk', () => {
  presses++
  ;(document.getElementById('presses') as HTMLElement).textContent = String(presses)
})
const holdbox = document.getElementById('holdbox') as HTMLSpanElement
holdbox.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.altKey) {
    e.preventDefault()
    if (!down) down = performance.now()
  }
})
holdbox.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && down) {
    heldMs = Math.max(heldMs, Math.round(performance.now() - down))
    down = 0
    ;(document.getElementById('held') as HTMLElement).textContent = String(heldMs)
  }
})
async function finishKeys(rebindable: boolean): Promise<void> {
  const data = { commandPresses: presses, frameHoldMs: heldMs, rebindable }
  if (!presses) await record('keybinding', 'fail', `the shortcut never reached the worker; hold in tab ${heldMs} ms; rebindable: ${rebindable ? 'yes' : 'no'}`, data)
  else if (heldMs >= 1500 && rebindable) await record('keybinding', 'pass', `command fired ${presses}× (press only); hold worked in the tab (${heldMs} ms); rebindable`, data)
  else await record('keybinding', 'partial', `command fired ${presses}× (press only); hold in tab ${heldMs ? heldMs + ' ms' : 'not seen'}; rebindable: ${rebindable ? 'yes' : 'no'}`, data)
  tick(2)
}
;(document.getElementById('rebindYes') as HTMLButtonElement).onclick = () => void finishKeys(true)
;(document.getElementById('rebindNo') as HTMLButtonElement).onclick = () => void finishKeys(false)

orca.plugin.on('probe.changed', async () => {
  const got = (await orca.plugin.request('probe.results')) as unknown as { id: string }[]
  if (Array.isArray(got) && got.some((r) => r.id === 'settings-change')) tick(3)
})
;(document.getElementById('setnow') as HTMLButtonElement).onclick = async () => {
  await orca.settings.set('probeNote', `changed ${new Date().toISOString()}`)
  ;(document.getElementById('setmsg') as HTMLElement).textContent = 'Changed. Waiting for the worker…'
}
