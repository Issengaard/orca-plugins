# Orchestration panel: an orchestrator and PR babysitter for Orca

Date: 2026-11-15 · Plugin: `plugins/orchestration` (new) · Mockups: `docs/design/orchestration-panel/mockup-sidebar.html` (round 4 shows every page)

## Why

Aamon runs many agents across worktrees in Orca. Starting the work is easy. What drags is everything after a PR opens: noticing a red CI run, a new review comment or a merge conflict, then telling the right agent to fix it, then checking again. Agent Orchestrator (orchestrator.inc, Apache-2.0) closes that loop, but it is a second app with its own worktrees, database and agents beside Orca. This plugin brings the same loop into Orca, built on Orca's own orchestration, so Orca stays the one place work happens.

The plugin is the default way to orchestrate in Orca: a sidebar panel where you describe a task, an orchestrator agent plans it and starts workers in their own worktrees, and the plugin watches every worker's PR and routes failures back to the worker that owns it until the PR is ready for Aamon to merge.

## Goals

1. A right-sidebar panel with a **Chat | Board** toggle that shows one view at a time.
2. **Any Orca agent** can be the orchestrator, and any Orca agent can be a worker, matching Orca's own agent list (Settings → Agents).
3. **PR babysitting** in plugin code: check GitHub on a timer, and send each CI failure, unresolved review thread and merge conflict to the worker that owns the PR, waiting until that worker is idle.
4. A **merge guard** that stops agents from merging, force-pushing or pushing to `main`.
5. Spend agent usage only on real work: watching and routing are plain code, and an agent is woken only when there is something to fix.

## Non-goals

