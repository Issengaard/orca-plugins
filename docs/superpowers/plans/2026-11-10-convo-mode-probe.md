# Convo Mode Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a throwaway Orca plugin that answers the twelve unproven questions in the Convo Mode design inside a real Orca tab, and writes down the answers so the real plugin's plans can be written from facts.

**Architecture:** A `trusted-worker` plugin at `spikes/convo-probe/`. It has:
- a custom editor tab, opened from the **+** menu as **New Convo Probe**, with one button per probe
- a TypeScript worker that runs the worker-side probes and stores every result
- a standalone Node benchmark for the sherpa-onnx WebAssembly speech engine

Each probe records a `ProbeResult`. The worker renders all results into a Markdown report. The last task turns that report into `docs/superpowers/specs/2026-11-10-convo-mode-probe-results.md`.

**Tech Stack:** Orca plugin API 1 (Orca 1.4.255 installed), TypeScript loaded as written with no build step, Node built-ins, `node:test`, and `sherpa-onnx` (the npm WebAssembly build) for the benchmark only.

**Spec:** `docs/superpowers/specs/2026-11-10-convo-mode-design.md`, section "Unproven: prove these first".

## Global Constraints

- **Never released.** The folder lives at `spikes/convo-probe/`, outside `plugins/`. Never add it to `orca-catalog.json`. Load it only with `orca plugin dev load`.
- **No comments in source:** no inline comments, block comments or docstrings. The gate is `~/.claude/hooks/check_source_comments.py`.
- **`engines.orca` is `">=1.4.248"`.** Hooks need 1.4.248.
- **Frame code imports only `orca`, `orca/*` and relative files.** No npm packages in the frame.
- **Don't commit `node_modules/`, downloaded models or `.orca/`.** Add `spikes/convo-probe/.gitignore` for them.
- **Approving the plugin's access is Aamon's call.** When `orca plugin dev load` exits 3 (`approval_required`), show him the listed access and the `--approve` command. Never approve on his behalf.
- **The probes run on whatever systems Aamon has.** Results for Windows or Linux that weren't run are recorded as "not run", never guessed.
- **Free only.** No paid services or APIs. Models come from the public `k2-fsa/sherpa-onnx` GitHub releases.
- **Commits go on branch `aamonnaig4/convo-mode`** and end with the session's attribution lines.

## Review Focus

- **A probe run when no agent is in the focused workspace** reports `fail` with "no agents in this workspace". It doesn't throw. Pinned in Task 4.
- **Microphone permission denied** reports `fail` with the error's name (`NotAllowedError`) within 10 seconds, rather than hanging. Pinned in Task 2.
- **Running the same probe twice** replaces its earlier result instead of adding a second row. Pinned in Task 1.
- **A workspace path containing dots or spaces** still finds the right Claude log folder, for example `/Users/x/.claude` → `-Users-x--claude`. Pinned in Task 4.
- **Probes that never ran** show as "not run" in the report, so silence isn't read as a pass. Pinned in Task 1.

---

### Task 1: Probe plugin skeleton and the results model

**Files:**
- Create: `spikes/convo-probe/orca-plugin.json`
- Create: `spikes/convo-probe/.gitignore`
- Create: `spikes/convo-probe/tsconfig.json`
- Create: `spikes/convo-probe/src/results.ts`
- Create: `spikes/convo-probe/src/worker.ts`
- Create: `spikes/convo-probe/frame/probe.html`
- Create: `spikes/convo-probe/frame/probe.ts`
- Test: `spikes/convo-probe/tests/results.test.mjs`

**Interfaces:**
- Produces, in `src/results.ts`:
  - `type ProbeId` = `'dictation' | 'mic' | 'speech' | 'webaudio' | 'mockup-iframe' | 'mockup-shadow' | 'sherpa' | 'datadir' | 'sessionlog' | 'hidden-tab' | 'untitled-location' | 'hook-timing' | 'keybinding' | 'settings-change'`
  - `const PROBES: readonly { id: ProbeId; question: number; title: string }[]`, one entry per id. `question` is the spec's unproven-item number (1–12). `mockup-iframe` and `mockup-shadow` both map to 4, and `speech` and `webaudio` both map to 3.
  - `type ProbeStatus = 'pass' | 'fail' | 'partial'`
  - `type ProbeResult = { id: ProbeId; status: ProbeStatus; detail: string; data?: Record<string, unknown>; at: number }`
  - `recordResult(list: ProbeResult[], r: ProbeResult): ProbeResult[]`
  - `renderReport(list: ProbeResult[], meta: { orca: string; platform: string; arch: string; when: string }): string`
