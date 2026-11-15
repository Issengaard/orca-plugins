# Orchestration panel: one chat that manages all the work in Orca

Date: 2026-11-15 (rewritten the same day after the plan review and four design rounds) · Plugin: `plugins/orchestration` (new)

Layout source of truth: `docs/design/orchestration-panel/mockup-decisions.html` (the composition round, confirmed `1A`). `prototype.html` and `mockup-sidebar.html` in the same folder predate these picks; use them only for tokens, icons and spacing.

Reference: `github.com/OrchestratorInc/agent-orchestrator` (Apache-2.0). This plugin is an Orca-centric, simplified version of it.

## Why

Aamon runs many agents across worktrees and projects in Orca. Starting work is easy. What drags is everything after: noticing a red CI run, a review comment, a merge conflict or an agent stuck on a prompt, then telling the right agent, then checking again. The reference app closes that loop, but it is a second app with its own worktrees, database and agents.

This plugin brings the loop into Orca, built on Orca's own CLI and orchestration. The goal, in Aamon's words: **a chat in the panel that acts as my orchestrator to manage all my work.**

## Goals

1. **One chat.** A side panel whose Chat view is a conversation with one orchestrator agent that covers every project.
2. **Every session.** The plugin tracks every agent session in Orca on this computer, with or without a PR, whether the orchestrator started it or Aamon did by hand.
3. **A Board for progress.** A second view sorts sessions into lanes: Needs you, Building, Validating, Needs review, Ready.
4. **Babysitting in plain code.** The plugin checks GitHub on a timer and sends each CI failure, review comment and merge conflict to the session that owns the PR, when that session's agent is idle.
5. **Approvals come to the chat.** When any tracked agent is stuck on a permission prompt, a card appears in the chat with Allow once, Deny and Peek.
6. **A merge guard** that stops the orchestrator and the sessions it started from merging, force-pushing or pushing to `main`.
7. **Agent usage only for real work.** Watching, sorting and routing are plugin code. An agent is woken only when there is something for it to do.

## Non-goals

- The plugin never merges and has no merge button.
- No cloud, no hosted service, no paid API. GitHub goes through the user's `gh` login.
- No planning logic in plugin code. Planning is the orchestrator agent's job.
- **No tabs.** The plugin never opens anything in Orca's main area. The one exit is "PR on GitHub", which opens the browser.
- GitHub only. Sessions in projects that are not on GitHub are tracked without PR data.
- This computer only in v1. Sessions on SSH hosts and paired servers are not tracked.
- No reviewer agents, no browser preview, no mobile app, no automations (all in the reference, all out of v1).

## Anti-goals (a failure even if it works)

- An agent the orchestrator started merges, force-pushes or pushes to `main` while the guard is on.
- The same failure or comment is sent to a session twice.
- Text is typed into an agent that is mid-turn or sitting on a permission prompt.
- An agent loops forever on a failure it cannot fix.
- Agent usage is spent while nothing changed.
- A session shows as Ready when checks are pending, a thread is unresolved or the PR conflicts.
- An agent sits blocked on a prompt and nothing in the panel says so.

## Settled design (Aamon's picks, 2026-11-15)

| Pick | Decision |
|---|---|
| 1B | Every session is tracked, PR or not |
| 2A | One orchestrator chat for every project |
| Chat only | The Chat view holds only the chat. Progress lives in the Board |
| 3F | A red dot on the Board tab when a session needs Aamon |
| 4B′ | Approvals arrive as chat cards; the Board row has the same buttons |
| 8B | Lanes: Needs you, Building, Validating, Needs review, Ready |
| 6A | One "Idle · N sessions" line under the lanes |
| 5B | A status bar count only when something needs Aamon |
| Gear | The settings gear sits in the footer's bottom right corner |

## Constraints (checked against Orca 1.4.259, host API 1.9)

