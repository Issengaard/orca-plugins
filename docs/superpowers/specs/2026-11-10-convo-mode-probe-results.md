# Convo Mode probe results

Orca 1.4.255 · macOS (darwin arm64) · 2026-11-10 · probe: `spikes/convo-probe` (never released), benchmark: `spikes/convo-bench`

**How recorded:** *probe* means the probe measured and recorded it. *hand* means Claude recorded it from what Aamon reported, or from facts read directly, because the probe's own run was misleading or needed a person (see each row and the ledger). *both* means the probe measured it and a hand check added the cause.

Windows and Linux: not run. Every answer below is from Aamon's Mac. The Orca and plugin-API findings (1, 2, 9, 10, 12) come from Orca's own code, so they are likely the same everywhere. The speed numbers (5) and the folder (6) are Mac-only facts.

| Q | Probe | Result | How recorded | Detail |
| --- | --- | --- | --- | --- |
| 1 | Orca dictation types into the tab | fail | hand | Aamon: Orca dictation (Cmd+E) did not type into the plugin tab, though it works elsewhere in Orca. Not settled: whether Cmd+E even reached Orca while focus was inside the tab's isolated frame, or reached it and then couldn't type there. macOS system dictation (fn) did type into the tab (insertCompositionText), but that is Mac-only and outside Orca. |
| 2 | Microphone in the tab | fail | both | getUserMedia refused with NotAllowedError although macOS allows Orca the microphone and Orca dictation works: Orca blocks the microphone for plugin tabs |
| 3 | Speech synthesis in the tab | pass | both | Aamon heard the voice say the test sentence; getVoices() listed 0 voices at the time, so voice choice may need to wait for voiceschanged |
| 3 | Web Audio playback from the worker | pass | probe | played a 1 s tone from the worker |
| 4 | Mockup in an iframe with scripts | pass | probe | srcdoc iframe loaded and its script ran |
| 4 | Mockup in a shadow root with scripts | pass | probe | HTML shown and its script ran |
| 5 | sherpa-onnx WebAssembly speed | partial | probe | under Orca's Node (child of the worker): STT RTF 0.30, piper 239 ms, kokoro 2733 ms; kokoro first audio 2733 ms > 1000 ms |
| 6 | Where models can be stored | pass | probe | wrote, read and removed 1 MB in /Users/aamonnaig/Library/Application Support/convo-mode/probe |
| 7 | Terminal matched to its session log | partial | hand | The probe matched a Claude agent whose worktree was the focused one (rhettworks/file-uploads-2). It missed this session, but the probe searched under the focused workspace's folder for every agent, so the miss is partly a probe bug. Checked by hand: this session started in ~ and its log is under -Users-aamonnaig, not under convo-mode, so a log can sit outside its workspace's folder. Matching should search recent logs by content. |
| 8 | Tab keeps running while hidden | fail | hand | could not start: the heartbeat needs the microphone, which Orca refuses in plugin tabs. Re-run without the mic if voice capture moves to the worker. |
| 9 | Where New Convo files land | partial | hand | inside the worktree and shown by git status: untitled-2.convoprobe |
| 10 | How long Orca waits on a hook | pass | hand | Orca waited for 500 ms (CLI returned in 646 ms) and 1500 ms (1639 ms); at 3000 ms it went ahead at 2138 ms, so it waits about 2 s, as the typings say |
| 11 | Talk shortcut: press, hold and rebind | partial | hand | Not settled: Cmd+Alt+Space never reached the worker (0 presses; macOS takes it for Finder search) and Alt+Space types a special space on a Mac. Aamon: no talk shortcut for now; the mic button is the way to talk. Whether a plugin shortcut can be rebound in Settings is still untested. |
| 12 | Worker hears settings changes | pass | probe | worker heard a change to "probeNote" |

## Benchmark detail (question 5)

These are numbers for sherpa-onnx 2.0.1 WebAssembly with piper-phonemize 1.5.9, run by the worker as a child process of Orca's own binary (`Orca Helper`, `ELECTRON_RUN_AS_NODE`, Node 24.22.1). That's the same V8 and Node the worker uses, not the worker process itself. The command line on Node 22 gave the same numbers within 10%.

| Engine | Load | Speed | Result |
| --- | --- | --- | --- |
| Parakeet TDT 0.6B v3 int8 (hearing you) | 0.5–0.6 s | 0.30× real time | Transcript exact: "Collapse the duplicates into one row with a count, then show me the plan." |
| Silero VAD (turn-taking) | — | 0.003× real time | fine |
| Piper en_US lessac medium | 0.4 s | first sentence 239 ms, two sentences 524 ms | fast enough |
| Kokoro en v0.19 | 0.4 s | first sentence 2.7 s, two sentences 7.5 s | **slower than real time** |