- The plugin never merges and offers no merge button. Merging is Aamon's.
- No cloud, no hosted service, no paid API. GitHub access goes through the user's existing `gh` login.
- No planning logic in plugin code. Planning is the orchestrator agent's job, using Orca's `orca orchestration` commands.
- **No tabs, only the sidebar.** The plugin never opens anything in Orca's main area: not the orchestrator, not a worker, terminal, diff or settings. The orchestrator never appears in Orca's main area or left sidebar. Everything the plugin shows lives in the side panel. (Worker worktrees still appear in Orca's own left sidebar because Orca lists every worktree; the plugin does not open them.) The one exit is "PR on GitHub", which opens the browser, not an Orca tab.
- GitHub only in v1. GitLab and others are out.
- Watching PRs that no worker owns (Aamon's own PRs) is out for v1.

## Anti-goals (a failure even if it works)

- An agent merges a PR, force-pushes, or pushes to `main` while the guard is on.
- The same failure or comment is sent to a worker twice.
- A message is typed into a worker while it is mid-turn.
- A worker loops forever on a failure it cannot fix.
- Agent usage spent while nothing changed on GitHub.
- The panel shows a PR as "Ready" when it is not (checks pending, unresolved threads, or conflicts).

## Constraints (from Orca's plugin API 1.9 and this machine)

- **Plugin shape:** `execution: "trusted-worker"`, so the worker has full Node (`fetch`, `child_process.execFile`), as Now Playing already uses. Panel is `ui: "html"`.
- **No installed-agent list in the API.** `agent.launch`, `workspace.create` and `agent.resume` take an agent id, but nothing lists which agents are installed. The plugin keeps a catalog of Orca's agent ids and their commands (from Settings → Agents, e.g. `claude`, `codex`, `grok`, `gemini`, `agy`, `cursor-agent`, `copilot`, `opencode`, `aider`, …) and detects installed ones by checking for each command in a login shell (`command -v`), as Orca's "detected" count does.
- **Plugins cannot read or type into an Orca chat.** `terminal.read` and `terminal.sendText` work on terminals only. This decides the Chat view (Approaches).
- **Background launch:** the host API's `agent.launch` starts an agent CLI in a new terminal of a workspace in the background and returns its terminal id; `project.setHidden` hides a project from the sidebar while its terminals keep running. Together these keep the orchestrator out of sight. Workers may still use any surface; they are reached through orchestration mail, not the panel.
- **Messaging workers:** `orca orchestration send --to dispatch:<id>` reaches a worker whatever its surface, and is delivered when its current turn ends. This is the routing channel for workers started by orchestration.
- **Merge guard reach:** the `agent.tool.before` hook can deny a tool call only for Claude Code. For other agents Orca only reports the call (`agent.tool.after`), and agents on SSH or WSL hosts are not hooked.
- **No PR or CI data in the API.** All GitHub state comes from `gh api graphql` via `execFile`, using the user's `gh` login.
- **Orca must be running** (desktop or `orca serve`). Nothing watches while it is closed.
- **Width:** the panel is an iframe, so the narrow/wide switch is a CSS container or media query on the panel's own width.
- **Orca's orchestration guide forbids coordinators polling their mailbox.** The plugin polls GitHub, not Orca mail, so this does not apply to it, but the orchestrator agent's prompt must not ask it to poll.
- **Borrowed text:** if any wording is taken from Agent Orchestrator's worker prompt (`~/.ao/data/prompts/*/system.md`), the plugin carries an Apache-2.0 NOTICE. The plugin's name must not use theirs.
- **Repo rules:** no comments in source (`hooks/check_source_comments.py`), draft PRs, before/after visuals for UI.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | The orchestrator runs in a hidden background terminal and posts short messages to a small local server the plugin runs; the panel shows them as chat for every agent | Works with every agent and keeps everything in the panel; Chat style shows only what the agent chooses to post |
| B | Parse the agent's terminal output into chat bubbles | Breaks across ~45 agents' different screens and every agent update |
| C | Use Orca's own Chat surface for agents that support it, and Terminal for the rest | The panel cannot show Orca chats, so the orchestrator would live in an Orca tab |

Aamon first picked C, then set a harder rule: **the orchestrator is never a tab; it lives only in the side panel.** Plugins cannot show or type into an Orca chat, so C cannot meet that rule. **A** is the design.

## What gets built

### Where the orchestrator lives

- The orchestrator always runs as a **terminal agent** (`agent.launch`, which runs in the background) in a workspace of a plugin-owned folder project, e.g. `~/.orca-orchestration/<project>`. The plugin hides that project from Orca's sidebar with `project.setHidden`, so no tab or workspace for the orchestrator is ever shown. It never uses Orca's Chat surface, for any agent.
- It reaches the real repository with `--repo` on `orca orchestration worker-start` (and `--repo` on other commands). Verifying this from the hidden folder is the first task of the build; if it fails, the fallback is a hidden terminal in the repo's own main workspace that the plugin never focuses.
- The plugin finds the orchestrator's terminal with `terminal.list` on that workspace, and keeps its session id (`agent.status.changed`) so a closed orchestrator resumes with `agent.resume` instead of starting fresh.

### The Chat view

Everything happens in the panel. There is no "Show chat", no "Open full terminal", and nothing ever opens in Orca's main area for the orchestrator.

- **Input, both styles:** the panel's box. Messages and new tasks go to the orchestrator's terminal with `terminal.sendText` when its status is waiting or done (`agent.status.changed`). While it is working, the panel holds them and shows "Queued · sends when the orchestrator finishes its turn".
- **Chat style:** the plugin worker runs a local HTTP server on `127.0.0.1` with a random port and a per-launch token. The `agent.launch.before` hook adds `ORCA_ORCH_URL` and `ORCA_ORCH_TOKEN` to the orchestrator's environment. Its standing instructions tell it to post every progress update, question and result with one shell command (e.g. `curl -s "$ORCA_ORCH_URL/say" -H "x-token: $ORCA_ORCH_TOKEN" -d '{"kind":"question","text":"…","options":["Yes","No"]}'`). The panel shows these as chat bubbles; questions get buttons whose answers go back through `terminal.sendText`. Messages are kept in plugin storage so the chat survives a panel reload or Orca restart.
- **Terminal style:** the panel shows the hidden terminal itself (`terminal.read`, up to 2000 lines, refreshed about once a second while the panel is open), full height of the Chat view, with the same input box below it.
- **Chat style is a setting** (first run and Settings): *Chat* (default) or *Terminal*. It changes only how the panel shows the orchestrator, never where it runs. Every agent supports both, because both work on a terminal.
- Starting a task: the box on page 2, the box in the working Chat view, or **+** on the Board (which switches to Chat and focuses the box). One orchestrator per project; see "Decided by Aamon".

The interactive prototype (`docs/design/orchestration-panel/prototype.html`) shows this.

### Pages (mockups round 4)

1. **First run.** Pick the orchestrator agent from installed agents (others listed below as "not installed") and Chat style: *Chat* (default) or *Terminal*. Both work for every agent.
2. **Chat, empty.** Task box and two starter suggestions.
3. **Chat, working.** As described above, in Chat or Terminal style. A red dot on the Board label when the Board has something in "Needs you".
4. **Board, narrow.** Rows grouped **Needs you / Fixing / Watching / Ready for you**. Click opens that worker's details in the panel (page 7). **+** starts a new task. Blocked-merge banner above the footer, dismissible.
5. **Board, wide.** The same groups as kanban columns, automatically at about 640px panel width and up.
6. **Settings**, opened from the panel's gear as a panel view with a back arrow (the same settings are also declared in the manifest, so they appear in Orca's Settings → Plugins): Chat style, orchestrator agent, default worker agent, worker name suffix (default `-oa`), GitHub check interval (default 60s), fix attempts before asking (default 3), merge guard on/off (default on).

7. **Worker details** (new, from Aamon's "no tabs, only sidebar"). A panel view with a back arrow to the Board. Header: worker name, PR number, branch, agent, state dot. A **Status | Terminal | Diff** switch: *Status* lists checks, open review threads, the fix-attempt meter and the last thing sent to the worker; *Terminal* is a read-only mirror of the worker's terminal (`terminal.read`); *Diff* shows the PR's changes (`gh pr diff`). Buttons: Retry fix, Keep open, Stop, PR on GitHub (browser). A message box at the bottom sends to the worker with `orchestration send`. Gate questions show their answer buttons here too.

Footer, always: GitHub watch status ("Polling GitHub · 60s", "Not watching any PRs", or an error such as "gh not signed in") and merge guard status ("Merge guard on", "1 block today").

### Orchestrator and workers

- The orchestrator is an ordinary Orca agent launched in the project's workspace with a standing instruction block (plugin-owned text) telling it to plan with `orca orchestration`, start workers with `worker-start` using the configured worker agent, name each worker with the suffix, open draft PRs, never merge, and never poll.
- Workers are started by the orchestrator through Orca orchestration, so they get Orca's task, dispatch, `ask` and `worker_done` machinery for free.
- **Ownership:** a worker owns a PR when the PR's head branch is the worker workspace's branch. The plugin builds the map from `workspace.list` (branch per workspace) and `gh pr list --head <branch>`, and stores it with the worker's dispatch id.
- **Suffix:** the `workspace.create.before` hook adds the suffix to workspaces created while an orchestration run of this plugin is active for that project (see Open questions).

### The babysitting loop

Every interval, for each project with owned PRs, one GraphQL query per repository fetches, for each owned PR: head SHA, status check rollup with each failing check's name and run id, unresolved review threads with comment ids, and mergeable state.

Events and where they go:

| Event | Dedupe key | Sent to the worker |
|---|---|---|
| Check failed | PR + head SHA + check name | Check name, run URL, last ~80 lines of the failing job log (`gh run view --log-failed`) |
| New unresolved review thread or comment | comment id | File, line, comment text, thread URL |
| Merge conflict | PR + base SHA | "Merge `origin/<base>` into your branch and resolve conflicts" |

- **Delivery:** `orca orchestration send --to dispatch:<id>`. Orca delivers it when the worker's turn ends, so a working agent is never interrupted. For a worker that has finished and closed, `send` reopens it (Orca's documented behavior).
- **Attempts:** each failure signature (PR + check name, regardless of SHA) counts fix attempts. After the setting's limit, the PR moves to **Needs you** and Orca shows a desktop notification. It is not sent again until Aamon acts (clicks the row's Retry, or a new commit lands from elsewhere).
- **Board state per PR:** *Needs you*: a worker `ask` is pending, the attempt limit was hit, or a merge was blocked. *Fixing*: an event was sent and the worker has not pushed since. *Watching*: checks running and nothing to send. *Ready for you*: all required checks green, no unresolved threads, mergeable. Ready also sends one desktop notification.

