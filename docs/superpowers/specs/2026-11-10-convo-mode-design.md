# Convo Mode: talk to your agents in Orca

Date: 2026-11-10 · Plugin: `plugins/convo-mode` (new) · Branch: `aamonnaig4/convo-mode` · Prototype: `docs/design/convo-mode/convo-final.html` · Round pages: `docs/design/convo-mode/mockup-round-*.html`

## Why

Aamon plans by talking things through: explain what he wants, let the agent ask questions, look at a mockup, tweak, then send agents off to build. Today that loop is typed, and every handoff is manual. The agent writes a mockup, it opens in a browser tab, he clicks options, copies a picks line, pastes it back, and the agent rebuilds the page from scratch. With several agents running in Orca worktrees, he also has to hunt for which one needs him.

Convo Mode makes that loop spoken and live. You talk to an agent, it talks back, and anything it shows you (a mockup, a plan, the code it changed) fills the screen and changes in front of you while you keep talking. You can hop between agents, or hand the room to one manager agent that runs the rest.

It is an Orca plugin, for anyone using Orca, on Mac, Windows and Linux.

## Goals

1. A **Convo tab**, opened from the tab bar's **+** menu as **New Convo**, where you talk to one agent by voice or by typing and hear it answer.
2. **The stage.** Anything an agent shows (mockup, plan, code changes, screenshots) fills the Convo tab, the conversation shrinks to a pill on top, and the stage updates live as the agent edits it.
3. **Moving between agents**: Claude, Codex and Grok, in any workspace, from a menu at the top of the tab, each agent with its own conversation.
4. **Orchestrator mode**: one manager agent you talk to, which reads every lane, hands out instructions, and answers only simple yeses.
5. **Convo stays visible** when you're in other Orca tabs, through the status bar. Voice pauses while you're away, and replies wait for you.
6. **Free and local by default**: speech in and out run on your computer, with no paid service required.
7. **The UI follows the person's Orca theme**, in every theme, light or dark.
8. **Everything is configurable in the person's own plugin settings** (Orca Settings → Plugins → Convo Mode), with your picks as the defaults.

## Non-goals (v1)

- No cloud voices (ElevenLabs, OpenAI). Free voices only to start; cloud voices may come later.
- The running app (a dev server on `localhost`) is not shown on the stage in v1. It probably needs Orca's own browser tab.
- No native Mac or iPhone app. A plugin only.
- No editing of the agent's files from the Convo tab. Agents edit; Convo shows.
- No Apple-only or Windows-only pieces anywhere.

## Anti-goals (a failure even if it works)

- **Listening without the person knowing.** Whenever the microphone is open, the tab shows a "Listening" chip, and the status bar shows it outside the tab.
- **The manager doing something the person didn't ask for.** It may only answer a yes/no permission prompt for an action the person already asked for in this conversation. Deleting data, pushing, merging, or anything else always goes to the person.
- **Speaking diffs, logs or code out loud.** Spoken replies are short; detail stays written.
- **A tab that breaks under a theme.** No fixed colors in the tab except agent-kind accents and status colors.
- **Sending words to an agent before the person can fix a misheard one** when the speech engine wasn't sure.
- **Shipping a large download to everyone.** Speech models download only when someone chooses a voice that needs one.

## Constraints

From Orca's plugin rules (`orca skills get orca-plugin-authoring`, and the typings in `/Applications/Orca.app/Contents/Resources/plugins/types/`):

- **No build step.** `.ts` loads as written. Type-check with `npx tsc -p .`.
- **Frame code** (the tab) can import only `orca`, `orca/*` and relative files, and has no network.
- **The worker** is Node, with network and the file system. Don't commit `node_modules/`; bundle npm dependencies.
- **Size limits:** 2,000 files and 50 MiB per plugin, and 1 MiB per transpiled file.
- **Only the worker can type into a terminal** (`terminal:send`). A panel or tab cannot.
- **What a frame gets:** the theme as `--orca-*` CSS variables plus a `light`/`dark` class on `<html>`. A `theme` event fires on change, without a reload.
- **Status bar items:** each has a short label, an icon from a fixed set, a tone (neutral, accent, success, warning, danger), a tooltip, and one command run on press. A plugin may have several.
- **`agents.list` covers only the focused workspace.** Agents elsewhere are known from `agent.status.changed` events.
- **Tool calls:** `agent.tool.before` lets the worker see and refuse each tool call before it runs, for Claude only. Codex and Grok only report calls.