- **The WebAssembly build runs on one thread.** Its own log says: "WASM does not support multi-threading".
- **sherpa-onnx 2.x dropped built-in phonemization.** Piper and Kokoro need `piper-phonemize`, which is also WebAssembly.
- **Models total about 1.1 GB.** Parakeet is 670 MB, Kokoro 369 MB, Piper 81 MB and VAD 1 MB. Orca already ships the same Parakeet model in its speech-models folder.

## Also found while probing

- **Orca counts every file in a plugin's folder against the 50 MiB limit,** including git-ignored ones (load error: "plugin exceeds the 52428800-byte limit"). Models and `node_modules` must live outside the plugin folder.
- **Orca bug with development plugins.** `orca plugin dev load` and `reload` regenerate `<plugin>/.orca/` after recording the folder's fingerprint, and the worker's start-up check then fails with "content hash mismatch". The workaround is to delete `.orca/`, then unload, load and approve. It's worth reporting to Orca. For the same reason, the probe's `tsconfig.json` reads Orca's types from `spikes/.orca-probe-types/`, outside the plugin. To regenerate them: `orca plugin types spikes/convo-probe`, then move its `.orca/` there.
- **`orca terminal send` with an empty `--terminal` value sends to the calling terminal** (`ORCA_TERMINAL_HANDLE`) instead of failing. A plugin or agent must check the handle before sending.
- **A hook that runs past 2 s is skipped,** and Orca logs "hook terminal.send skipped after 2001ms".

- **"Focused workspace" isn't always the one you're looking at.** While the probe tab was open in convo-mode, `workspace.readContext` answered rhettworks/file-uploads-2. That's why the Q9 probe searched the wrong worktree, and partly why Q7 missed. The probe can't tell whether Orca's focus differed from the visible tab, or whether the tab was opened from another workspace. This matters to the design, because a new Convo starts with "the agent in the focused workspace" and `agents.list` only covers that workspace. The first core plan must check `readContext` from inside the Convo tab while it's in front.

## What this means for the build

1. **Hearing you (Q1, Q2):** the design's main path is blocked. Orca refuses the microphone to plugin tabs, and Orca's dictation doesn't type into them. The choice of a new path is Aamon's, in the section below.
2. **Speaking (Q3):** stands. Both the tab's speech synthesis and audio played from the worker work. The System voice should wait for `voiceschanged` before listing voices.
3. **Mockups on the stage (Q4):** stands. Interactive mockups run their own scripts in a `srcdoc` iframe. Use the iframe (sandbox `allow-scripts`) rather than a shadow root, to keep a mockup's styles and scripts away from the tab's own.
4. **Speech engine (Q5):**
   - Parakeet, VAD and Piper are fast enough.
   - Kokoro is slower than real time in WebAssembly, so it can't keep up with conversation. Whether to drop it from v1 is Aamon's call, below.
   - The plugin needs `piper-phonemize` alongside sherpa-onnx.
   - On machines where Orca already has the Parakeet model, link to Orca's copy instead of downloading it again.
5. **Where downloads go (Q6):** stands. Use the per-OS data folder (`~/Library/Application Support/convo-mode` on Mac), never the plugin folder.
6. **Reading replies (Q7):** stands, with a change. Match a terminal to a Claude log by content across recently modified logs, not only the workspace's folder, because a session's log lives under the folder it started in.
7. **Hidden tab (Q8):** not needed for v1. Voice pauses when you leave the tab (Aamon, 2026-11-10). Re-run without the mic if voice ever has to continue in other tabs.
8. **New Convo files (Q9):**
   - The tab's file lands at the worktree root and git sees it.
   - Conversations still live in plugin storage, as designed.
   - The empty `.convo` file needs keeping out of commits. Builder's call: the worker adds `*.convo` to that repo's local `.git/info/exclude`, which is never committed, the first time it sees one, and says so once in the conversation.
9. **Orchestrator checks (Q10):** stand, with a hard limit. Every hook check must decide within 2 s, so the worker's check is a lookup against the rules and the manager's recorded approvals, never a model call.
10. **Shortcut (Q11):** dropped from v1 (Aamon). The mic button is the way to talk. The "Talk shortcut" setting and the double-tap hands-free option come out of the settings list.
11. **Settings (Q12):** stands. Use `orca.settings.onDidChange` in the worker.
