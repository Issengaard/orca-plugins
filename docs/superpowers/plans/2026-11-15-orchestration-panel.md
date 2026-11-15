# Orchestration panel 1.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Orca plugin, `plugins/orchestration`. It is a side panel holding a hidden orchestrator agent (Chat or Terminal style). It shows a Board of the workers that agent starts, babysits their PRs by routing CI failures, review threads and conflicts to the owning worker, and guards against merges. It never opens a tab.

**Architecture:**
- **Pure logic** lives in small, test-covered worker modules: GitHub parsing, board state, event diffing and dedupe, guard patterns, ownership and message text.
- **I/O goes through injected deps:** `execFile` for the `orca` and `gh` CLIs, the HTTP inbox and the host API.
- **`src/worker.ts`** wires the modules to Orca: host calls, events, hooks and panel request handlers.
- **The panel** is plain JS in `panel/`. It renders a view model it polls from the worker, the same pattern Activity Monitor uses.

**Tech Stack:**
- A TypeScript trusted worker, run by Orca with Node type-stripping.
- A plain-JS HTML panel.
- Tests with `node:test` plus `orca/testing` (`mockHost`, `mountWorker`), run with `orca plugin test .` from `plugins/orchestration`.
- `gh` CLI for GitHub. The `orca` CLI for orchestration.

**Spec:** `docs/superpowers/specs/2026-11-15-orchestration-panel-design.md`. Prototype (the source of truth for layout and copy): `docs/design/orchestration-panel/prototype.html`. Mockups: `docs/design/orchestration-panel/mockup-sidebar.html`.

## Global Constraints

- **No comments of any kind in source** (AGENTS.md §1; `hooks/check_source_comments.py`).
- **No tabs, only the sidebar.** The plugin never calls `workspace.open`, `terminal.focus`, `editor.open`, `commands.run`, `orca terminal switch|focus`, `orca file open|diff|open-changed`, or `orca agent launch --focus`. The only way out of the panel is `shell.openExternal` for "PR on GitHub".
- **Never merge.** No merge button and no merge call. `orca orchestration reset` is never called. `orca worktree rm` and `orca workspace cleanup run` run only after a confirm in the panel.
- **GitHub goes only through `gh`,** using the user's login. No tokens and no paid services.
- **Agent ids** come from Orca's catalog (spec "Constraints"): `claude`, `codex`, `grok`, `gemini`, `antigravity` (cmd `agy`), `cursor` (cmd `cursor-agent`), `copilot`, `opencode`, `opencode2`, `aider`, `goose`, `kimi`, `droid`, `pi`, `omp`, `qwen`, `amp`, `cline`, `devin`, `hermes`. The table is extendable.
- **Defaults:**

  | Setting | Default |
  |---|---|
  | Chat style | `chat` (other value: `terminal`) |
  | Suffix | `-oa` |
  | Interval | `60` s (choices 30/60/120/300) |
  | Fix attempts | `3` (choices 1/2/3/5) |
  | Merge guard | on |
  | Nightly sweep | off |
  | Kanban breakpoint | panel width ≥ `640px` |