From the repo (`AGENTS.md`):

- No comments in source. The gate is `hooks/check_source_comments.py`.
- PRs are drafts. UI PRs need labeled before/after stills, a motion clip, and a Visual verification section.

## Decisions

### Tech stack (settled)

| Layer | Choice |
|---|---|
| Plugin shape | `execution: "trusted-worker"` with `main`. `contributes.customEditors` draws the Convo tab, bound to a `.convo` file. `contributes.newFiles` adds **New Convo** to the + menu and the command palette. Also `statusBarItems`, `commands` and `settings`. |
| Worker | TypeScript loaded as written, Node built-ins only |
| Tab UI | Plain TypeScript, HTML and CSS, styled only from `--orca-*` variables. No framework. Orca's components/TSX panels can't draw the glow, read-along text or the floating pill. |
| Tab ↔ worker | `orca.plugin.request(name, input)` from the tab; the worker posts events back |
| Agents | `agents.list`, `workspace.list`, `agent.status.changed`, `terminal.sendText`, `terminal.read`, `agent.launch`, `workspace.open`, `agent.tool.before` |
| Reading replies | The agent's own session log (Claude: `~/.claude/projects/*/*.jsonl`; Codex: its session files), with `terminal.read` as the fallback |
| Stage content | The worker watches the files an agent writes (`fs.watch`), reads `git diff` through `child_process`, and passes content to the tab |
| Voice in | **Blocked by the probe (Q1, Q2): see "Unproven: answered". As first designed:** the tab records the mic (`getUserMedia`) and the worker transcribes with sherpa-onnx (WebAssembly build) using a Parakeet model. It has to be the main path because the settled features need it: unsure-word underlines and the 3-second hold need confidence scores, and the Listening chip, Auto mode, talking over the agent, and hold ⌥ Space all need the plugin to control the mic. Orca's dictation gives none of these. If Orca's own dictation types into the text box, it still works, as typing. *(Builder-check call, reverses the first draft.)* |
| Turn-taking | Silero voice-activity detection (sherpa-onnx) for Auto mode |
| Voice out | **System:** the browser's speech synthesis in the tab, falling back to the system's speech command. **Kokoro / Piper:** sherpa-onnx text-to-speech in the worker, with audio played in the tab. |
| Downloads | The speech engine and models download on first use into a per-user data folder, never shipped in the plugin |
| Tests | `orca plugin test` (`orca/testing`), `node:test` `.test.mjs` files like the other plugins, `npx tsc -p .`, `orca plugin check` |

### The Convo tab

- **Look** (from the person's reference, the Claude app's voice mode): one centered conversation. Your words are in bubbles. The agent's reply is in serif text that darkens word by word as it's spoken. A soft glow rises at the bottom while someone is speaking, colored by agent kind: Claude warm, Codex blue, Grok grey, Orchestrator violet.
- **Your words (1C):** a bubble marked "spoken", with **Fix**. Words the speech engine was unsure of get a wavy underline. Clicking one offers alternatives. When any word is unsure, the message waits 3 seconds before sending (8: 5C). Clear sentences send immediately.
- **Replies (1: 2B):** the agent speaks a short version. The full written reply sits below in lighter text, labeled "Written only".
- **While working (1: 3B):** each step appears live, then folds into "N steps" you can open.
- **Under each reply (1: 4A):** copy, say again, and open the agent's terminal, always visible.
- **Stage mentions (1: 5B):** one line, for example "↗ Put changes · 2 files on stage".
- **Interrupting (1: 6A):** start talking while the agent speaks and it stops and listens.

### Input bar (round 2)

