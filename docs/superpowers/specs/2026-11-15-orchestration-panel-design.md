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
- No replacement for Orca's chat UI. The panel never renders an Orca chat (see Constraints).
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
- **Chat vs CLI surface:** the host API's `agent.launch` has no surface parameter. The CLI does: `orca agent launch --agent <id> --surface chat|terminal`, and `orca worktree create --agent`. The trusted worker calls the CLI for launches that need a surface.
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
| A | The orchestrator posts short messages to a small local server the plugin runs; the panel shows them as chat for every agent | Works with every agent; the chat shows only what the agent chooses to post |
| B | Parse the agent's terminal output into chat bubbles | Breaks across ~45 agents' different screens and every agent update |
| **C (picked)** | Use Orca's own Chat surface for agents that support it, and Terminal for the rest | Uses what Orca already does well; the panel cannot show Orca chats, so chat-surface agents are talked to in their Orca tab |

Aamon picked **C**.

## What gets built

### The Chat view, under C

The orchestrator runs in its own Orca tab in a workspace, launched with the surface from Orca's per-agent Chat | CLI choice (Settings → Agents), unless the plugin's "Chat style" setting overrides it.

- **Orchestrator running as an Orca chat** (agents with Chat support, e.g. Claude, Codex, Grok, Copilot, OpenCode, Kimi): the Chat view shows the orchestrator's name, its status (working / waiting / done from `agent.status.changed`), the latest worker reports the plugin knows about, and a **Show chat** button that focuses its Orca tab. There is no message box in the panel.
- **Orchestrator running as a terminal** (any agent, and the only option for agents without Chat): the Chat view mirrors the terminal (`terminal.read`, refreshed while the panel is open) with a box that types into it (`terminal.sendText`) and **Open full terminal**.
- Starting a task: the box on page 2 (or **+** on the Board) launches the orchestrator if none is running for this project, with the task as its prompt; otherwise it sends the task to the running orchestrator (terminal) or opens its chat tab with the task ready (chat). See Open questions.

This changes round 4's page 3 left mockup (chat bubbles in the panel). The mockup should be redrawn to the bullets above before building.

### Pages (mockups round 4)

1. **First run.** Pick the orchestrator agent from installed agents (others listed below as "not installed") and Chat style: *Follow Orca's setting* (default), *Chat*, *Terminal*. Agents without Chat support show Terminal only.
2. **Chat, empty.** Task box and two starter suggestions.
3. **Chat, working.** As described above, per surface. A red dot on the Board label when the Board has something in "Needs you".
4. **Board, narrow.** Rows grouped **Needs you / Fixing / Watching / Ready for you**. Click opens the worktree (`workspace.open`). **+** starts a new task. Blocked-merge banner above the footer, dismissible.
5. **Board, wide.** The same groups as kanban columns, automatically at about 640px panel width and up.
6. **Settings** (Settings → Plugins): Chat style, orchestrator agent, default worker agent, worker name suffix (default `-oa`), GitHub check interval (default 60s), fix attempts before asking (default 3), merge guard on/off (default on).

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

## Left to the builder

- Storage schema, GraphQL query shape, and the panel ↔ worker request names.
- The agent catalog's exact source format and refresh (a static list in the plugin, refreshed on the Refresh button and at startup).
- Exact width breakpoint (about 640px) and how the terminal mirror refreshes.
- Log tail length and how logs are trimmed before sending.
- Test approach: `orca plugin test` for pure logic (dedupe, state, guard patterns), then `orca plugin dev load` against one real yimby PR.

## Open questions

Filled in after the builder check.
