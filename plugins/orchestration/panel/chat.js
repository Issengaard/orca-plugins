(function (g) {
  var V = (g.OrchViews = g.OrchViews || {})

  function e(s) { return g.OrchEsc.html(s) }
  function icon(id) { return '<svg class="icon"><use href="#i-' + id + '"></use></svg>' }
  var ORCA = '<svg class="orca-mark" aria-hidden="true"><use href="#i-orca"></use></svg>'

  var STARTERS = ['Close out my open PRs', 'What needs me right now?']

  V.chrome = function () {
    return '<main class="body" id="body"></main>'
  }

  function bubble(cls, text, key) { return '<div class="bubble ' + cls + '"' + (key || '') + '>' + e(text) + '</div>' }

  function keyOf(it) { return it.id == null || it.id === '' ? '' : ' data-key="' + e(it.id) + '"' }

  var mdOpts = null
  function md(text) { return g.OrchMd ? g.OrchMd.html(text, mdOpts) : '<p>' + e(text) + '</p>' }
  function mdInline(text) { return g.OrchMd ? g.OrchMd.inline(text, mdOpts) : e(text) }

  function two(n) { return (n < 10 ? '0' : '') + n }

  function clock(at) {
    if (typeof at !== 'number' || !(at > 0)) return ''
    var d = new Date(at)
    return two(d.getHours()) + ':' + two(d.getMinutes())
  }

  function meta(it, ui) {
    var copied = ui.copied === it.id
    var time = clock(it.at)
    return '<div class="msg-meta">' +
      '<button type="button" class="ib sm" data-act="copy" data-id="' + e(it.id) + '" aria-label="' + (copied ? 'Copied' : 'Copy message') + '">' + icon(copied ? 'check' : 'copy') + '</button>' +
      (time ? '<span class="msg-time">' + time + '</span>' : '') + '</div>'
  }

  var MARKS = { done: 'check-circle', active: 'dot-circle', pending: 'circle' }

  function plan(it, ui) {
    var steps = it.plan || []
    if (!steps.length) return ''
    var done = 0
    var current = ''
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].status === 'done') done++
      else if (!current && steps[i].status === 'active') current = steps[i].text
    }
    if (!current) for (var j = 0; j < steps.length; j++) if (steps[j].status !== 'done') { current = steps[j].text; break }
    var allDone = done === steps.length
    var plans = ui.plans || {}
    var open = Object.prototype.hasOwnProperty.call(plans, it.id) ? !!plans[it.id] : !allDone
    var list = ''
    if (open) {
      list = '<ol class="plan-steps">'
      for (var k = 0; k < steps.length; k++) {
        var st = Object.prototype.hasOwnProperty.call(MARKS, steps[k].status) ? steps[k].status : 'pending'
        list += '<li class="plan-step ' + st + '">' + icon(MARKS[st]) + '<span>' + e(steps[k].text) + '</span></li>'
      }
      list += '</ol>'
    }
    return '<section class="plan' + (allDone ? ' all-done' : '') + '"' + keyOf(it) + ' aria-label="Orchestrator plan">' +
      '<button type="button" class="plan-h" data-act="plan-toggle" data-id="' + e(it.id) + '" data-open="' + String(!open) + '" aria-expanded="' + String(open) + '">' +
      icon(allDone ? 'check-circle' : 'list') + '<b>Plan</b>' +
      '<span class="plan-cur">' + (open || allDone ? '' : e(current)) + '</span>' +
      '<span class="plan-n">' + done + '/' + steps.length + '</span>' +
      '<svg class="icon chev' + (open ? ' up' : '') + '"><use href="#i-chev"></use></svg></button>' + list + '</section>'
  }

  var VERBS = { start: 'plus', tell: 'pen' }

  function action(it) {
    var live = it.live || null
    var verb = Object.prototype.hasOwnProperty.call(VERBS, it.verb) ? it.verb : 'start'
    var name = live ? live.name : ''
    var title = verb === 'tell' ? it.text : 'New workspace' + (name ? ' · ' + name : '')
    var tone = live && Object.prototype.hasOwnProperty.call(TONES, live.tone) ? live.tone : 'info'
    var status
    if (!live) status = verb === 'tell' ? '<span class="act-s muted">Gone</span>' : '<span class="act-s muted">Starting…</span>'
    else if (verb === 'tell') status = live.queued > 0 ? '<span class="act-s muted">Queued</span>' : '<span class="act-s tone-ok-text">Delivered</span>'
    else status = '<span class="act-s ' + (live.attention ? 'attn-text' : 'tone-' + tone + '-text') + '">' + e(live.label) + '</span>'
    var inner = icon(VERBS[verb]) + '<span class="act-n">' + e(title) + '</span>' + status
    var wrap = '<div class="msg" data-key="' + e(it.id) + '">'
    if (!live) return wrap + '<div class="act">' + inner + '</div></div>'
    return wrap + '<button type="button" class="act" data-act="open-detail" data-key="' + e(live.key) + '">' + inner + '</button></div>'
  }

  var TONES = { bad: true, build: true, warn: true, info: true, ok: true }

  function item(it, ui) {
    if (it.kind === 'card') return ''
    if (it.kind === 'action') return action(it)
    if (it.kind === 'plan') return plan(it, ui)
    if (it.from === 'you') return '<div class="msg me" data-key="' + e(it.id) + '">' + bubble('me', it.text) + '</div>'
    if (it.from === 'panel') return bubble('note' + (it.kind === 'progress' ? ' progress' : ''), it.text, ' data-key="' + e(it.id) + '"')
    if (it.kind === 'progress') return '<div class="msg step" data-key="' + e(it.id) + '"><i class="step-dot"></i><span>' + mdInline(it.text) + '</span></div>'
    var html = '<div class="msg or' + (it.kind === 'result' ? ' result' : '') + '" data-key="' + e(it.id) + '"><div class="md">' + md(it.text) + '</div>'
    if (it.kind === 'question') {
      if (it.answered != null && it.answered !== '') {
        html += '<div class="answered muted">Answered: ' + e(it.answered) + '</div>'
      } else {
        var opts = it.options || []
        var btns = ''
        for (var i = 0; i < opts.length; i++) {
          btns += '<button type="button" class="btn" data-act="answer" data-id="' + e(it.id) + '" data-option="' + e(opts[i]) + '">' + e(opts[i]) + '</button>'
        }
        html += '<div class="btns options">' + btns + '</div>'
      }
    }
    return html + meta(it, ui) + '</div>'
  }

  function empty() {
    var btns = ''
    for (var i = 0; i < STARTERS.length; i++) {
      btns += '<button type="button" class="btn" data-act="starter" data-text="' + e(STARTERS[i]) + '">' + e(STARTERS[i]) + '</button>'
    }
    return '<div class="empty">' + ORCA + '<div>What should I take on?</div>' + btns + '</div>'
  }


  function option(value, label, selected) {
    return '<option value="' + e(value) + '"' + (selected ? ' selected' : '') + '>' + e(label) + '</option>'
  }

  function agentOptions(agents, current, blank) {
    var out = blank ? option('', blank, current === '') : ''
    var off = ''
    for (var i = 0; i < agents.length; i++) {
      var o = option(agents[i].id, agents[i].label, agents[i].id === current)
      if (agents[i].installed) out += o
      else off += o
    }
    return out + (off ? '<optgroup label="Not installed">' + off + '</optgroup>' : '')
  }

  function line(label, control) {
    return '<label class="menu-row"><span>' + label + '</span>' + control + '</label>'
  }

  function select(name, inner) {
    return '<select class="menu-input" data-act="setting" data-name="' + name + '">' + inner + '</select>'
  }

  var MODES = [['fix', 'Fix it'], ['ask', 'Ask me'], ['ignore', 'Ignore']]
  var NO_AGENT = [['start', 'Start one'], ['ask', 'Ask me']]
  var SCOPES = [['all', 'All sessions'], ['workers', 'Workers only']]
  var TRIES = [[1, '1'], [2, '2'], [3, '3'], [5, '5']]
  var EVERY = [[30, '30s'], [60, '1m'], [120, '2m'], [300, '5m']]

  function head(label) {
    return '<div class="menu-h">' + label + '</div>'
  }

  function choices(list, value) {
    var out = ''
    for (var i = 0; i < list.length; i++) out += option(list[i][0], list[i][1], list[i][0] === value)
    return out
  }

  function group(label, control, dim) {
    return '<div class="menu-row' + (dim ? ' dim' : '') + '" role="group" aria-label="' + label + '"><span>' + label + '</span>' + control + '</div>'
  }

  function seg(name, list, value) {
    var out = '<span class="menu-seg">'
    for (var i = 0; i < list.length; i++) {
      out += '<label><input type="radio" name="set-' + name + '" data-act="setting" data-name="' + name + '" value="' + list[i][0] + '"' +
        (list[i][0] === value ? ' checked' : '') + '><span>' + list[i][1] + '</span></label>'
    }
    return out + '</span>'
  }

  function check(name, on) {
    return '<input type="checkbox" class="menu-check" data-act="setting" data-name="' + name + '"' + (on ? ' checked' : '') + '>'
  }

  function pickMenu(agents) {
    var html = '<div class="menu-title">Pick your orchestrator</div><div class="menu-note muted">One agent that takes tasks from this chat and starts workers for them.</div>'
    if (!agents) return html + '<div class="menu-note muted">Looking for agents…</div>'
    var on = ''
    var off = ''
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].installed) on += '<button type="button" class="menu-item" data-act="pick-agent" data-agent="' + e(agents[i].id) + '"><b>' + e(agents[i].label) + '</b><span class="muted">' + e(agents[i].cmd) + '</span></button>'
      else off += '<div class="menu-item off"><b>' + e(agents[i].label) + '</b><span class="muted">not installed</span></div>'
    }
    return html + (on || '<div class="menu-note muted">No supported agent is installed yet.</div>') + off
  }

  function settingsMenu(vm, agents, s) {
    if (!s || !agents) return '<div class="menu-note muted">Loading…</div>'
    var guard = vm.guard || { on: true, blocksToday: 0 }
    var blocks = guard.blocksToday || 0
    var idle = s.onCi !== 'fix' && s.onConflict !== 'fix' && s.onReview !== 'fix'
    return head('Agents') +
      line('Orchestrator', select('orchestratorAgent', agentOptions(agents, s.orchestratorAgent || '', ''))) +
      line('Workers', select('workerAgent', agentOptions(agents, s.workerAgent || '', 'Same as the orchestrator'))) +
      line('Worker names end in', '<input type="text" class="menu-input" data-act="setting" data-name="suffix" data-role="setting-suffix" value="' + e(s.suffix) + '" spellcheck="false">') +
      head('Auto-fix') +
      line('When CI fails', select('onCi', choices(MODES, s.onCi))) +
      line('When a PR has conflicts', select('onConflict', choices(MODES, s.onConflict))) +
      line('When a review comes in', select('onReview', choices(MODES, s.onReview))) +
      line('When no agent is running', select('noAgent', choices(NO_AGENT, s.noAgent))) +
      line('Apply to', select('scope', choices(SCOPES, s.scope))) +
      group('Tries before asking', seg('attempts', TRIES, s.attempts), idle) +
      head('GitHub') +
      group('Check GitHub every', seg('intervalSec', EVERY, s.intervalSec), false) +
      line('Merge guard' + (blocks > 0 ? ' <span class="muted">· ' + blocks + (blocks === 1 ? ' block today' : ' blocks today') + '</span>' : ''), check('guard', s.guard))
  }

  var STATES = { working: true, blocked: true, waiting: true, done: true, none: true }

  function agentChip(vm, open) {
    var orch = vm.orch
    var state = orch && Object.prototype.hasOwnProperty.call(STATES, orch.state) ? orch.state : 'none'
    var kind = orch ? String(orch.agentKind || 'Agent') : ''
    var name = vm.firstRun ? 'Pick an agent' : kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Orchestrator'
    return '<button type="button" class="composer-agent state-' + state + '" data-act="agent-menu" aria-haspopup="true" aria-expanded="' + String(open) + '">' +
      '<i class="state-dot" aria-hidden="true"></i>' +
      '<b>' + e(name) + '</b><svg class="icon chev' + (open ? ' up' : '') + '"><use href="#i-chev"></use></svg></button>'
  }

  function elapsed(since, now) {
    if (typeof since !== 'number' || !(since > 0)) return ''
    var sec = Math.max(0, Math.floor((now - since) / 1000))
    return sec < 60 ? sec + 's' : Math.floor(sec / 60) + 'm ' + (sec % 60) + 's'
  }

  function live(vm, ui) {
    var orch = vm.orch
    if (!orch || orch.state !== 'working') return ''
    var now = typeof ui.now === 'number' ? ui.now : Date.now()
    var doing = typeof orch.doing === 'string' ? orch.doing : ''
    var time = elapsed(orch.since, now)
    return '<div class="msg live" data-key="live" role="status"><i class="spin" aria-hidden="true"></i>' +
      '<span class="live-text">' + e(doing || 'Working') + '</span>' +
      (time ? '<span class="live-time" data-since="' + e(orch.since) + '">' + time + '</span>' : '') + '</div>'
  }

  V.elapsed = elapsed

  V.chat = function (vm, ui, x) {
    vm = vm || {}
    ui = ui || {}
    x = x || {}
    var chat = vm.chat || []
    var list = ''
    mdOpts = { workspaces: (vm.rows || []).concat(vm.idle || []), images: g.OrchImages || null }
    for (var i = 0; i < chat.length; i++) list += item(chat[i], ui)
    list += live(vm, ui)
    var queued = vm.queued > 0 ? '<div class="queued muted">' + e(vm.queued) + ' queued · sends when the orchestrator finishes its turn</div>' : ''
    var open = !!ui.menu || !!vm.firstRun
    var menu = open ? '<div class="agent-menu" role="menu" data-role="agent-menu">' + (vm.firstRun ? pickMenu(x.agents || null) : settingsMenu(vm, x.agents || null, x.settings || null)) + '</div>' : ''
    return '<div class="chat-list" data-role="chat-list">' + (list ? list : empty()) + '</div>' + queued +
      (V.pin ? V.pin(vm, ui, x.pinTerm) : '') + (V.strip ? V.strip(vm, ui, x.detail) : '') +
      '<form class="composer" data-act="send">' + menu +
      '<textarea data-role="chat-input" rows="2" placeholder="Tell the orchestrator what to do" aria-label="Tell the orchestrator what to do"' + (vm.firstRun ? ' disabled' : '') + '></textarea>' +
      '<div class="composer-bar">' + agentChip(vm, open) + '<span class="sp"></span>' +
      '<button type="submit" class="send" aria-label="Send"' + (vm.firstRun ? ' disabled' : '') + '>' + icon('up') + '</button></div>' +
      '</form>'
  }
})(window)