- **A real text box, always (1B).** This is also what lets Orca's dictation type into the tab.
- **Your words appear live** in the bar as you speak (2A).
- **Shortcut: dropped from v1 (Aamon, 2026-11-10).** The mic button is the way to talk. ⌥ Space and ⌘⌥ Space clash on a Mac, and the alternatives are taken in his setup. A shortcut can come later as a setting.
- **A "Listening" chip with Pause** whenever the mic is open (4A).
- **The strip under the bar (5A):** **+** (new agent), agent kind, **Voice**, and **Auto / Manual**. Auto is the default, so the agent listens after it finishes speaking.
- **Voice menu:** System (the default, built in) and Piper (free, one-time download). Kokoro is dropped from v1 (Aamon, 2026-11-10), because it runs slower than real time in WebAssembly, plus "a different voice for each agent" (on by default).

### Top bar and agent menu (round 3)

- **The title is the agent's name**, with an amber dot when another agent needs you. There's no side list. Next to it: a mode tag ("Claude · Direct" or "… · Orchestrator"), the workspace, and **⌘K**. On the right are a **stage** button and an **open this agent's terminal** button (5B).
- **The menu lists every workspace, grouped (1C).** **Needs you** comes first. Sections built only from status events are marked "from status events."
- **Rows (2C):** status dot, name, kind tag, status with time, and the last thing the agent said.
- **Type to find (3B).** ⌘K opens it from anywhere in the tab.
- **Each agent has its own thread (4A).** Switching swaps the conversation.
- **Starting a new agent (6A):** pick Claude, Codex or Grok. It starts in its own worktree, named from the first thing you say.

### The stage (round 4)

- **Opens automatically (1B)** the first time an agent shows something in a conversation, then updates in place.
- **v1 shows (2B)** mockups (HTML), plans (Markdown), code changes (diffs) and screenshots (images). The running app is out.
- **A strip across the top (3A)** lists every item shown in this conversation, with a dot on unseen items. It also shows the source path and "● live".
- **Changes (4C):** the changed part flashes, and the pill says what changed, for example "↻ label Send → Send once".
- **The pill (5B):** slim, showing a dot, the agent name, captions of what's being said (by you or the agent), mic, Stop, and back to the conversation. It opens on hover to show the last few lines and changes.

### Orchestrator (round 6)

- **Starting it (5B):** you choose the manager's kind (Claude, Codex or Grok), with Claude preselected.
- **What it may do alone (1B):** answer yes/no permission prompts only for actions you already asked for. Codex and Grok prompts always come to you. How "matches something you asked for" is decided is an open question for Aamon (below). Whatever the rule, the mechanics are fixed:
  - `agent.tool.before` can only refuse or change a call; the person is still asked as usual. It can't approve.
  - The worker uses the hook to see exactly what a Claude lane is asking, and to refuse anything on the always-yours list.
  - A "yes" is typed into the lane's prompt with `terminal.sendText`, and recorded as an action line.
- **Every action is a line in the thread (2A),** for example `→ ur-email-drafts: "Dedupe on the server."`
- **Hearing from other agents (3C):** the manager sums them up. "Patch me through to X" switches you to talking with X directly.
- **The lane board is always on stage (4A):** every lane with status and last line. Lanes flash when they change, and ones waiting on you are marked.
- **Requests it can't approve** arrive as a card with **Allow**, **Not now** and **Patch me through**.
- **How it runs:** the plugin starts the manager with `agent.launch`, giving it Orca's orchestration skill and a brief listing the lanes. It reads and sends through the `orca` CLI as that skill does.
  - The worker checks every send through the `terminal.send` and `agent.prompt.before` hooks. They see text that Orca, the CLI or a plugin sends. The worker refuses anything the rule doesn't allow, and records each allowed send as an action line.
  - Reads aren't checked, since reading changes nothing. *(Builder-check call.)*

### Outside the tab (rounds 7 and 9)