- Produces, in the worker, panel handlers:
  - `'probe.record'`: input `Omit<ProbeResult,'at'>`, output `{ ok: true }`. Stores under storage key `'results'`.
  - `'probe.results'`: output `ProbeResult[]`
  - `'probe.report'`: output `{ markdown: string }`
- Produces, in the frame: `record(id: ProbeId, status: ProbeStatus, detail: string, data?: object): Promise<void>`, which calls `orca.plugin.request('probe.record', …)`, and a button list built from `PROBES`.

- [ ] **Step 1: Write the failing tests** in `tests/results.test.mjs`:
  - `test('recording a probe twice keeps only the newest')`: record `mic` fail at 1, then `mic` pass at 2. Expect length 1, status `'pass'`, `at === 2`.
  - `test('report lists every probe, with not run for missing ones')`: record only `mic` pass. `renderReport` contains `| 2 | Microphone in the tab | pass |` and `| 1 | Orca dictation types into the tab | not run |`. It has exactly `PROBES.length` table rows.
  - `test('report header names Orca version and platform')`: with meta `{orca:'1.4.255',platform:'darwin',arch:'arm64',when:'2026-11-10'}`, the output starts with `# Convo Mode probe results` and contains `Orca 1.4.255 · darwin arm64 · 2026-11-10`.
  - `test('detail with a pipe or newline does not break the table')`: detail `'a|b\nc'` renders as `a\|b c`.
- [ ] **Step 2: Run** `cd spikes/convo-probe && node --test tests/` and expect FAIL: module `../src/results.ts` not found.
- [ ] **Step 3: Implement `recordResult` and `renderReport` in `src/results.ts`.** The report is the header line, then one row per `PROBES` entry in order: `| question | title | status or not run | detail |`.
- [ ] **Step 4: Run** `node --test tests/` and expect PASS (4 tests).
- [ ] **Step 5: Write the manifest.**
  - `id: "convo-probe"`, `name: "Convo Probe"`, `version: "0.0.1"`, `execution: "trusted-worker"`, `main: "src/worker.ts"`, `pluginApi: 1`, `engines.orca: ">=1.4.248"`, `manifestVersion: 2`
  - `contributes.customEditors`: `[{ id: "probe", title: "Convo Probe", extensions: [".convoprobe"], entry: "frame/probe.html" }]`
  - `contributes.newFiles`: `[{ id: "probe", title: "New Convo Probe", extension: ".convoprobe" }]`
  - capabilities: `storage:own`, `settings:own`, `agent:read`, `workspace:read`, `terminal:read`, `terminal:send`
  - `tsconfig.json` like `plugins/now-playing/tsconfig.json`. `.gitignore` lists `node_modules/`, `.orca/`, `bench/models/`, `bench/node_modules/`.
- [ ] **Step 6: Write the worker's `activate(orca)` with the three handlers above, and the frame.** The frame has one button per probe (label = `title`), a results list that refreshes after each record, and a **Show report** button that renders `probe.report`'s Markdown as plain preformatted text. Each probe's button does nothing yet except record `partial` "not implemented".
- [ ] **Step 7: Validate and load.**
  - Run `orca plugin validate spikes/convo-probe --json` and expect exit 0.
  - Run `npx tsc -p spikes/convo-probe` and expect no errors.
  - Run `orca plugin dev load spikes/convo-probe --json`. On exit 3, stop and give Aamon the access list and approve command.
  - After he approves, check that **New Convo Probe** appears in the **+** menu and opens the tab with the buttons.
- [ ] **Step 8: Commit**

```bash
git add spikes/convo-probe
git commit -m "spike(convo-probe): plugin skeleton and results report"
```

### Task 2: Probes that run inside the tab (questions 1, 2, 3, 4, 8)