- **Manifest:** `execution: "trusted-worker"`, `engines.orca: ">=1.4.259"` (needs host API 1.9 for `project.setHidden`), `pluginApi: 1`.
- **Test command,** from `plugins/orchestration`: `orca plugin test .`. Expected output: `N test file(s) passed (node).`
- **Branch** `aamonnaig4/orchestration`. Commit per task. Draft PR only. Commit trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01XKBqSjPoMYavZAPakufzsM`

## Review Focus

1. **`gh` is missing, signed out or rate-limited.** The footer shows "gh not signed in" or "GitHub rate limited · retrying in Ns". No events are sent and nothing crashes. *(Task 3, Task 9)*
2. **The orchestrator's terminal is closed, killed, or lost to an Orca restart.** The next send resumes it by session id with `agent.resume`. Queued messages and the chat history survive. *(Task 8)*
3. **A worker force-pushes or rebases its PR,** so the head SHA changes and old check runs vanish. Old failures are not sent again, and the attempt count stays keyed by PR + check name. *(Task 5)*
4. **A PR is merged or closed, or a worktree is removed outside the panel.** The row leaves the Board. Nothing is ever sent to that dispatch again. *(Task 5, Task 6)*
5. **The inbox gets a bad post:** wrong or missing token, a body over 16 KB, non-JSON, or text containing HTML. It is rejected with 401/413/400. Accepted text is stored raw and always escaped when the panel renders it. *(Task 7, Task 10)*

---

### Task 0: Spikes (verify the risky assumptions; results go in the spec)

Each spike writes its observation into the spec under a new "## Spikes" heading. If a spike fails, apply the spec's named fallback and record it there. Spikes use throwaway code that is not committed, except the spec edit.

- [ ] **Step 1: hidden home.** Create `~/.orca-orchestration/yimby`, then register it with `orca project setup-existing-folder --help`-guided flags. Call `project.setHidden` from a scratch dev plugin (`orca plugin dev load`) and `agent.launch({ workspaceId, agent: 'claude', prompt: 'say hi' })` into it. Record:
  - (a) whether any tab or workspace becomes visible in Orca;
  - (b) the `terminalId` shape;
  - (c) whether `agent.status.changed` arrives for it.
- [ ] **Step 2: `--repo` from the hidden folder.** In that terminal, run `orca orchestration worker-start --repo name:yimby --worktree new-top-level --name spike-oa --agent claude --spec "echo hi; finish"`. Record whether the worktree lands in yimby. Fallback (spec): a hidden terminal in the repo's main workspace.
- [ ] **Step 3: env injection.** Register `agent.launch.before` and return `next({ ...event, env: { ...event.env, ORCA_ORCH_URL: 'x' } })`. Run `echo $ORCA_ORCH_URL` in the launched agent and record the result.
- [ ] **Step 4: local server.** Bind `http.createServer` on `127.0.0.1:0` in the trusted worker. Record whether it binds and is reachable with `curl` from the agent's terminal.
- [ ] **Step 5: CLI shapes.** Save real `--json` output to `plugins/orchestration/tests/fixtures/` from each of these commands:
  - `orca agent-context --json` → `agent-context.json` (trimmed to the commands this plan uses);
  - `orca orchestration run-list --json`, `worker-list --json`, `gate-list --json`;
  - `orca worktree list --json`;
  - `gh api graphql` (Task 3's query) against one real yimby PR.
- [ ] **Step 6: guard reach and no focus.** Check whether `agent.tool.before` fires for a worker started with `--surface chat`. Check whether `orca worktree activate` brings a workspace forward. Record both. If activate focuses, Task 6 drops it.
- [ ] **Step 7:** Commit the spec's "Spikes" section and the fixtures: "Record orchestration spikes and CLI fixtures".

### Task 1: Plugin scaffold, deps and the `orca` CLI wrapper

**Files:**
- Create: `plugins/orchestration/orca-plugin.json`, `README.md`, `LICENSE` (copy MIT from now-playing), `src/deps.ts`, `src/orcacli.ts`, `src/worker.ts` (activate stub), `panel/index.html` (empty shell)
- Test: `tests/orcacli.test.mjs`, `tests/worker.test.mjs`

**Interfaces:**
- Produces, in `src/deps.ts`:
  ```ts
  type Deps = { run(cmd: string, args: string[], opts?: { input?: string; timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }>; now(): number; home(): string; env(name: string): string | undefined }
  const nodeDeps: Deps
  type Settings = { chatStyle: 'chat' | 'terminal'; orchestratorAgent: string; workerAgent: string; suffix: string; intervalSec: number; attempts: number; guard: boolean; nightlySweep: boolean }
  const DEFAULT_SETTINGS: Settings
  ```
- Produces, in `src/orcacli.ts`:
  ```ts
  function orcaBin(deps: Deps): string
  function createCli(deps: Deps): {
    json<T>(args: string[]): Promise<T>
    has(command: string): boolean
    load(): Promise<void>
  }
  class CliError extends Error { code: string; retryable: boolean }
  ```
- Manifest panel: `{ "id": "orchestration", "title": "Orchestration", "icon": "agent", "entry": "panel/index.html" }`.
- Manifest capabilities: `storage:own`, `settings:own`, `notifications:show`, `agent:read`, `agent:launch`, `terminal:read`, `terminal:send`, `workspace:read`, `project:read`, plus any capability the spikes named.
- Manifest settings: `chatStyle`, `orchestratorAgent`, `workerAgent`, `suffix`, `intervalSec`, `attempts`, `guard`, `nightlySweep`, all with the defaults above.
- Manifest events: `agent.status.changed`, `workspace.removed`. Manifest hooks: `agent.launch.before`, `agent.tool.before`, `agent.tool.after`.

- [ ] **Step 1: Failing tests.**
  - `orcaBin` returns `env('ORCA_CLI_COMMAND')` when set, else `'orca'`.
  - `json(['worktree','list'])` calls `run(bin, ['worktree','list','--json'])` and returns the parsed `result`.
  - An `{ ok:false, error:{ code:'runtime_unavailable' } }` reply rejects with a `CliError` where `code === 'runtime_unavailable'` and `retryable === true`.
  - After `load()` on the `agent-context.json` fixture, `has('orchestration worker-start')` is `true` and `has('nope')` is `false`.
  - `tests/worker.test.mjs`: `mountWorker(main)` leaves `worker.refusals` equal to `[]`.
- [ ] **Step 2:** Run `orca plugin test .`. The new tests FAIL.
- [ ] **Step 3:** Implement. `json` appends `--json` exactly once. `has` matches on the space-joined command path from the schema.
- [ ] **Step 4:** Run `orca plugin test .`. PASS. Then run `orca plugin validate .`, which must print no errors.
- [ ] **Step 5:** Commit: "Scaffold the orchestration plugin and its orca CLI wrapper".

### Task 2: Agent catalog and installed-agent detection

**Files:**
- Create: `src/agents.ts`
- Test: `tests/agents.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  type AgentEntry = { id: string; label: string; cmd: string; installed: boolean }
  const AGENT_CATALOG: { id: string; label: string; cmd: string }[]
  function detectAgents(deps: Deps): Promise<AgentEntry[]>
  ```
  `AGENT_CATALOG` uses the Global Constraints ids. `detectAgents` returns installed entries first, then the rest, each group in catalog order.

- [ ] **Step 1: Failing tests.**
  - With a fake `run` where `command -v claude` and `command -v agy` exit 0 and the rest exit 1, `detectAgents` puts `claude` then `antigravity` first, both `installed: true`, and every other entry has `installed: false`.
  - It makes exactly one `run` call, a single login-shell script that checks every command (`/bin/zsh -lc '…'`), and parses one line per hit.
- [ ] **Step 2:** Run the tests. They FAIL.
- [ ] **Step 3:** Implement with one `run('/bin/zsh', ['-lc', script])`, where the script prints `ok <cmd>` for each command found.
- [ ] **Step 4:** Run the tests. PASS.
- [ ] **Step 5:** Commit: "Detect installed Orca agents from the catalog".

### Task 3: GitHub reader

**Files:**
- Create: `src/github.ts`
- Test: `tests/github.test.mjs`, plus the fixture `tests/fixtures/gh-pr.json` (from the Task 0 spike)

**Interfaces:**
- Produces the types:
  ```ts
  type Check = { name: string; state: 'pass' | 'fail' | 'pending'; runId: string | null; url: string | null }
  type Thread = { id: string; firstCommentId: string; path: string | null; line: number | null; author: string; isBot: boolean; body: string; url: string; resolved: boolean }
  type PrState = { number: number; url: string; headSha: string; baseSha: string; isDraft: boolean; state: 'OPEN' | 'MERGED' | 'CLOSED'; mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'; author: string; checks: Check[]; threads: Thread[]; comments: Thread[] }
  type GhStatus = { ok: true } | { ok: false; reason: 'missing' | 'signed-out' | 'rate-limited' | 'error'; retryInSec?: number }
  ```
- Produces the functions:
  ```ts
  function readPrs(deps: Deps, repo: string, numbers: number[]): Promise<{ status: GhStatus; prs: PrState[] }>
  function prForBranch(deps: Deps, repo: string, branch: string): Promise<number | null>
  function failedLogTail(deps: Deps, repo: string, runId: string, lines: number): Promise<string>
  function prDiff(deps: Deps, repo: string, pr: number): Promise<string>
  ```
- `readPrs` makes one `gh api graphql` call that aliases each PR (`pr4547: pullRequest(number: 4547) { … }`). It reads `statusCheckRollup.contexts` (CheckRun and StatusContext), `reviewThreads(first: 100)` and `comments(last: 50)`. Bots are any author with `__typename === 'Bot'`, or a login ending in `[bot]`.

- [ ] **Step 1: Failing tests.**
  - The fixture parses to the expected `checks` states. FAILURE and TIMED_OUT and CANCELLED map to `fail`; SUCCESS, NEUTRAL and SKIPPED map to `pass`; anything else maps to `pending`.
  - Resolved threads are kept with `resolved: true`.
  - **Review Focus 1:** stderr `gh: command not found` gives `{ ok:false, reason:'missing' }`. "authentication required" or exit 4 gives `'signed-out'`. "API rate limit exceeded" plus an `x-ratelimit-reset` value gives `'rate-limited'` with `retryInSec`. In all three cases `prs` is `[]`.
  - `failedLogTail(…, 80)` returns at most 80 lines from `gh run view <id> --log-failed`.
- [ ] **Step 2:** Run the tests. They FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. PASS.
- [ ] **Step 5:** Commit: "Read PR checks, threads and mergeability through gh".

### Task 4: Board state and the Ready rule

**Files:**
- Create: `src/board.ts`
- Test: `tests/board.test.mjs`

**Interfaces:**
- Consumes `PrState` (Task 3).
- Produces:
  ```ts
  type Group = 'needs' | 'fixing' | 'watching' | 'ready'
  type WorkerRow = { key: string; dispatchId: string; workspaceId: string; branch: string; name: string; agent: string; pr: number | null; group: Group; detail: string; draft: boolean; kept: boolean; stopped: boolean; attempts: number; gate: { id: string; question: string; options: string[] } | null; updatedAt: number }
  function isReady(pr: PrState): boolean
  function groupFor(input: { pr: PrState | null; gate: WorkerRow['gate']; attemptsMaxed: boolean; blocked: boolean; stopped: boolean; awaitingPush: boolean }): Group
  function detailFor(input: …same…): string
  ```

- [ ] **Step 1: Failing tests.**
  - `isReady` is true only when **all** of these hold (spec call 4): not a draft; at least one check; every check `pass`; no thread with `resolved === false`; `mergeable === 'MERGEABLE'`.
  - It is false for each single violation. That includes zero checks, and a draft with everything else green.
  - `groupFor` precedence: `needs` when there's a gate, attempts are maxed, a merge was blocked, or the worker was stopped. Otherwise `fixing` when `awaitingPush`. Otherwise `ready` when `isReady`. Otherwise `watching`.
  - A draft that is all green is `watching`, and `detailFor` contains "draft".
- [ ] **Step 2:** Run the tests. They FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. PASS.
- [ ] **Step 5:** Commit: "Group workers into Needs you, Fixing, Watching and Ready".

### Task 5: Event diffing, dedupe, attempts and worker messages

**Files:**
- Create: `src/events.ts`, `src/messages.ts`
- Test: `tests/events.test.mjs`, `tests/messages.test.mjs`

**Interfaces:**
- Consumes `PrState`, `Thread` (Task 3).
- Produces in `src/events.ts`:
  ```ts
  type RouteEvent =
    | { kind: 'check-failed'; pr: number; check: string; runId: string | null; sha: string; key: string; signature: string }
    | { kind: 'thread'; pr: number; thread: Thread; key: string }
    | { kind: 'bot-batch'; pr: number; sha: string; items: Thread[]; key: string }
    | { kind: 'conflict'; pr: number; baseSha: string; key: string }
  type Ledger = { sent: Record<string, number>; attempts: Record<string, number>; maxed: Record<string, true> }
  function diffEvents(pr: PrState, ledger: Ledger): RouteEvent[]
  function recordSent(ledger: Ledger, ev: RouteEvent, now: number, maxAttempts: number): { ledger: Ledger; maxed: boolean }
  function resetAttempts(ledger: Ledger, pr: number): Ledger
  ```
- Dedupe keys (spec table), which `diffEvents` must not emit twice:
  - check failure: `` `${pr}:${sha}:${check}` ``, with signature `` `${pr}:${check}` ``;
  - thread or comment: `` `c:${firstCommentId}` ``, and replies in an already-sent thread get `` `c:${replyId}` ``;
  - bot batch: `` `bot:${pr}:${sha}` ``;
  - conflict: `` `conflict:${pr}:${baseSha}` ``.
- Comments authored by `pr.author` are skipped (spec call 6).
- Produces in `src/messages.ts`:
  ```ts
  function messageFor(ev: RouteEvent, extra: { logTail?: string; base?: string }): { subject: string; body: string }
  ```
  - Conflict body: `Merge origin/<base> into your branch and resolve conflicts, then push.`
  - Check body: the check name, the run URL and the log tail inside a fenced block.

- [ ] **Step 1: Failing tests.**
  - Two calls to `diffEvents` with the same `PrState` and a ledger updated by `recordSent` emit the event once.
  - **Review Focus 3:** a new head SHA with the same failing check emits a new `check-failed`, and `attempts['4547:Expo jest 3/3']` becomes 2, not 1. A new SHA where the old failing check is absent emits nothing for it.
  - **Review Focus 4:** `state: 'MERGED'` or `'CLOSED'` emits `[]`.
  - At `maxAttempts = 3`, the third `recordSent` returns `maxed: true`, and `diffEvents` then emits no `check-failed` for that signature until `resetAttempts`.
  - Three bot comments on one SHA produce one `bot-batch` with three items.
  - `messageFor` snapshots for each kind.
- [ ] **Step 2:** Run the tests. They FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. PASS.
- [ ] **Step 5:** Commit: "Diff PR state into routed events with dedupe and attempt limits".

### Task 6: Ownership: the panel's runs, workers and their PRs

**Files:**
- Create: `src/ownership.ts`
- Test: `tests/ownership.test.mjs` (uses the Task 0 fixtures)

**Interfaces:**
- Consumes `createCli` (Task 1) and `prForBranch` (Task 3).
- Produces:
  ```ts
  type Owned = { runId: string; dispatchId: string; workspaceId: string; terminalId: string | null; branch: string; name: string; agent: string; repo: string; pr: number | null }
  const MARKER = 'orchestration-plugin run:'
  function ownedWorkers(input: { runs: unknown; workers: unknown; worktrees: unknown; orchestratorTerminalId: string }): Omit<Owned, 'pr'>[]
  function attachPrs(deps: Deps, owned: Omit<Owned, 'pr'>[], cache: Record<string, number | null>): Promise<Owned[]>
  ```
- A run is the panel's when its coordinator terminal equals `orchestratorTerminalId`. A worker belongs to it when it's in that run, or when its worktree `comment` starts with `MARKER + runId`.

- [ ] **Step 1: Failing tests.**
  - The fixtures yield only the panel run's workers. A second run with another coordinator is ignored (spec: "Only the panel's runs").
  - **Review Focus 4:** a worker whose worktree is missing from `worktree list` is dropped.
  - `attachPrs` calls `prForBranch` once per branch, reuses `cache` on the next call, and leaves `pr: null` when there's no PR.
- [ ] **Step 2:** Run the tests. They FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. PASS.
- [ ] **Step 5:** Commit: "Find the panel's workers and the PR each one owns".

### Task 7: Inbox server and chat log

**Files:**
- Create: `src/inbox.ts`
- Test: `tests/inbox.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  type ChatMsg = { id: string; at: number; from: 'you' | 'orchestrator'; kind: 'text' | 'progress' | 'question' | 'result'; text: string; options?: string[]; answered?: string }
  function startInbox(opts: { onMessage(m: ChatMsg): void; random(): string }): Promise<{ url: string; token: string; close(): Promise<void> }>
  function appendChat(log: ChatMsg[], m: ChatMsg): ChatMsg[]
  ```
- `startInbox` binds `127.0.0.1:0`. It accepts only `POST /say` with header `x-token: <token>` and JSON `{ kind, text, options? }`. `appendChat` caps the log at 500 messages, dropping the oldest.

- [ ] **Step 1: Failing tests,** using real `http` against the bound port.
  - A valid post gets 204 and calls `onMessage` with `from: 'orchestrator'`.
  - **Review Focus 5:** a missing or wrong token gets 401. A body over 16384 bytes gets 413. Non-JSON or an unknown `kind` gets 400. None of these call `onMessage`.
  - `text` containing `<img onerror>` is stored unchanged.
  - The 501st `appendChat` leaves length 500 with the first message gone.
- [ ] **Step 2:** Run the tests. They FAIL.
- [ ] **Step 3:** Implement with `node:http`.
- [ ] **Step 4:** Run the tests. PASS.
- [ ] **Step 5:** Commit: "Add the local inbox the orchestrator posts chat messages to".

### Task 8: Orchestrator lifecycle, standing instructions and the send queue

**Files:**
- Create: `src/orchestrator.ts`, `src/instructions.ts`
- Test: `tests/orchestrator.test.mjs`, `tests/instructions.test.mjs`

**Interfaces:**
- Consumes `createCli` (Task 1) and `startInbox` (Task 7).
- Produces in `src/orchestrator.ts`:
  ```ts
  type OrchRecord = { projectId: string; homeWorkspaceId: string; terminalId: string; sessionId: string | null; agent: string; runId: string | null; status: 'working' | 'waiting' | 'done' | 'gone' }
  function createOrchestrator(o: { host: HostApi<'worker'>; cli: ReturnType<typeof createCli>; deps: Deps; store: StorageApi; inbox: { url: string; token: string } }): {
    ensure(projectId: string, repoName: string, agent: string, firstTask: string): Promise<OrchRecord>
    send(projectId: string, text: string): Promise<'sent' | 'queued'>
    onStatus(ev: PluginEvents['agent.status.changed']): void
    queued(projectId: string): string[]
    record(projectId: string): OrchRecord | null
    terminal(projectId: string, maxLines: number): Promise<string[]>
  }
  ```
- Produces in `src/instructions.ts`:
  ```ts
  function standingInstructions(o: { repoName: string; workerAgent: string; suffix: string; runMarker: string }): string
  ```
- `ensure` runs once per project:
  1. Create `~/.orca-orchestration/<repoName>`, register it via the CLI (Task 0 flags) and call `project.setHidden({ projectId, hidden: true })`.
  2. Call `agent.launch` into its workspace with `standingInstructions(...) + '\n\nTask: ' + firstTask`.
  3. Store the record under `orch:<projectId>`.
- The `agent.launch.before` hook (wired in Task 9) adds `ORCA_ORCH_URL` and `ORCA_ORCH_TOKEN` only when `event.workspaceId === homeWorkspaceId`.

- [ ] **Step 1: Failing tests,** with `mockHost`.
  - `ensure` calls `project.setHidden` with `hidden: true` before `agent.launch`.
  - It never calls `workspace.open`, `terminal.focus` or `commands.run`, checked with `host.callsOf(...).length === 0` for each.
  - `send` while the status is `working` returns `'queued'` and makes no `terminal.sendText`. Then `onStatus({ state: 'waiting', terminalId })` flushes the queue in order, one `terminal.sendText({ terminalId, text, enter: true })` per message.
  - **Review Focus 2:** when `terminal.list` lacks `terminalId`, `send` calls `agent.resume({ workspaceId, agent, sessionId })`, stores the new `terminalId`, then delivers. Queued items persist in storage across `createOrchestrator` re-creation.
  - `standingInstructions` contains:
    - `orca skills get orchestration`
    - `--repo name:<repoName>`
    - `--name <short-name><suffix>`
    - `--comment "orchestration-plugin run:`
    - `gate-create`
    - `curl -s "$ORCA_ORCH_URL/say"`
    - "never merge"
    - "do not poll"
- [ ] **Step 2:** Run the tests. They FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. PASS.
- [ ] **Step 5:** Commit: "Run the orchestrator hidden and queue panel messages until it is idle".

### Task 9: Watcher loop, routing, guard and the worker's panel API

**Files:**
- Create: `src/guard.ts`, `src/watcher.ts`
- Modify: `src/worker.ts` (wire everything)
- Test: `tests/guard.test.mjs`, `tests/watcher.test.mjs`, `tests/worker.test.mjs`

**Interfaces:**
- Consumes Tasks 1 to 8.
- Produces in `src/guard.ts`:
  ```ts
  type GuardHit = { rule: 'merge' | 'force-push' | 'push-main'; command: string }
  function matchGuard(tool: string, input: unknown): GuardHit | null
  ```
  It matches shell tools (`Bash`, `shell`, `run_shell_command`) on:
  - `gh pr merge`;
  - `gh api …/merge` with `PUT`;
  - `ao pr merge`;
  - `git push` with `--force`, `-f` or `--force-with-lease`;
  - `git push <remote> main|master|HEAD:main|HEAD:master`.
- Produces in `src/watcher.ts`:
  ```ts
  function createWatcher(o: { deps; cli; host; store; orchestrator; settings(): Settings }): { tick(): Promise<void>; start(): void; stop(): void; view(): ViewModel }
  ```
  `ViewModel` is `{ orch, chat, queued, workers: WorkerRow[], gh: GhStatus, polling: boolean, intervalSec, guard: { on, blocksToday }, banner }`.
- `tick` does, in order:
  1. Read `ownedWorkers`, then `attachPrs`, then `readPrs`.
  2. For each PR, run `diffEvents`. For each event, `messageFor`, then `cli.json(['orchestration','send','--to','dispatch:'+id,'--subject',s,'--body',b])`, then `recordSent`.
  3. Recompute rows. Notify once per transition into `ready`, and once when attempts max out. Read gates with `gate-list` (never a consuming `check`).
  4. The first time a worker's PR is known, run `orca reference add` with the PR URL on its workspace, so Orca's own sidebar shows the PR.
  5. Once a minute, run `orca agent hooks status`. When hooks are off, `view().hooksOff = true`, and the footer shows "Status hooks off · status may be stale".
- `worker.action` maps to CLI calls:
  - `retry`: `resetAttempts`, then re-send the latest event;
  - `keep`: `orchestration worker-keep-open --dispatch`;
  - `stop`: `orchestration worker-stop --dispatch`;
  - `remove`: `worktree rm --worktree id:<workspaceId>`, only with `confirmed: true` in the input;
  - `message`: `orchestration send --to dispatch:<id>`.
  `gate.resolve` maps to `orchestration gate-resolve`.
- Panel requests registered in `worker.ts` with `orca.panels.handle`:

  | Request | Input → result |
  |---|---|
  | `view.read` | → `ViewModel` |
  | `agents.list` | → `AgentEntry[]` |
  | `firstrun.save` | `{ agent, chatStyle }` |
  | `task.send` | `{ text }` → `'sent' \| 'queued'` |
  | `chat.answer` | `{ msgId, option }` |
  | `gate.resolve` | `{ gateId, option }` |
  | `worker.action` | `{ key, action: 'retry' \| 'keep' \| 'stop' \| 'remove' \| 'message', text? }` |
  | `worker.detail` | `{ key, tab: 'status' \| 'terminal' \| 'diff' }` → `{ lines?: string[], diff?: string }` |
  | `banner.dismiss` | — |
  | `settings.save` | `Partial<Settings>` |
  | `pr.open` | `{ key }` → `shell.openExternal` happens in the panel; the worker returns the URL |

- [ ] **Step 1: Failing tests.**
  - `matchGuard('Bash', { command: 'gh pr merge 4547 --squash' })` gives the `merge` rule.
  - `git push origin HEAD:main` gives `push-main`.
  - `git push origin feat/x` gives `null`.
  - `echo "gh pr merge"` gives `null`: match the command's first segment of each `&&` / `;` / `|` part, not substrings inside quotes.
  - The worker test's `agent.tool.before` returns `{ deny }` only for a `workspaceId` in the owned set (spec call 1). For an unowned workspace it passes.
  - With `guard: false` it always passes.
  - `agent.tool.after` from a non-Claude owned agent sets a banner of kind `attempted`.
  - Watcher test, with fakes:
    - one failing check sends exactly one `orchestration send` to the right dispatch;
    - a second `tick` with the same data sends none;
    - **Review Focus 1:** a `gh` `rate-limited` status sets `view().gh` and sends nothing;
    - an all-green, non-draft PR moves the row to `ready` and calls `notifications.show` once;
    - `reference add` runs once per PR across two ticks;
    - `worker.action` `remove` without `confirmed: true` runs no `worktree rm`.
  - Worker test: `mountWorker(main)` reports no refusals, and `view.read` resolves.
  - No call to the forbidden methods (Global Constraints) appears in `worker.host.calls`.
- [ ] **Step 2:** Run the tests. They FAIL.
- [ ] **Step 3:** Implement.
  - The watcher interval comes from settings. On `rate-limited` it waits `retryInSec`.
  - `start()` runs only while at least one owned PR exists, or the orchestrator is running.
  - When `deps.env('ORCH_FIXTURE') === '1'`, the watcher reads `tests/fixtures/gh-pr.json` and the CLI fixtures instead of calling `gh` or `orca`. This is the dev mode Task 11 uses for stills.
  - When `settings.nightlySweep` turns on, create the automation `orca automations create` (name "Orchestration nightly sweep", schedule `0 2 * * *`, `creationKey: 'orchestration-sweep'`). Turning it off deletes it.
- [ ] **Step 4:** Run the tests. PASS.
- [ ] **Step 5:** Commit: "Watch PRs, route fixes to workers, guard merges and serve the panel".

### Task 10: Panel shell, first run and the Chat view

**Files:**
- Create: `panel/index.html` (icons copied from the prototype's `<symbol>` set), `panel/style.css` (prototype panel styles, using Orca's `--orca-*` tokens as in now-playing's `panel-css.ts`), `panel/app.js` (router, 1s `view.read` poll while visible), `panel/chat.js`, `panel/firstrun.js`, `panel/esc.js`
- Test: `tests/panel-esc.test.mjs`

**Interfaces:**
- Consumes the Task 9 requests.
- Produces `window.OrchEsc.html(s: string): string` and `window.OrchViews.chat(vm, actions)` / `.firstRun(vm, agents, actions)`. Each returns an HTML string. `app.js` owns event delegation through `data-act` attributes.

- [ ] **Step 1: Failing test (Review Focus 5).** `OrchEsc.html('<img src=x onerror=1>&"')` returns `&lt;img src=x onerror=1&gt;&amp;&quot;`. Load `panel/esc.js` in node with `vm.runInNewContext` and a `window` stub.
- [ ] **Step 2:** Run the test. It FAILS.
- [ ] **Step 3:** Implement these views to match the prototype's pages 1–3:
  - **First run:** installed agents first, a "Not installed (N)" disclosure, Chat | Terminal, and the "runs hidden… never opens as a tab" note.
  - **Chat empty:** two starter buttons.
  - **Chat style:** a status line plus bubbles, with question buttons that send `chat.answer`.
  - **Terminal style:** the `worker.detail`-style mirror of the orchestrator terminal, refreshed each poll.
  - **Queued note:** "N message(s) queued · sends when the orchestrator finishes its turn".
  - **Header:** a Chat/Terminal | Board toggle, with a red dot when any row is in `needs` while Chat is shown.
  - Every interpolated string goes through `OrchEsc.html`.
- [ ] **Step 4:** Run the test. PASS. Then run `orca plugin dev load .` and `orca plugin shot orchestration` for first run, Chat empty, Chat working and Terminal style. Compare them by eye with the prototype.
- [ ] **Step 5:** Commit: "Add the panel shell, first run and the Chat view".

### Task 11: Board (list and kanban), row menu, gates, banner and footer

**Files:**
- Create: `panel/board.js`
- Modify: `panel/app.js`, `panel/style.css`

**Interfaces:**
- Produces `window.OrchViews.board(vm, actions)`.

- [ ] **Step 1:** Implement to match the prototype's pages 4–5:
  - Groups in this order: Needs you, Fixing, Watching, Ready for you. Rows show name + suffix, `#PR`, tags (draft, kept open, stopped, non-Claude agent label) and the detail line.
  - A `@container (min-width: 640px)` rule switches to four kanban columns.
  - A ⋯ menu with Details, Diff, Terminal, Message worker, Retry fix, Keep open, Stop worker, and Remove worktree… Remove asks first, inline, with the copy "Its branch and PR stay on GitHub."
  - Gate rows show their option buttons, which send `gate.resolve`.
  - A blocked or attempted banner, dismissible.
  - Footer text:
    - "Polling GitHub · {n}s"
    - "Not watching any PRs"
    - "gh not signed in"
    - "GitHub rate limited · retrying in {n}s"
    - "Merge guard on" or "{n} block(s) today", or "Merge guard off" in the danger tone.
- [ ] **Step 2: Verify.** Run `orca plugin dev load .`, then trigger `orca plugin dev request orchestration view.read` against a fixture-backed dev mode (`ORCH_FIXTURE=1` makes the watcher read `tests/fixtures/` instead of `gh`). Take `orca plugin shot` stills at 400px and 760px. Each must match the prototype's Board narrow and wide views.
- [ ] **Step 3:** Run `orca plugin test .`. PASS: no regressions.
- [ ] **Step 4:** Commit: "Add the Board with kanban, row actions, gates and the guard banner".

### Task 12: Worker details and the Settings view

**Files:**
- Create: `panel/detail.js`, `panel/settings.js`
- Modify: `panel/app.js`

**Interfaces:**
- Produces `window.OrchViews.detail(vm, key, tab, detailData, actions)` and `.settings(vm, agents, actions)`.

- [ ] **Step 1:** Implement to match prototype pages 6–7.
  - **Details:** a back arrow and header (name, `#PR · branch · agent`, state dot). A Status | Terminal | Diff switch:
    - *Status:* checks, review threads, attempts meter, last thing sent;
    - *Terminal:* a read-only mirror;
    - *Diff:* the `gh pr diff` text in a monospace block.
  - Detail buttons: Retry fix, Keep open, Stop, and PR on GitHub. The last one calls `window.orca.call('shell.openExternal', { url })` from a click.
  - A message box sends `worker.action` `message`. Below it, the text "via orchestration send".
  - **Settings:** a back arrow, the eight settings from Global Constraints, saved with `settings.save`.
- [ ] **Step 2: Verify** with `orca plugin shot` at 400px for Details (each tab) and Settings, compared against the prototype. Confirm that Orca's main area still has the same tabs as before.
- [ ] **Step 3:** Run `orca plugin test .`. PASS.
- [ ] **Step 4:** Commit: "Add worker details and in-panel settings".

### Task 13: End-to-end proof, catalog release and draft PR

**Files:**
- Modify: `orca-catalog.json`, `plugins/orchestration/README.md`
- Create: `plugins/orchestration/media/cover.png`, `media/screens.png`

- [ ] **Step 1: Real run.** In Orca, load the plugin and pick Claude, Chat style. Send "Close out PR #<a small open yimby PR> to merge-ready". Confirm, and note each result in the PR body:
  - (a) no new tab or visible workspace for the orchestrator;
  - (b) a worker named `…-oa` appears on the Board with the PR;
  - (c) a red CI run is sent to the worker once;
  - (d) a `gh pr merge` attempt by the worker is blocked with the banner;
  - (e) the PR reaches Ready only when green, non-draft, threadless and mergeable.
- [ ] **Step 2:** Write the README: what it does, install from the catalog, settings, the "never merges" note, and the requirements (`gh` signed in, Orca ≥ 1.4.259).
- [ ] **Step 3:** Run `orca plugin release-entry plugins/orchestration`, add the entry first in `orca-catalog.json` with id `aamonnaig4.orchestration`, then run `orca plugin validate orca-catalog.json`. No errors.
- [ ] **Step 4:** Open a **draft** PR. Follow the repo's PR rules (memory: Orca-style template; attach proof media, never commit it; `scripts/check_pr_screenshots.sh`). The body includes:
  - Before/After stills at desktop and phone width, and a GIF of first run → task → Board → details (AGENTS.md §3, §5, §6);
  - an "Autonomous decisions" list (AGENTS.md §9).
- [ ] **Step 5:** Get the required checks green, then mark the PR ready (AGENTS.md §4). Never merge.