- **Two status bar items (7: 2C):** a label that opens the Convo tab, and a mic item that pauses and resumes listening.
- **The label (1C):** `agent · state · N need you`, for example `mail-drafts · listening · 2 need you`.
- **Tone (4B):** accent while listening or speaking, warning when another agent needs you, neutral otherwise.
- **With no conversation (3B):** a quiet "Convo" item that starts one.
- **The + menu item (9: 5A):** "New Convo".
- **A new Convo starts with (6A)** the agent in the focused workspace, or offers to start one.

### States (round 8)

- **First open (1B):** straight into the conversation. The mic permission is asked the first time it's pressed.
- **Mic blocked (2A):** a banner explaining how to allow it on this system (Mac, Windows or Linux), while typing keeps working.
- **Picking Kokoro or Piper (3A):** switches immediately, using the System voice until the download finishes, with progress in the Voice chip.
- **Agent silent for 2 minutes (4A):** a line saying so, with **Open terminal**, **Nudge** and **Restart agent**.
- **No agents (6A):** "No agents here yet" with Claude, Codex and Grok buttons, plus ⌘K for agents in other workspaces.

### Settings (round 10)

**All settings live in Convo Mode's own section of Orca Settings → Plugins**, declared in the manifest (`contributes.settings`, `settings:own`). There's no settings page inside the tab (Aamon, 2026-11-10). The page is `docs/design/convo-mode/mockup-round-10-settings.html`.