**Files:**
- Create: `spikes/convo-probe/src/tone.ts`
- Create: `spikes/convo-probe/frame/probes.ts`
- Modify: `spikes/convo-probe/frame/probe.ts` (wire the buttons)
- Modify: `spikes/convo-probe/src/worker.ts` (add `probe.tone`, `probe.mockup` and `probe.heartbeat`)
- Test: `spikes/convo-probe/tests/tone.test.mjs`

**Interfaces:**
- Consumes: `record(...)` and `ProbeId` from Task 1.
- Produces, in `src/tone.ts`: `sineWavePcm16(hz: number, seconds: number, sampleRate: number): { base64: string; samples: number }`. Little-endian 16-bit mono.
- Produces, as worker handlers:
  - `'probe.tone'` → `{ base64, sampleRate: 24000 }` for 440 Hz over 1 s
  - `'probe.mockup'` → `{ html }`: a small page whose inline script sets `document.body.dataset.ran = "yes"` and calls `parent.postMessage({ mockupRan: true }, '*')`
  - `'probe.heartbeat'`: input `{ t: number; visible: boolean; ctx: string; mic: boolean }`, output `{ ok: true }`. It appends to storage key `'beats'`, keeping at most 600 beats.
- Produces, in `frame/probes.ts`, one exported async function per probe: `probeMic()`, `probeSpeech()`, `probeWebAudio()`, `probeMockupIframe()`, `probeMockupShadow()`, `startDictationWatch()`, `startHeartbeat()`, `finishHiddenTab()`. Each calls `record` exactly once with its `ProbeId`, except the two `start*` functions, which record when their finish condition is met.

- [ ] **Step 1: Write the failing tests** in `tests/tone.test.mjs`:
  - `test('one second at 24 kHz is 24000 samples')`: `samples === 24000`, and the base64 decodes to 48000 bytes.
  - `test('first sample is zero and peak is near full scale')`: decode the base64. Sample 0 is 0, and the largest absolute value is between 30000 and 32767.
- [ ] **Step 2: Run** `node --test tests/` and expect the tone tests to FAIL.
- [ ] **Step 3: Implement `sineWavePcm16` in `src/tone.ts`.** Amplitude is 0.95 of full scale.
- [ ] **Step 4: Run** `node --test tests/` and expect PASS (6 tests).
- [ ] **Step 5: Implement the frame probes in `frame/probes.ts`.** Pinned values and outcomes:
  - **`probeMic`:**
    - Call `navigator.mediaDevices.getUserMedia({ audio: true })` with a 10-second timeout.
    - On success, read 2 seconds of levels through an `AnalyserNode` and stop the track. Record `pass` with `data: { sampleRate, peakLevel, labels }`, where `labels` are the audio input names from `enumerateDevices()`.
    - On an error, record `fail` with `detail` = the error's `name` and `message`.
    - On timeout, record `fail` "no answer in 10 s".
  - **`probeSpeech`:**
    - Record `fail` if `speechSynthesis` is missing.
    - Otherwise speak "Convo probe, testing one two three". Record `pass` on the utterance's `end` event, with `data: { voices: getVoices().length }`. Record `fail` on `error` or after 15 s.
  - **`probeWebAudio`:**
    - Get `probe.tone`, decode it into an `AudioBuffer`, and play it.
    - Record `pass` on `onended`, with `data: { contextState }`. Record `fail` on an exception or if the context stays `suspended` after `resume()`.
  - **`probeMockupIframe`:**
    - Put `probe.mockup` HTML into an `<iframe srcdoc sandbox="allow-scripts">`.
    - Record `pass` if a `{ mockupRan: true }` message arrives within 3 s, `partial` "loaded, scripts did not run" if it only loads, and `fail` if it never loads.
  - **`probeMockupShadow`:**
    - Put the same HTML in a shadow root, then re-create each `<script>` as a new element so it executes.
    - Record `pass` if `data-ran` becomes `"yes"`, `partial` if the HTML shows but the script didn't run, and `fail` on an exception.
  - **`startDictationWatch`:**
    - Add a text box labeled "Dictate here with Orca's dictation". Listen for `beforeinput` and `input`.
    - When text appears and the last key press was over 1 s earlier, record `pass` with `data: { inputType, text }`. A manual check button, **Nothing arrived**, records `fail`.
  - **`startHeartbeat` and `finishHiddenTab`:**
    - Every 1000 ms, send `probe.heartbeat` with `document.visibilityState === 'visible'`, the `AudioContext` state, and whether a mic track is live. Start the mic and a looping silent `AudioContext` first.
    - **Finish hidden-tab test** fetches the beats. The largest gap between beats sent while hidden decides the result: `pass` if every hidden gap is at most 1500 ms and the mic stayed live, `partial` if beats continued but the mic or audio stopped, `fail` if beats stopped. Record `data: { maxHiddenGapMs, hiddenBeats }`.
