(function (g) {
  var V = (g.OrchViews = g.OrchViews || {})
  var COLUMNS = [['building', 'working'], ['validating', 'validating'], ['review', 'review'], ['ready', 'ready']]
  var KEYS = [['Enter', 'enter'], ['1', '1'], ['2', '2'], ['3', '3'], ['y', 'y'], ['n', 'n'], ['Esc', 'esc']]
  var LABELS = { allow: 'Allow once', deny: 'Deny', peek: 'Peek', retry: 'Retry fix', details: 'Show session', start: 'Start an agent', dismiss: 'Dismiss' }
  var PRIMARY = { allow: true, start: true }
  var TONES = { bad: true, build: true, warn: true, info: true, ok: true }
  var TAIL = 10

  function e(s) { return g.OrchEsc.html(s) }
  function own(map, key) { return Object.prototype.hasOwnProperty.call(map, key) }
  function icon(id) { return '<svg class="icon"><use href="#i-' + id + '"></use></svg>' }
  function toneOf(t) { return typeof t === 'string' && own(TONES, t) ? t : 'info' }

  function columnOf(row) {
    for (var i = 0; i < COLUMNS.length; i++) if (row.column === COLUMNS[i][0]) return COLUMNS[i][1]
    for (var j = 0; j < COLUMNS.length; j++) if (row.lane === COLUMNS[j][0]) return COLUMNS[j][1]
    return row.lane === 'idle' || row.column === 'idle' ? 'idle' : 'working'
  }

  function cardsOf(vm) {
    var out = []
    var lists = [(vm && vm.rows) || [], (vm && vm.idle) || []]
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) {
        var c = lists[i][j].card
        if (c && (c.resolved == null || c.resolved === '') && c.actions && c.actions.length) out.push(c)
      }
    }
    return out
  }

  function cardButtons(card, skip) {
    var out = ''
    for (var i = 0; i < card.actions.length; i++) {
      var a = card.actions[i]
      if (!own(LABELS, a) || a === skip) continue
      out += '<button type="button" class="btn' + (own(PRIMARY, a) ? ' pri' : '') + '" data-act="card" data-id="' + e(card.id) + '" data-action="' + e(a) + '">' +
        (a === 'peek' ? icon('term') : '') + LABELS[a] + '</button>'
    }
    return out
  }

  V.pin = function (vm, ui) {
    var cards = cardsOf(vm)
    if (!cards.length) return ''
    var at = ui && typeof ui.pin === 'number' ? ((ui.pin % cards.length) + cards.length) % cards.length : 0
    var c = cards[at]
    var nav = cards.length > 1
      ? '<span class="pin-nav"><button type="button" class="ib sm" data-act="pin-step" data-step="-1" aria-label="Previous">' + icon('chev') + '</button>' +
        '<span class="pin-n">' + (at + 1) + ' of ' + cards.length + '</span>' +
        '<button type="button" class="ib sm" data-act="pin-step" data-step="1" aria-label="Next">' + icon('chev') + '</button></span>'
      : ''
    return '<section class="pin" data-card="' + e(c.id) + '" aria-label="Needs you">' +
      '<div class="pin-h"><b>' + e(c.title) + '</b>' + nav + '</div>' +
      (c.detail ? '<div class="pin-text">' + e(c.detail) + '</div>' : '') +
      '<div class="btns">' + cardButtons(c, '') + '</div></section>'
  }

  function warning(vm) {
    var gh = vm.gh || { ok: true }
    if (!gh.ok && gh.reason === 'missing') return 'gh is not installed · PR status is off'
    if (!gh.ok && gh.reason === 'signed-out') return 'gh is not signed in · PR status is paused'
    if (!gh.ok && gh.reason === 'rate-limited') return 'GitHub rate limited · retrying in ' + Math.max(0, Math.round(gh.retryInSec || 0)) + 's'
    if (!gh.ok) return 'GitHub could not be read · PR status may be stale'
    if (vm.hooksOff) return 'Status hooks are off · status may be stale'
    if (vm.guard && vm.guard.on === false) return 'Merge guard is off'
    return ''
  }

  function terminal(key, data) {
    if (!data || !Array.isArray(data.lines)) return '<div class="srow-load muted">Reading the terminal…</div>'
    var lines = data.lines.slice()
    while (lines.length && String(lines[lines.length - 1]).trim() === '') lines.pop()
    var keys = ''
    for (var i = 0; i < KEYS.length; i++) {
      keys += '<button type="button" class="btn key" data-act="peek-key" data-key="' + e(key) + '" data-name="' + KEYS[i][1] + '">' + KEYS[i][0] + '</button>'
    }
    return '<pre class="srow-term">' + e(lines.slice(-TAIL).join('\n')) + '</pre><div class="srow-keys"><span class="muted">Send a key</span>' + keys + '</div>'
  }

  function expanded(row, ui, data) {
    var k = e(row.key)
    var act = 'data-act="row" data-key="' + k + '"'
    var meta = [row.branch, row.pr != null ? '#' + row.pr : 'no PR', row.project, row.agentKind].filter(Boolean).join(' · ')
    var card = row.card && (row.card.resolved == null || row.card.resolved === '') ? row.card : null
    var html = '<div class="srow-x"><div class="srow-meta muted">' + e(meta) + '</div>'
    if (card && card.detail) html += '<div class="srow-need">' + e(card.detail) + '</div>'
    html += terminal(row.key, data) + '<div class="btns">'
    if (card && card.actions) html += cardButtons(card, 'peek')
    html += '<button type="button" class="btn" ' + act + ' data-action="open">' + icon('ext') + 'Open in Orca</button>'
    if (row.pr != null) {
      var ci = !!(row.autoFix && row.autoFix.ci)
      var rv = !!(row.autoFix && row.autoFix.review)
      html += '<button type="button" class="btn" data-act="pr-open" data-key="' + k + '">PR</button>'
      if (!card) html += '<button type="button" class="btn" ' + act + ' data-action="retry">Retry fix</button>'
      html += '<button type="button" class="btn" ' + act + ' data-action="autofix-ci" data-on="' + String(!ci) + '" aria-pressed="' + String(ci) + '">Auto-fix CI ' + (ci ? 'on' : 'off') + '</button>'
      html += '<button type="button" class="btn" ' + act + ' data-action="autofix-review" data-on="' + String(!rv) + '" aria-pressed="' + String(rv) + '">Auto-fix reviews ' + (rv ? 'on' : 'off') + '</button>'
    }
    html += '<button type="button" class="btn" ' + act + ' data-action="stop">Stop</button>'
    if (ui.confirmRemove === row.key) {
      html += '</div><div class="srow-confirm"><span class="muted">Its branch and PR stay on GitHub.</span>' +
        '<button type="button" class="btn danger" ' + act + ' data-action="remove" data-confirmed="true">Remove worktree</button>' +
        '<button type="button" class="btn" data-act="remove-cancel">Cancel</button></div>'
    } else {
      html += '<button type="button" class="btn" data-act="remove-ask" data-key="' + k + '">Remove…</button></div>'
    }
    return html + '</div>'
  }

  function rowHtml(row, ui, detail, now) {
    var k = e(row.key)
    var attn = row.lane === 'needs'
    var on = detail.key === row.key
    var label = typeof row.label === 'string' && row.label ? row.label : row.phrase
    var when = g.OrchTime ? g.OrchTime.rel(row.at, now) : ''
    return '<div class="srow col-' + columnOf(row) + (attn ? ' attn' : '') + (on ? ' on' : '') + (row.stale ? ' stale' : '') + '" data-key="' + k + '">' +
      '<button type="button" class="srow-h" data-act="open-detail" data-key="' + k + '" aria-expanded="' + String(on) + '">' +
      '<i class="lane-dot"></i><span class="srow-name">' + e(row.name) + '</span>' +
      '<span class="srow-label tone-' + toneOf(row.tone) + '-text">' + (row.working === true && !attn ? '<i class="spin" aria-hidden="true"></i>' : '') + e(label) + '</span>' +
      (when ? '<span class="srow-time">' + when + '</span>' : '') + '</button>' +
      (on ? expanded(row, ui, detail.data) : '') + '</div>'
  }

  function orchRow(detail) {
    return '<div class="srow col-idle on" data-key="orchestrator">' +
      '<button type="button" class="srow-h" data-act="back" aria-expanded="true"><i class="lane-dot"></i><span class="srow-name">Orchestrator</span><span class="srow-label tone-info-text">Its terminal</span></button>' +
      '<div class="srow-x">' + terminal('orchestrator', detail.data) + '</div></div>'
  }

  V.strip = function (vm, ui, detail) {
    vm = vm || {}
    ui = ui || {}
    detail = detail || { key: null, data: null }
    var rows = vm.rows || []
    var idle = vm.idle || []
    var warn = warning(vm)
    var orch = detail.key === 'orchestrator'
    if (!rows.length && !idle.length && !warn && !orch) return ''
    var now = typeof ui.now === 'number' ? ui.now : Date.now()
    var counts = ''
    for (var i = 0; i < COLUMNS.length; i++) {
      var n = 0
      for (var r = 0; r < rows.length; r++) if (columnOf(rows[r]) === COLUMNS[i][1]) n++
      counts += '<span class="strip-n col-' + COLUMNS[i][1] + '"><i class="lane-dot"></i>' + n + '</span>'
    }
    var needs = 0
    for (var q = 0; q < rows.length; q++) if (rows[q].lane === 'needs') needs++
    var open = !!ui.stripOpen || orch
    var html = '<section class="strip' + (open ? ' open' : '') + '" aria-label="Sessions">'
    if (warn) html += '<div class="strip-warn">' + e(warn) + '</div>'
    html += '<button type="button" class="strip-sum" data-act="strip-toggle" aria-expanded="' + String(open) + '">' + counts +
      (idle.length ? '<span class="strip-n col-idle">' + idle.length + ' idle</span>' : '') +
      '<span class="sp"></span>' + (needs ? '<span class="strip-need">' + needs + (needs === 1 ? ' needs you' : ' need you') + '</span>' : '') +
      '<svg class="icon chev' + (open ? ' up' : '') + '"><use href="#i-chev"></use></svg></button>'
    if (open) {
      html += '<div class="strip-rows">'
      if (orch) html += orchRow(detail)
      for (var a = 0; a < rows.length; a++) html += rowHtml(rows[a], ui, detail, now)
      if (!rows.length && !orch) html += '<div class="srow-load muted">Nothing is running.</div>'
      if (idle.length) {
        html += '<button type="button" class="strip-idle" data-act="idle-toggle" aria-expanded="' + String(!!ui.idleOpen) + '">' + icon('archive') +
          '<span>Idle</span><b>' + idle.length + '</b></button>'
        if (ui.idleOpen) for (var b = 0; b < idle.length; b++) html += rowHtml(idle[b], ui, detail, now)
      }
      html += '<button type="button" class="strip-board" data-act="board-open">' + icon('grid') + '<span>Full board in the browser</span>' + icon('ext') + '</button></div>'
    }
    return html + '</section>'
  }
})(window)