### Merge guard

- `agent.tool.before` denies, for Claude Code, any shell tool call matching: `gh pr merge`, `gh api` calls to a merge endpoint, `ao pr merge`, `git push --force` / `-f` / `--force-with-lease`, and `git push` whose target is `main` or `master`. The deny reason tells the agent merging is Aamon's.
- For other agents, `agent.tool.after` records the same patterns and shows the banner as "attempted", not "blocked", since the plugin could not stop it.
- The orchestrator and worker instructions also forbid these, so non-Claude agents are covered by instruction.

## Using the whole Orca CLI

Aamon's requirement: the plugin must take full advantage of the Orca CLI so it can manage everything Orca can do, not a subset. The CLI has 334 commands (`orca agent-context`, schema v1), which is far more than the plugin host API. Two actors use it:

- **The orchestrator agent** drives planning and work. Its standing instructions start with the version-matched guide (`orca skills get orchestration`, plus `--reference` files as the guide directs) so it always matches the installed Orca.
- **The plugin worker** (trusted, Node) calls the CLI with `execFile` for anything the host API lacks, always with `--json`, and parses the receipts. At startup it reads `orca agent-context --json` and enables only the commands this Orca build offers, so a newer or older Orca degrades gracefully instead of failing.

| Area | CLI commands | Who | Used for |
|---|---|---|---|
| Runs and tasks | `orchestration run-create`, `run-list`, `run-show`, `task-create` (with `--deps`, `--parent`), `task-list`, `task-update`, `dispatch`, `dispatch-show` | Orchestrator plans; plugin reads | Task DAGs; the Board's task titles and dependencies; finding the panel's runs |
| Workers | `orchestration worker-start` (`--agent`, `--worktree new-child/new-top-level`, `--name`, `--display-name`, `--comment`, `--base-branch`, `--model`, `--effort`, `--on`, `--keep-open`, `--retry-of`), `worker-show`, `worker-read`, `worker-list`, `worker-stop`, `worker-abandon`, `worker-release`, `worker-keep-open` | Orchestrator starts; plugin reads and acts on row actions | Any agent as a worker, any placement (local, child worktree, SSH, paired server); per-row Stop, Keep open, Retry |
| Messaging and gates | `orchestration send`, `ask`, `reply`, `inbox` (read-only), `gate-create`, `gate-list`, `gate-resolve` | Plugin sends fixes and tasks; orchestrator raises gates; Aamon resolves from the panel | Routing CI/review/conflict events; "Needs you" rows; answering a gate from the panel with `gate-resolve` |
| Ownership marker | `worker-start --comment "orchestration-plugin run:<id>"`, `worktree set`, `worktree show` | Orchestrator writes; plugin reads | A reliable marker in Orca's own metadata for which worktrees belong to the panel's runs, alongside the run id |
| Worktrees | `worktree list`, `show`, `current`, `set`, `activate`, `rm`, `ps`; `workspace cleanup preview/run/report` | Plugin | Board rows, waking a sleeping worker's worktree without focusing it, renaming, removing a finished worker's worktree (row action, asks first), cleanup of merged work. `workspace.open` is never called |
| PR links | `reference add`, `reference list`, `reference find` | Plugin | Attaching each worker's PR URL to its workspace, so Orca's own sidebar shows the PR too; finding a workspace from a PR URL |
| Agents | `agent.launch` (host API, background terminal), `agent launch --model --effort` when a model is set, `agent hooks status`, `claude-teams` | Plugin launches the orchestrator in its hidden project; checks hooks are on | Any Orca agent as the orchestrator, always as a hidden terminal; warns in the footer if status hooks are off (status and queued sends would stall) |
| Hidden home | `project setup-existing-folder` (or `repo add`), `project.setHidden` (host API), `repo hide` | Plugin, once per project | Creating and hiding the orchestrator's folder project |
| Terminals | `terminal list`, `show`, `read`, `send`, `wait`, `create`, `close` | Plugin | The orchestrator's hidden terminal (Terminal style and all input) and the read-only worker Terminal view in the panel. `terminal switch`/`focus` are never called, since they bring a tab forward |
| Diffs and ports | `gh pr diff` (via `gh`), `ports` | Plugin, worker details | The Diff view inside the panel; showing a worker's dev server port. `file open`/`file diff` are not used because they open tabs |
| Repos and projects | `repo list`, `repo show`, `repo set-base-ref`, `repo search-refs`, `project list` | Plugin | Project picker in the panel header; base branch for new workers |
| Automations | `automations list`, `create`, `edit`, `run`, `runs` | Plugin, opt-in | A scheduled "sweep" (for example nightly: re-check every open panel PR) that runs even when the panel is closed but Orca is open |
| Hosts | `host list`, `environment list` | Plugin | Offering remote placement for workers when a paired server or SSH host exists |
| Sessions | `search`, `agent.listSessions` (host API), `agent.resume` (host API) | Plugin | Resuming a closed orchestrator or worker by session id instead of starting fresh |