- **Plugin shape:** `execution: "trusted-worker"`. The worker has full Node (`child_process`, `fs`). The panel is plain HTML and JS.
- **The worker must stay alive with the panel closed.** Orca keeps a worker running only for plugins with a status bar item. The plugin declares one (pick 5B), which doubles as the keep-alive.
- **Session list:** `workspace.list({ includeStatus: true })` gives every workspace with its agent status. `orca worktree list --json` gives branch, `comment`, `repoId`, `projectId` (for example `github:owner/repo`), `isMainWorktree` and `path`. The two are joined on `path`.
- **Three id shapes exist** for one workspace (`repoId::path`, an instance id, and the id hooks carry). The plugin keeps every known id per session and looks sessions up by any of them, by path or by terminal.
- **Agent status:** the `agent.status.changed` event reports `working`, `blocked`, `waiting` or `done` per terminal, with `terminalId` and `sessionId`.
- **Reading a terminal:** the host's `terminal.read` returns raw stream output, which is unreadable for agent TUIs. The plugin uses `orca terminal read --screen --json` for anything it shows.
- **Messaging:** `orca orchestration send --to dispatch:<id>` reaches a worker the orchestrator started, whatever its surface, when its turn ends, and reopens a closed one. Any other session is reached by typing into its agent terminal with `terminal.sendText`, which the plugin does only while that agent is idle.
- **A routed fix wakes the orchestrator.** A finished worker treats `send` as a follow-up Task and reports `worker_done` to its coordinator. The orchestrator's instructions tell it to end its turn on those.
- **No surface flag on `worker-start`.** Workers run as a chat or a terminal according to Aamon's own Orca setting. Tool hooks and terminal reads reach terminal agents only.
- **Hooks fail open.** A hook that takes more than 2 seconds or throws is treated as a pass, so the guard handler reads memory only.
- **Merge guard reach:** `agent.tool.before` can deny a tool call only for Claude Code in a terminal. For other terminal agents Orca only reports the call afterwards.
- **`run-list` returns only `id` and `objective`.** It cannot say which Run belongs to the orchestrator, so ownership does not use it.
- **Orca's orchestration guide forbids coordinators polling.** The plugin polls GitHub and Orca; the orchestrator never does.
- **Borrowed text:** any wording taken from the reference carries an Apache-2.0 NOTICE. The plugin's name must not use theirs.
- **Repo rules:** no comments in source, draft PRs, before and after visuals for UI.

## What gets built

### Sessions

A session is one Git worktree workspace on this computer. It is shown when it has an agent (any status) or an open PR. Main worktrees with neither are left out, and so is the orchestrator's own folder.

Each session records: name, project, branch, its agent's state and terminal, whether the orchestrator started it, and its PR once one exists.

**Started by the orchestrator** means either of:
- its worktree `comment` starts with the plugin's marker (`orch:<id>`, passed with `worker-start --comment`), or
- the orchestrator reported its dispatch with `./bin/say track <dispatch_id>`.

Every other session is **yours** and carries no tag. Orchestrator-started sessions use the worker name suffix (default `-oa`), which is how they read on the Board.

### The orchestrator

- **One orchestrator for everything.** It runs as a terminal agent in a plugin-owned folder, `~/.orca-orchestration/home`, added to Orca as a folder project and hidden from the sidebar. It never appears as a tab.
- **Standing instructions live in the folder**, as `AGENTS.md` with a `CLAUDE.md` that points to it, so they survive context compaction and a fresh session. They tell it to:
  - start with `orca skills get orchestration`;
  - read `board.md` for the current state of every session and project instead of polling anything;
  - start workers with `orca orchestration worker-start --repo id:<repoId> --worktree new-top-level --name <short-name><suffix> --comment "<marker>" --agent <workerAgent>`, then run `./bin/say track <dispatch_id>`;
  - post every progress update, question and result with `./bin/say`;
  - message any session with `./bin/tell <session> <text>`, never by typing into a terminal;
  - have workers open draft PRs, never merge, never force-push;
  - end its turn at once on a `worker_done` for a fix the panel routed.
- **`board.md`** is written by the plugin into the home folder whenever the Board changes: every session with its lane, status phrase, project, branch, PR and dispatch id, plus every project's repo id and path.
- **Talking back without a server.** `./bin/say <kind> <text>` and `./bin/tell <session> <text>` are small shell scripts that drop one file each into `outbox/`. The worker reads and deletes them. There is no port and no token, so nothing breaks when the worker or Orca restarts.
- **Permissions:** the folder's `.claude/settings.json` allows `orca`, `gh`, `./bin/say` and `./bin/tell`, so Claude Code does not stop on them. Anything that still stops it surfaces as an approval card like any other session.
- **Resume, not restart:** the plugin stores the orchestrator's session id and resumes it with `agent.resume` when its terminal is gone.