- [ ] **Step 6: Run** `npx tsc -p spikes/convo-probe` and `orca plugin check spikes/convo-probe --json`, and expect both to exit 0.
- [ ] **Step 7: Run the probes with Aamon in Orca.**
  - Open **New Convo Probe** and press **Microphone**, **Speech**, **Web Audio**, **Mockup in iframe** and **Mockup in shadow root**, in that order.
  - For dictation, Aamon focuses the text box and uses Orca's dictation shortcut.
  - For the hidden tab, press **Start heartbeat**, switch to another Orca tab for 20 s, come back, and press **Finish hidden-tab test**.
  - Expected: each button adds one row to the results list. None is left at `partial` "not implemented".
- [ ] **Step 8: Commit**

```bash
git add spikes/convo-probe
git commit -m "spike(convo-probe): mic, speech, audio, mockup, dictation and hidden-tab probes"
```

### Task 3: sherpa-onnx WebAssembly benchmark (question 5)

**Files:**
- Create: `spikes/convo-probe/bench/package.json`
- Create: `spikes/convo-probe/bench/fetch-models.mjs`
- Create: `spikes/convo-probe/bench/bench.mjs`
- Create: `spikes/convo-probe/bench/thresholds.mjs`
- Modify: `spikes/convo-probe/src/worker.ts` (add `probe.sherpa`)
- Test: `spikes/convo-probe/tests/thresholds.test.mjs`

**Interfaces:**
- Produces, in `bench/thresholds.mjs`: `judge(m: { sttRtf: number; vadRtf: number; ttsFirstAudioMs: { piper: number; kokoro: number } }): { status: 'pass'|'partial'|'fail'; reasons: string[] }`. The rules:
  - `pass` when `sttRtf <= 0.5`, `vadRtf <= 0.05`, and both TTS first-audio times are at most 1000 ms.
  - `fail` when `sttRtf > 1.0`, or when both TTS times exceed 3000 ms.
  - Otherwise `partial`, with one reason per missed threshold, such as `"kokoro first audio 1840 ms > 1000 ms"`.
- Produces, in `bench/bench.mjs`: run with `node bench.mjs [--json]`. It prints `{ versions, sttRtf, vadRtf, ttsFirstAudioMs, judge }` and exits 0 even when the judgment is `fail`.
- Produces, as a worker handler: `'probe.sherpa'` → runs `bench.mjs --json` with `child_process.execFile(process.execPath, …)` and records `sherpa` with `judge`'s status and the measurements as `data`. Running under Orca's own Node binary is part of what this proves.

- [ ] **Step 1: Write the failing tests** in `tests/thresholds.test.mjs`:
  - `test('fast numbers pass')` with `{sttRtf:0.3,vadRtf:0.01,ttsFirstAudioMs:{piper:400,kokoro:900}}` gives `pass` and `reasons` `[]`.
  - `test('slow kokoro is partial with a reason')` with Kokoro at 1840 gives `partial`, and `reasons` includes `'kokoro first audio 1840 ms > 1000 ms'`.
  - `test('speech-to-text slower than real time fails')` with `sttRtf: 1.2` gives `fail`.