Never used by the plugin: anything that merges, `orchestration reset` (destroys run state), and `computer` commands. `worktree rm` and `workspace cleanup run` only run after Aamon confirms in the panel.

**Row actions this adds to the Board** (a "⋯" menu on each row and kanban card): Details · Diff · Terminal · Message worker (each opens the worker details view in the panel) · Retry fix · Keep open · Stop worker · Remove worktree (asks first, in the panel). Rows in **Needs you** from a gate get inline answer buttons that call `gate-resolve`.

## Left to the builder

- Storage schema, GraphQL query shape, and the panel ↔ worker request names.
- The agent catalog's exact source format and refresh (a static list in the plugin, refreshed on the Refresh button and at startup).
- Exact width breakpoint (about 640px) and how the terminal mirror refreshes.
- Log tail length and how logs are trimmed before sending.
- Test approach: `orca plugin test` for pure logic (dedupe, state, guard patterns), then `orca plugin dev load` against one real yimby PR.

## Calls made after the builder check (builder's or Claude's, for Aamon to check)

1. **Guard scope:** the guard applies only to tool calls from this plugin's orchestrator and workers, matched by workspace/terminal through the ownership map. Aamon's own sessions are untouched (his global `guard_push.py` already covers them, and AGENTS.md §10 lets him approve a merge in-session).
2. **Who answers a worker's question:** the orchestrator, as Orca's orchestration guide expects. A row reaches **Needs you** only when the orchestrator raises a decision gate for Aamon (`orca orchestration gate-create`; the plugin reads `gate-list`, never a consuming `check`), when the attempt limit is hit, or when a merge was blocked. The orchestrator's standing instructions say to raise a gate whenever the answer is not in the task or Aamon's rules. Aamon answers from the row's inline buttons (`gate-resolve`) or in the panel's Chat view.
3. **Suffix:** no hook. The orchestrator's instructions tell it to pass `--name <short-name><suffix>` to `worker-start`. The plugin does not rely on the suffix to recognise workers.
4. **Ready for you** requires all of: PR is not a draft, at least one check reported, every reported check passed (required or not), no unresolved review threads, and mergeable. A draft PR with everything green shows under **Watching** with a "draft" tag, since workers mark their own PRs ready when proven (AGENTS.md §4).
5. **Chat-surface workers:** the orchestrator is always a terminal, so it is always hooked. Workers may run as Orca chats; the build verifies early whether `agent.tool.before` and `agent.status.changed` fire for them. If they do not, the guard falls back to "attempted" banners plus instructions for those workers (Aamon's global Claude hook still blocks merges), and the orchestrator's `worker-start` instructions prefer terminal workers while the guard is on.
6. **Which comments are sent:** unresolved review threads from anyone except the PR's own author account, plus top-level PR conversation comments from humans. Bot comments are batched into one message per new head SHA. A thread is sent once (by comment id); replies in an already-sent thread are sent as they arrive.

## Decided by Aamon after the builder check

- **One orchestrator per project.** Each project keeps one long-running orchestrator. The plugin records it (hidden workspace, terminal id, session id, agent, run id) when it launches it. A new task from the panel goes to that orchestrator's terminal when it is idle; while it is working, the panel shows the task as queued until it sends. If no orchestrator is running for the project, the task launches one with the task as its prompt.
- **Only the panel's runs are babysat.** The plugin watches PRs of workers in runs started by an orchestrator it launched. It learns the run by matching the orchestrator's terminal in `orca orchestration run-list`, and the dispatch id per worker from `worker-list`. Orchestration runs Aamon starts elsewhere are ignored.

## Open questions

None.