### The Chat view

Only the chat. Header: Chat | Board and **+**. Footer: GitHub status, merge guard status, and the gear at the right.

- **Your messages** go to the orchestrator's terminal when it is idle. While it is working they are held and the view shows "N queued · sends when the orchestrator finishes its turn".
- **Orchestrator messages** are what it posts with `./bin/say`: `text`, `progress`, `result`, and `question` with option buttons. An answer is sent back like any message. An unanswered question counts as needing Aamon: it shows a dot on the Chat tab and adds to the status bar count.
- **Cards** are posted by the plugin, in the same timeline, whenever a session enters Needs you:

  | Card | Text | Buttons |
  |---|---|---|
  | Approval | "Wants to run: `<command>`" or "Waiting on a prompt" | Allow once · Deny · Peek |
  | Fix limit | "CI failing · 3 fix attempts used" | Retry fix · Details |
  | Merge blocked | The command that was stopped | Details |
  | Can't reach | "No agent to message in this session" | Details |

  A card resolves in place when it is answered in either the chat or the Board row.
- **Empty chat:** "What should I take on?" with two starters, "Close out my open PRs" and "What needs me right now?".
- **First run** replaces the chat until an orchestrator agent is picked: installed agents first, a "Not installed (N)" disclosure, and a note that it runs hidden and never opens as a tab.
- Messages and cards are kept in plugin storage (the newest 500), so the chat survives a reload or restart.

### The Board

Lanes in this order, each row showing the session name, PR number or "no PR", a project tag and one status phrase:

| Lane | A session is here when | Status phrases |
|---|---|---|
| **Needs you** | It has an open card (table above) | "Blocked · wants to run `<command>`", "Blocked · waiting on a prompt", "CI failing · N fix attempts used", "Merge blocked", "No agent to message" |
| **Building** | No open PR and its agent is working | "Working · 14m" |
| **Validating** | Open PR and any of: draft, checks pending, checks failing, conflicts | "Draft", "Checks running · 4 of 9", "CI failing", "Fixing CI failures · sent 1m ago", "Merge conflicts", "Resolving conflicts · sent 1m ago" |
| **Needs review** | Open PR, checks green, and any of: unresolved thread, changes requested, a review requested and not in | "Addressing comments · sent 1m ago", "Changes requested", "Commented", "Awaiting review" |
| **Ready** | Open PR that is not a draft, has at least one check, every check passed, no unresolved thread, no changes requested, no pending review request, and mergeable | "Mergeable" |

Under the lanes, one line: "Idle · N sessions", which expands to the sessions with no PR whose agent is not working.

- **Precedence:** Needs you, then (with no PR) Building or Idle, then Validating, Needs review, Ready.
- **Layout:** a grouped list when narrow; the five lanes as columns from about 640px of panel width.
- **Row buttons:** a Needs you row carries the same buttons as its card.
- **Row menu (⋯):** Details · Message · Retry fix · Auto-fix CI on/off · Auto-fix review comments on/off · Stop agent · Remove worktree… (asks first, in the panel: "Its branch and PR stay on GitHub.").
- **Notifications:** one desktop notification when a session enters Needs you, and one when it enters Ready.

### Session details and Peek

Opened from a row, as a panel view with a back arrow.

- **Header:** name, PR, branch, agent, state dot.
- **Status | Terminal | Diff.** *Status* lists checks, open threads, fix attempts used and the last thing sent. *Terminal* is Peek. *Diff* is `gh pr diff`.
- **Peek** shows the agent's rendered screen, refreshed about once a second while open, with a key row under it: Enter, 1, 2, 3, y, n, Esc. It is the fallback for any prompt the buttons cannot answer, including the orchestrator's own.
- **Buttons:** Retry fix, Stop agent, PR on GitHub. A message box sends to the session.

### Approvals