- [ ] **Step 2: Run** `node --test tests/` and expect the threshold tests to FAIL.
- [ ] **Step 3: Implement `judge` in `bench/thresholds.mjs`.**
- [ ] **Step 4: Run** `node --test tests/` and expect PASS (9 tests).
- [ ] **Step 5: Set up the benchmark.**
  - `bench/package.json` depends on `sherpa-onnx` at an exact version: the newest release at least two weeks old, recorded in the results.
  - `fetch-models.mjs` downloads and unpacks these into `bench/models/`, from the `k2-fsa/sherpa-onnx` GitHub releases:
    - `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` (asr-models)
    - `silero_vad.onnx` (asr-models)
    - `vits-piper-en_US-lessac-medium` (tts-models)
    - `kokoro-en-v0_19` (tts-models)
  - It skips files already present and prints the total MB.
  - Run `cd spikes/convo-probe/bench && npm install && node fetch-models.mjs`. Expect `node_modules/sherpa-onnx` to exist and the four model folders or files to be present.
- [ ] **Step 6: Implement `bench.mjs` with these measurements:**
  - **Speech-to-text:** transcribe a 10-second 16 kHz WAV. Make it by synthesizing "Collapse the duplicates into one row with a count, then show me the plan" with Piper and padding it with silence to 10 s. `sttRtf` = processing time ÷ audio length. Also print the transcript.
  - **Voice detection:** run Silero VAD over the same WAV. `vadRtf` is measured the same way.
  - **Text-to-speech:** for Piper and Kokoro, the milliseconds from the call to the first audio samples for the 15-word sentence "Here is a first pass. The two copies of the submittal draft are marked Duplicate."
- [ ] **Step 7: Run** `node bench.mjs`. Expect JSON with all fields and a transcript that includes "duplicates" and "plan". Then press **sherpa-onnx speed** in the probe tab and expect a `sherpa` row whose numbers are close to the command-line run.
- [ ] **Step 8: Commit**

```bash
git add spikes/convo-probe/bench/package.json spikes/convo-probe/bench/*.mjs spikes/convo-probe/tests/thresholds.test.mjs spikes/convo-probe/src/worker.ts
git commit -m "spike(convo-probe): sherpa-onnx wasm benchmark"
```

### Task 4: Probes that run in the worker (questions 6, 7, 9, 10, 11, 12)

**Files:**
- Create: `spikes/convo-probe/src/datadir.ts`
- Create: `spikes/convo-probe/src/logs.ts`
- Modify: `spikes/convo-probe/src/worker.ts`
- Modify: `spikes/convo-probe/orca-plugin.json` (add commands, keybindings, hooks, settings)
- Modify: `spikes/convo-probe/frame/probe.ts` (buttons for these probes)
- Test: `spikes/convo-probe/tests/datadir.test.mjs`
- Test: `spikes/convo-probe/tests/logs.test.mjs`
- Test fixtures: `spikes/convo-probe/tests/fixtures/claude-session.jsonl`

**Interfaces:**
- Produces, in `src/datadir.ts`: `dataDir(platform: NodeJS.Platform, env: Record<string,string|undefined>, home: string): string`. It returns:
  - on `darwin`: `<home>/Library/Application Support/convo-mode`
  - on `win32`: `<APPDATA or <home>/AppData/Roaming>/convo-mode`
  - otherwise: `<XDG_DATA_HOME or <home>/.local/share>/convo-mode`
- Produces, in `src/logs.ts`:
  - `claudeProjectDir(home: string, cwd: string): string`, which is `<home>/.claude/projects/<cwd with every character outside [A-Za-z0-9] replaced by ->`
  - `pickSession(files: { path: string; mtimeMs: number }[], sinceMs: number): string | null`, the newest file modified at or after `sinceMs`
  - `lastAssistantText(jsonl: string): string | null`, the text of the last line whose `type` is `"assistant"`, joining that message's `content` items of type `"text"`
- Produces, as worker handlers:
  - `'probe.datadir'`
  - `'probe.sessionlog'`
  - `'probe.untitled'`
  - `'probe.hookArm'`: input `{ delayMs: number }`
  - `'probe.hookResult'`
  - `'probe.keyResult'`

  Each records its own `ProbeId` once.