- **Grouping (1A).** Orca shows a flat list in manifest order, so each title starts with its group, for example "Speaking · Voice". The groups are Speaking, Listening, Stage, Agents, Orchestrator, Status bar, Look and Privacy.
- **36 settings** (Orca's limit is 64). Every default is a pick from the rounds above. The full list, with titles, kinds, choices and descriptions, is in the round 10 page and is the source for the manifest:
  - **Speaking:** voice, a voice per kind, the four kind voices, speed, speak whole replies
  - **Listening:** microphone, language, taking turns, end-of-turn pause, unsure-word hold, talking over an agent stops it
  - **Stage:** opens on its own, show mockups / plans / code changes / screenshots, flash what changed, pill opens on hover
  - **Agents:** agents in the menu, show last line, new agents start as, new agents start in, quiet-agent timer
  - **Orchestrator:** default manager, let the manager answer simple yeses, also always ask me about
  - **Status bar:** show "Convo" when idle, show the need-you count, color the item
  - **Look:** glow color by kind, less motion
  - **Privacy:** keep conversations
- **The five always-blocked actions can't be turned off.** They're named in the "simple yeses" description, and "Also always ask me about" adds to them.
- **Microphone** is a text setting, where blank means the system default. The mic button in the tab lists the device names it can see.
- **Extras the list can't hold become command-palette commands (2A):**
  - Convo: Play a voice sample
  - Convo: Remove downloaded voices
  - Convo: Delete all conversations
- **A gear in the Convo tab's top bar (3B)** shows "Settings → Plugins → Convo Mode (⌘,)". A plugin can't open Orca Settings itself.
- **Every setting takes effect right away.** The worker and the tab re-read settings when they change.

## Unproven: answered by the probe (2026-11-10)

All twelve were run on Aamon's Mac. Full results: [`2026-11-10-convo-mode-probe-results.md`](2026-11-10-convo-mode-probe-results.md).

1. **Failed:** Orca's dictation (⌘E) doesn't type into a plugin tab. macOS's own dictation (fn) does, but it's Mac-only.
2. **Failed:** Orca refuses the microphone to plugin tabs (`NotAllowedError`), even though macOS allows Orca and Orca's dictation works. **So voice in, as designed, can't be built yet.** The new path is Aamon's choice (pending).
3. **Proven:** the tab can speak with the system voices, and can play audio sent from the worker.
4. **Proven:** interactive mockups run their own scripts in a `srcdoc` iframe (use this) or a shadow root.
5. **Partly proven:** Parakeet runs at 0.30× real time with an exact transcript. Voice detection and Piper are fast enough (first sentence about 240 ms). Kokoro is slower than real time in WebAssembly (2.7 s for the first sentence). sherpa-onnx 2.x also needs `piper-phonemize`.
6. **Proven:** models go in the per-OS data folder (`~/Library/Application Support/convo-mode` on Mac), never the plugin folder. Orca counts everything in the plugin folder against its 50 MiB limit.
7. **Partly proven:** a terminal can be matched to its Claude log, but by content across recent logs, since a log lives under the folder its session started in.
8. **Not needed for v1:** voice pauses outside the tab. It wasn't measured, because it needed the mic.
9. **Partly proven:** the `.convo` file lands at the worktree root and git sees it. The worker keeps it out of commits through `.git/info/exclude`.
10. **Proven:** Orca waits at most about 2 s on a hook. Checks must be lookups, never model calls.
11. **Dropped (Aamon):** no talk shortcut in v1, so the mic button is the way to talk. The probe's ⌘⌥Space never reached the worker, because macOS uses it for Finder search.
12. **Proven:** the worker hears settings changes.

## Builder-check calls (made by Claude, from the reviewer's questions)

- **Voice in:** the tab's own mic plus sherpa-onnx is the main path, as described in the tech stack table above.
- **What counts as "showing" something:** during a turn of this conversation, the agent creates or edits an `.html`, `.md` or image file. This is seen through `agent.tool.after` for Claude and `fs.watch` on the worktree for the others. Files under `node_modules`, `.git` and build output are ignored. Saying "show me X" also puts X on stage. To be revisited if the stage opens too often in practice.
- **Starting a new agent in its own worktree:** the plugin API has no workspace-create method, so the worker runs the `orca` CLI, as Activity Monitor's worker already does. The worktree goes in the repo of the agent you're currently talking to.
- **Conversations are stored in the plugin's own storage, per agent.** The `.convo` file only opens the tab, so deleting a worktree doesn't lose a conversation and nothing lands in git. Where Orca puts untitled files is checked by test 9.
- **Clicks on a mockup on the stage stay inside the mockup in v1.** You pick options by voice. Sending clicks to the agent can come later.

## Left to the builder

- File layout inside `plugins/convo-mode`, the message names between tab and worker, and the `.convo` file format (a JSON transcript is fine).
- How "unsure" words are detected (engine confidence scores or alternatives) and the threshold.
- The silence length that ends a turn in Auto mode, and the exact debounce for live stage reloads.
- The stall threshold is 2 minutes in the design. The builder may make it a setting.
- Which Kokoro and Piper voices ship in the Voice menu, and the default voice per agent kind.
- Icons, within Orca's fixed status bar icon set and a square icon for **New Convo**.

## Open questions (Aamon's)

All three were answered by Aamon on 2026-11-10.

1. **How the manager decides a yes is safe: the manager judges, plus a hard block in the plugin.** The manager agent decides whether a prompt matches what you asked for. The worker always refuses a fixed list itself, whatever the manager says:
   - push
   - merge
   - deleting files or data
   - migrations against shared databases
   - installing packages

   Every yes is recorded as an action line.
2. **Voice while you're in another tab: voice pauses, and the status bar stays.** Leaving the Convo tab pauses listening and speaking. The status bar still shows the agent, `paused`, and who needs you, and replies wait until you come back. Test 8 decides nothing now. It only confirms that the tab resumes cleanly.
3. **Where the short spoken version comes from: ask the agents.** Each message Convo sends ends with one line asking the agent to start its reply with a one-sentence summary for speaking. Only messages sent through Convo carry it. Using an agent directly in its terminal is unaffected. If a reply has no summary line, Convo speaks its first sentence, skipping code, paths and lists.

## Sources

Orca typings and authoring guide: `/Applications/Orca.app/Contents/Resources/plugins/types/orca-host.d.ts`, `orca-frame.d.ts`, `orca-worker.d.ts`; `orca skills get orca-plugin-authoring` (and `--reference references/host-api.md`, `recipes.md`). Orca's dictation: `sherpa-onnx` and `speech-models/parakeet-tdt-0.6b-v3-int8` in Orca's install and app data. Repo rules: `~/.claude/AGENTS.md`, `orca-plugins/README.md`. Picks: round pages in `docs/design/convo-mode/`.