- **Detection:** a session's agent reports `blocked` (`agent.status.changed`), or `workspace.list` reports `permission`.
- **What it wants:** for Claude Code, the last `agent.tool.before` call seen on that terminal (a shell command shows as the command; any other tool as its name). For other agents, "Waiting on a prompt".
- **Allow once / Deny:** offered when the plugin knows the agent's prompt keys. In v1 that is Claude Code in a terminal: Allow once sends `1`, Deny sends Escape. The plugin then checks the agent left `blocked` within 3 seconds; if not, the card says "Answer it in Peek".
- **Every other agent** gets a card with Peek only.
- While an agent is blocked, nothing else is ever typed into it.

### Babysitting

Every interval, for each GitHub repository with at least one tracked session, one GraphQL query reads every open PR: head branch and SHA, base SHA, draft, mergeable, review decision, pending review requests, the check rollup, review threads, reviews and comments, plus `rateLimit`.

A PR belongs to the session whose worktree branch is the PR's head branch in that repository. A worktree on the repository's default branch never matches.

| Event | Sent when | Dedupe key | Message |
|---|---|---|---|
| CI failed | The head SHA has a failed check and no check is still pending, or 10 minutes after the first failure was seen on that SHA | PR + head SHA | Every failed check's name and URL, and the last 80 lines of each failed job's log (at most 3 jobs) |
| Review thread | A thread is unresolved and its newest comment is unsent | comment id | File, line, text, thread URL, and the command that resolves the thread |
| Review body | A review with a body and state changes-requested or commented | review id | The body and its URL |
| PR comment | A top-level comment from a human | comment id | The text and its URL |
| Bot comments | Bot comments, batched | PR + head SHA | All of them in one message |
| Conflict | Mergeable is conflicting | PR + base SHA | "Merge `origin/<base>` into your branch and resolve conflicts, then push." |

- **Agent replies are skipped.** Agents use Aamon's GitHub login, so author cannot tell them apart. Messages tell the agent to resolve a thread after fixing it, and to start any reply it posts with `[agent]`. Comments starting with `[agent]` are never routed.
- **Attempts:** CI sends are counted per PR. The count resets when a head SHA goes fully green. After the limit (default 3) the next failure is not sent: the session moves to Needs you with a Fix limit card. Retry fix resets the count and sends.
- **Auto-fix switches,** per session, as in the reference: "Auto-fix CI" (covers conflicts) and "Auto-fix review comments". Both are on for orchestrator-started sessions. For yours they follow the setting "Auto-fix my own sessions" (default on). With a switch off, the Board still shows the state and nothing is sent.
- **Delivery, in this order:**
  1. An orchestrator-started session with a dispatch: `orca orchestration send --to dispatch:<id>`.
  2. An agent terminal that is idle (`waiting` or `done`): typed with `terminal.sendText`.
  3. An agent terminal that is working or blocked: held in a stored queue and sent when it goes idle.
  4. No terminal but a known session id: `agent.resume`, then as 3.
  5. Otherwise: a Can't reach card.
- **`./bin/tell`** from the orchestrator uses the same delivery, so nothing ever types into a busy agent.

### Merge guard

- **Scope:** the orchestrator and the sessions it started. Aamon's own sessions are untouched: his global `guard_push.py` already covers them, and AGENTS.md §10 lets him approve a merge in-session.
- **Rules:** ported from `~/.claude/hooks/guard_push.py` with its test cases: `gh pr merge`, merge calls through `gh api` (REST or GraphQL, including auto-merge), `git push` with any force flag or a `+` refspec, `--mirror`, `--all`, and any push whose target is `main` or `master`.
- **Claude Code in a terminal** is denied with a reason that says merging is Aamon's. Other terminal agents are reported after the fact and get a Merge blocked card worded "attempted".
- **Footer:** "Merge guard on", "N blocks today", or "Merge guard off" in the danger tone.

### Footer and status bar

- **Footer left:** "Polling GitHub · 60s", "Not watching any PRs", "gh not installed", "gh not signed in" or "GitHub rate limited · retrying in Ns". With status hooks off: "Status hooks off · status may be stale".
- **Footer right:** the gear, which opens Settings as a panel view with a back arrow.
- **Status bar item:** hidden when nothing needs Aamon; otherwise "N need you" in the danger tone.

### Settings