- Produces, as manifest additions:
  - **Command** `{ id: "convo-probe.talk", title: "Convo Probe: Talk" }`, with **keybinding** `{ command: "convo-probe.talk", key: "Mod+Alt+Space" }`
  - **Hook** `{ event: "terminal.send", onError: "pass" }`
  - **Setting** `{ key: "probeNote", title: "Probe · Note", type: "string", default: "" }`

- [ ] **Step 1: Write the failing tests.**
  - In `tests/datadir.test.mjs`:
    - `test('mac data dir')` with `('darwin', {}, '/Users/x')` gives `/Users/x/Library/Application Support/convo-mode`.
    - `test('windows uses APPDATA')` with `('win32', {APPDATA:'C:\\Users\\x\\AppData\\Roaming'}, 'C:\\Users\\x')` gives a path ending `convo-mode` that starts with the APPDATA value.
    - `test('linux honors XDG_DATA_HOME')` with `('linux', {XDG_DATA_HOME:'/data'}, '/home/x')` gives `/data/convo-mode`, and with `{}` gives `/home/x/.local/share/convo-mode`.
  - In `tests/logs.test.mjs`:
    - `test('dots and slashes become dashes')`: `claudeProjectDir('/Users/x','/Users/x/.claude')` ends with `/projects/-Users-x--claude`.
    - `test('spaces become dashes')`: `/Users/x/My Repo` gives `-Users-x-My-Repo`.
    - `test('newest session since launch wins')`: files at mtimes 100, 300 and 200 with `sinceMs` 150 give the 300 one. With `sinceMs` 400, it gives `null`.
    - `test('last assistant text joins text parts')`: on the fixture, the result is `'Done. Drafts dedupe on the server now.'`. The fixture's last assistant line has two text parts and one `tool_use` part, and a later `user` line.
- [ ] **Step 2: Run** `node --test tests/` and expect the new tests to FAIL.
- [ ] **Step 3: Implement `dataDir`, `claudeProjectDir`, `pickSession` and `lastAssistantText`.**
- [ ] **Step 4: Run** `node --test tests/` and expect PASS (16 tests).
- [ ] **Step 5: Implement the worker probes:**
  - **`probe.datadir`:** create `dataDir(...)/probe`, write and read back a file of 1 MB of random bytes, then delete it. Record `pass` with `data: { path }`, or `fail` with the error code.
  - **`probe.sessionlog`:** call `agents.list`.
    - If it's empty, record `fail` "no agents in this workspace".
    - For each Claude agent, find its workspace path from `workspace.list`. Call `pickSession` on `claudeProjectDir`'s `*.jsonl` files, with `sinceMs` = the agent's `stateStartedAt` minus 24 h. Compare `lastAssistantText` with the last 200 lines of `terminal.read`: it matches when the first 40 characters of the text appear in the terminal output.
    - For Codex agents, search `~/.codex` up to depth 4 for `*.jsonl` and record where they are.
    - For Grok agents, record the last 20 terminal lines as a sample.
    - Record `pass` if every Claude agent matched, `partial` if some did, and `fail` if none did. Put `data` per agent.
  - **`probe.untitled`:** for the focused workspace's path from `workspace.list`, find `*.convoprobe` files up to depth 4 and run `git status --porcelain` there.
    - Record `data: { found, inGitStatus }`.
    - Record `pass` if a file exists but git doesn't list it, `partial` if git lists it, and `fail` if none is found, which means it lives outside the worktree. In that case, also search the home directory up to depth 3, excluding `Library` and `node_modules`.
  - **`probe.hookArm` and the `terminal.send` hook:**
    - `hookArm` stores `delayMs`.
    - On the next `terminal.send` event, the hook notes when it arrived, waits `delayMs`, stores when it released, and calls `next()`.
    - `probe.hookResult` records `data: { delayMs, waitedMs }`.
    - Aamon arms with 500, then 1500, then 3000. Each time he runs `orca terminal send --terminal <handle> --text "probe <delay>"` from another terminal and notes whether the text appeared after the delay or immediately.
    - The frame has a **Text appeared immediately** button and an **After the delay** button. The result is `pass` when the longest delay Orca honored is at least 1500 ms. The detail names the cutoff.
  - **`convo-probe.talk` and `probe.keyResult`:**
    - The command handler stores each press time.
    - The frame logs `keydown` and `keyup` for `Alt+Space` while it has focus.
    - The frame asks Aamon to:
      1. press ⌘⌥Space while another tab is focused
      2. hold ⌥Space in the probe tab for 2 s
      3. check whether **Settings → Keyboard shortcuts** lists "Convo Probe: Talk" and lets him change it
    - Record `data: { commandPresses, frameHoldMs, rebindable }` and the status:
      - `pass` if all three work
      - `partial` if the command fires but hold works only while the tab is focused, which is the design's toggle fallback
      - `fail` if the command never fires
  - **`settings-change`:** `orca.settings.onDidChange` records `pass` with the changed key as soon as Aamon edits **Probe · Note** in Settings → Plugins → Convo Probe.