| Setting | Default |
|---|---|
| Orchestrator agent | picked at first run |
| Default worker agent | same as the orchestrator |
| Worker name suffix | `-oa` |
| GitHub check interval | 60 s (30 / 60 / 120 / 300) |
| Fix attempts before asking | 3 (1 / 2 / 3 / 5) |
| Merge guard | on |
| Auto-fix my own sessions | on |

The same settings are declared in the manifest, so they also appear in Orca's Settings → Plugins. The Settings view has one more row, "Peek at the orchestrator".

## How the Orca CLI is used

| Area | Commands | Who |
|---|---|---|
| Sessions | `worktree list`, `workspace.list` (host), `terminal.list` (host) | Plugin |
| Workers | `orchestration worker-start`, `worker-list`, `worker-show`, `worker-read`, `worker-stop` | Orchestrator starts; plugin reads and stops |
| Messaging | `orchestration send`, `reply` | Plugin sends fixes; the orchestrator answers its workers |
| Terminals | `terminal read --screen`, `terminal.sendText` (host) | Plugin: Peek, delivery, approvals |
| Hidden home | `repo add --kind folder`, `repo hide`, `repo list` | Plugin, once |
| Agents | `agent.launch`, `agent.resume` (host), `agent hooks status`, `skills get orchestration` | Plugin launches and resumes; orchestrator loads the guide |
| Cleanup | `worktree rm` (only after a confirm in the panel) | Plugin |

Never used: anything that merges, `orchestration reset`, a consuming `orchestration check`, `terminal switch` or `focus`, `file open`, `agent launch --focus`, `workspace.open`, `editor.open`, `commands.run`.

At startup the worker reads `orca agent-context --json` and uses only the commands this Orca offers.

## Spikes the build runs first

Each result is recorded here under a "Spike results" heading before any module is written. The named fallback applies when a spike fails.

1. **Hidden home.** A folder project added with `repo add --kind folder` and hidden runs an agent launched with `agent.launch` without any tab or sidebar entry appearing. *Fallback: a terminal in an existing workspace that the plugin never focuses.*
2. **`--repo` from the folder.** `worker-start --repo id:<repoId> --worktree new-top-level` from the home folder creates the worktree in that repository.
3. **Mail from outside a terminal.** `orchestration send --to dispatch:<id>` works when run by the worker process, which is in no terminal. *Fallback for send: the terminal route for every session.*
4. **Ids.** Which id `agent.tool.before` and `agent.status.changed` carry, against `workspace.list` ids and `worktree list` ids.
5. **Screen reads.** `orca terminal read --screen --terminal <id>` accepts the host API's terminal id. *Fallback: map through `orca terminal list --json`.*
6. **Approval keys.** In Claude Code, `1` allows once and Escape denies a permission prompt, sent with `terminal.sendText`, and the status leaves `blocked`. Also what the folder-trust prompt needs.
7. **Chat-surface agents.** Whether `agent.status.changed` fires for a chat worker, and whether one can be reached without a dispatch. *Fallback: a Can't reach card.*
8. **Keep-alive.** With a status bar item declared and the panel closed, the worker's timer still fires.
9. **Mail to the orchestrator.** Whether `orchestration send --to run:<id>` or a terminal handle is delivered to an idle coordinator by Orca. If it is, the plugin's own queue for the orchestrator is dropped in favour of it.

## Calls made in this rewrite (for Aamon to check)

1. **Auto-fix defaults to on for your own sessions.** The alternative is off until switched on per session, as the reference does with an explicit claim.
2. **The guard covers only orchestrator-started sessions,** as before.
3. **The Chat | Terminal style setting is gone.** The Chat view is always the chat; the orchestrator's terminal is reached through Peek.
4. **The nightly sweep is gone.** The status bar item keeps the watcher running, and an automation would spend agent usage to do the same thing.
5. **Allow once and Deny are Claude Code only in v1.** Other agents get Peek.
6. **CI failures are sent once per push,** not once per failed check.
7. **Agent replies are marked `[agent]`,** because every PR and comment comes from one GitHub login.
8. **No Orca decision gates.** The orchestrator asks Aamon with `./bin/say question`, which needs no Run id and no extra CLI calls.
9. **"Awaiting review" means a review was requested and has not arrived.** With no request pending and everything green, the session is Ready.

## Open questions

None.