- [ ] **Step 6: Validate and load again.**
  - Run `npx tsc -p spikes/convo-probe`, `orca plugin validate spikes/convo-probe --json` and `orca plugin check spikes/convo-probe --json`, and expect all to exit 0.
  - Reload with `orca plugin dev load spikes/convo-probe --json`. The new capabilities and hook print a new approval, which goes to Aamon.
- [ ] **Step 7: Run each worker probe from the tab with Aamon**, as described in Step 5. Expect each to add one row.
- [ ] **Step 8: Commit**

```bash
git add spikes/convo-probe
git commit -m "spike(convo-probe): data dir, session log, untitled file, hook timing, shortcut and settings probes"
```

### Task 5: Results document and spec update

**Files:**
- Create: `docs/superpowers/specs/2026-11-10-convo-mode-probe-results.md`
- Modify: `docs/superpowers/specs/2026-11-10-convo-mode-design.md` (the "Unproven" section)

**Interfaces:**
- Consumes: `probe.report` from Task 1, and every recorded result.

- [ ] **Step 1: Generate the report.** Press **Show report** in the probe tab and copy the Markdown into the results document. Expect 14 rows with no "not run" except platforms Aamon doesn't have.
- [ ] **Step 2: Add a "What this means for the build" section** under the table, with one line per question: the design path that stands, or the fallback the design names. Examples:
  - Q2 fails → worker-side mic capture
  - Q4 partial → mockups shown without scripts
  - Q11 partial → Orca-wide shortcut is a toggle; hold works in the focused tab
- [ ] **Step 3: Update the spec.** In the "Unproven" section, change each item to "Proven: …" or "Failed: …", with a link to the results document. If any failure changes what gets built (voice in, the mockup stage, or the shortcut), stop and bring it to Aamon before the next plan is written.
- [ ] **Step 4: Run the no-comments gate** over every source file in the spike: `python3 ~/.claude/hooks/check_source_comments.py` (this repo has no copy of its own). Expect no findings.
- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-11-10-convo-mode-probe-results.md docs/superpowers/specs/2026-11-10-convo-mode-design.md
git commit -m "docs(convo-mode): probe results and what they change"
```

---

## The plans that follow (written after the probe results)

Each produces working, testable software on its own, and gets its own plan once the probe answers are in:

1. **Core:**
   - the plugin manifest and settings (all 36, from `mockup-round-10-settings.html`)
   - the `.convo` tab
   - the agent menu and per-agent threads in plugin storage
   - typed messages to agents and their written replies, through session logs or `terminal.read`
   - the status bar items

   No voice yet.
2. **Voice:**
   - the speech engine and model downloads
   - voice in, with live words, unsure-word underlines and the 3-second hold
   - Auto and Manual turns, talking over the agent, and the Listening chip
   - voice out with System, Kokoro or Piper, and per-kind voices
   - the spoken-summary line on messages sent from Convo
   - the shortcut, per the probe result
3. **Stage:**
   - detecting what an agent shows
   - mockups, plans, diffs and screenshots on stage
   - the strip, flashes, the pill and its hover history
4. **Orchestrator:**
   - launching the manager
   - hook checks with the always-blocked list
   - action lines and the lane board
   - the "can't approve" card, and "patch me through"
5. **States and polish:** first open, mic blocked, downloads in progress, quiet agents, no agents, theme checks across Aamon's installed themes, and the catalog release with visual verification per `AGENTS.md`.
