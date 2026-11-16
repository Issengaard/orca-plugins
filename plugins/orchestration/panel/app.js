(function (g) {
  var api = g.orca
  var doc = g.document
  var root = doc.getElementById('app')
  var Esc = g.OrchEsc
  var Views = g.OrchViews || {}
  var POLL_MS = 5000
  var TERMINAL_MS = 1000
  var NOTICE_MS = 5000
  var NUMERIC = { intervalSec: true, attempts: true }
  var SETTING_KEYS = ['orchestratorAgent', 'workerAgent', 'suffix', 'intervalSec', 'attempts', 'guard', 'autoFixYours']
  var BODY = '<main class="body" id="body"></main>'
  var CLICK_SKIP = { send: true, setting: true }
  var LISTS = ['chat-list', 'strip', 'strip-rows', 'srow', 'srow-x']

  var state = {
    vm: null,
    agents: null,
    settings: null,
    detail: { key: null, tab: 'terminal', data: null },
    ui: { idleOpen: false, stripOpen: false, menu: false, confirmRemove: null, plans: {}, copied: null }
  }
  var notice = ''
  var noticeTimer = null
  var lastHtml = null
  var paint = null
  var vmJson = null
  var readSeq = 0
  var detailSeq = 0
  var stick = true
  var terminalTimer = null
  var failStreak = false
  var copyTimer = null

  function request(name, input) {
    return Promise.resolve().then(function () { return api.plugin.request(name, input || {}) })
  }

  function fail(err) {
    notice = (err && err.message) || String(err || 'Something went wrong')
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(function () { notice = ''; render() }, NOTICE_MS)
    render()
  }

  function viewFn(name) {
    return Object.prototype.hasOwnProperty.call(Views, name) && typeof Views[name] === 'function' ? Views[name] : null
  }

  function unavailable() {
    return '<div class="unavailable muted">View unavailable</div>'
  }

  function safe(name, args) {
    var fn = viewFn(name)
    if (!fn) return unavailable()
    try { return String(fn.apply(Views, args)) } catch (err) { return unavailable() }
  }

  function currentView() {
    return 'chat'
  }

  function bodyHtml() {
    return safe('chat', [state.vm, state.ui, { detail: state.detail, agents: state.agents, settings: state.settings }])
  }

  function all(selector) {
    return root && root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(selector)) : []
  }

  function one(selector) {
    return root && root.querySelector ? root.querySelector(selector) : null
  }

  function snapshot() {
    var fields = all('[data-role]').filter(function (el) { return 'value' in el })
    var active = doc.activeElement
    var list = one('[data-role="chat-list"]')
    var body = one('#body')
    return {
      fields: fields.map(function (el) {
        return { el: el, role: el.dataset.role, key: el.dataset.key || '', value: el.value, active: el === active, start: el.selectionStart, end: el.selectionEnd }
      }),
      list: list,
      listTop: list ? list.scrollTop : null,
      listAtEnd: list ? list.scrollHeight - list.scrollTop - list.clientHeight < 24 : true,
      bodyTop: body ? body.scrollTop : 0
    }
  }

  function restore(snap) {
    var fields = all('[data-role]').filter(function (el) { return 'value' in el })
    snap.fields.forEach(function (f) {
      for (var i = 0; i < fields.length; i++) {
        var el = fields[i]
        if (el.dataset.role === f.role && (el.dataset.key || '') === f.key) {
          if (el === f.el) break
          if (f.value) el.value = f.value
          if (f.active && el.focus) {
            el.focus()
            if (el.setSelectionRange && f.start != null) el.setSelectionRange(f.start, f.end)
          }
          break
        }
      }
    })
    var list = one('[data-role="chat-list"]')
    if (list) {
      if (stick || snap.listAtEnd || snap.listTop == null) list.scrollTop = list.scrollHeight
      else if (list !== snap.list || list.scrollTop !== snap.listTop) list.scrollTop = snap.listTop
    }
    var body = one('#body')
    if (body && snap.bodyTop && body.scrollTop !== snap.bodyTop) body.scrollTop = snap.bodyTop
  }

  function syncTerminalTimer() {
    var want = !!(state.detail.key && state.detail.tab === 'terminal')
    if (want && terminalTimer == null) {
      terminalTimer = setInterval(function () {
        if (visible() && state.detail.key && state.detail.tab === 'terminal') fetchDetail(true)
      }, TERMINAL_MS)
    } else if (!want && terminalTimer != null) {
      clearInterval(terminalTimer)
      terminalTimer = null
    }
  }

  function nodes(list) {
    return Array.prototype.slice.call(list || [])
  }

  function parse(html) {
    var t = doc.createElement('template')
    t.innerHTML = html
    return t.content || t
  }

  function swap(old, html, before) {
    var fresh = nodes(parse(html).childNodes)
    var anchor = old.length ? old[0] : before
    fresh.forEach(function (n) { root.insertBefore(n, anchor) })
    old.forEach(function (n) { root.removeChild(n) })
    return fresh
  }

  function descend(node) {
    var cls = ' ' + String((node.getAttribute && node.getAttribute('class')) || '') + ' '
    for (var i = 0; i < LISTS.length; i++) if (cls.indexOf(' ' + LISTS[i] + ' ') >= 0) return true
    return false
  }

  function firstPaint(head, foot) {
    root.innerHTML = head + BODY + foot
    lastHtml = null
    var kids = nodes(root.childNodes)
    var body = one('#body')
    var at = kids.indexOf(body)
    paint = { head: kids.slice(0, at), body: body, foot: kids.slice(at + 1), headHtml: head, footHtml: foot, inner: null }
  }

  function patchBody(inner) {
    var Patch = g.OrchPatch
    if (paint.inner === null || !Patch || typeof Patch.reconcile !== 'function') paint.body.innerHTML = inner
    else Patch.reconcile(paint.body, parse(inner), descend)
    paint.inner = inner
  }

  function render() {
    syncTerminalTimer()
    if (!root) return
    if (!state.vm) {
      var loading = '<div class="unavailable muted">Loading…</div>'
      if (lastHtml !== loading) { root.innerHTML = loading; lastHtml = loading; paint = null }
      return
    }
    var view = currentView()
    var chrome = viewFn('chrome')
    var frame
    try { frame = chrome ? String(chrome(state.vm, view)) : BODY } catch (err) { frame = BODY }
    var at = frame.indexOf(BODY)
    if (at < 0) { frame = BODY; at = 0 }
    var head = frame.slice(0, at)
    var foot = frame.slice(at + BODY.length)
    var inner = (notice ? '<div class="notice">' + Esc.html(notice) + '</div>' : '') + bodyHtml(view)
    if (paint && paint.headHtml === head && paint.footHtml === foot && paint.inner === inner) return
    var snap = snapshot()
    if (!paint) firstPaint(head, foot)
    if (head !== paint.headHtml) { paint.head = swap(paint.head, head, paint.body); paint.headHtml = head }
    if (foot !== paint.footHtml) { paint.foot = swap(paint.foot, foot, null); paint.footHtml = foot }
    if (inner === paint.inner) return
    patchBody(inner)
    restore(snap)
    stick = false
  }

  function refresh() {
    var seq = ++readSeq
    return request('view.read').then(function (vm) {
      if (seq !== readSeq || !vm) return
      var json = JSON.stringify(vm)
      var same = json === vmJson
      vmJson = json
      state.vm = vm
      if (vm.firstRun && !state.agents) loadAgents()
      if (!same) render()
    }, fail)
  }

  function loadAgents() {
    return request('agents.list').then(function (list) {
      state.agents = Array.isArray(list) ? list : []
      render()
    }, fail)
  }

  function acceptSettings(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return
    for (var i = 0; i < SETTING_KEYS.length; i++) if (!(SETTING_KEYS[i] in s)) return
    state.settings = s
  }

  function loadSettings() {
    return request('settings.save', {}).then(function (s) {
      acceptSettings(s)
      render()
    }, function () {})
  }

  function fetchDetail(fromTimer) {
    var key = state.detail.key
    var tab = state.detail.tab
    if (!key) return Promise.resolve()
    var seq = ++detailSeq
    return request('row.detail', { key: key, tab: tab }).then(function (data) {
      if (seq !== detailSeq || state.detail.key !== key || state.detail.tab !== tab) return
      failStreak = false
      state.detail.data = data || null
      render()
    }, function (err) {
      if (fromTimer && failStreak) return
      failStreak = true
      fail(err)
    })
  }

  function closeDetail() {
    state.detail = { key: null, tab: 'terminal', data: null }
    state.ui.confirmRemove = null
  }

  function openDetail(key) {
    if (state.detail.key === key) {
      closeDetail()
      render()
      return Promise.resolve()
    }
    state.detail = { key: key, tab: 'terminal', data: null }
    state.ui.stripOpen = true
    state.ui.menu = false
    state.ui.confirmRemove = null
    render()
    return fetchDetail()
  }

  function toggleMenu() {
    state.ui.menu = !state.ui.menu
    render()
    if (state.ui.menu) {
      if (!state.agents) loadAgents()
      loadSettings()
    }
  }

  function after(promise) {
    return promise.then(function (res) {
      state.ui.confirmRemove = null
      return refresh().then(function () { return res })
    }, fail)
  }

  function bool(v) { return v === 'true' || v === true }

  function openExternal(url) {
    if (!url) return Promise.resolve()
    if (api.shell && api.shell.openExternal) return Promise.resolve(api.shell.openExternal(url))
    return Promise.resolve(api.host.call('shell.openExternal', { url: url }))
  }

  function copyText(text) {
    var nav = g.navigator
    if (nav && nav.clipboard && nav.clipboard.writeText) return Promise.resolve().then(function () { return nav.clipboard.writeText(text) })
    return new Promise(function (resolve, reject) {
      var box = doc.createElement('textarea')
      box.value = text
      box.setAttribute('readonly', '')
      box.style.position = 'fixed'
      box.style.opacity = '0'
      doc.body.appendChild(box)
      box.select()
      var ok = false
      try { ok = doc.execCommand('copy') } catch (err) { ok = false }
      doc.body.removeChild(box)
      if (ok) resolve()
      else reject(new Error('Could not copy the message'))
    })
  }

  function copyItem(id) {
    var chat = (state.vm && state.vm.chat) || []
    var hit = null
    for (var i = 0; i < chat.length; i++) if (chat[i].id === id) hit = chat[i]
    if (!hit) return Promise.resolve()
    return copyText(String(hit.text || '')).then(function () {
      state.ui.copied = id
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(function () { state.ui.copied = null; render() }, 1500)
      render()
    }, function () { fail(new Error('Could not copy the message')) })
  }

  function send(text) {
    text = String(text || '').trim()
    if (!text) return Promise.resolve()
    stick = true
    return after(request('chat.send', { text: text }))
  }

  function onSubmit(form) {
    var box = form.querySelector ? form.querySelector('[data-role="chat-input"]') : null
    var text = box ? box.value : ''
    if (!String(text).trim()) return
    if (box) box.value = ''
    send(text)
  }

  function act(el, ev) {
    var d = el.dataset
    switch (d.act) {
      case 'open-detail': return openDetail(d.key)
      case 'peek-orch':
        if (state.detail.key === 'orchestrator') return undefined
        return openDetail('orchestrator')
      case 'back':
        closeDetail()
        return render()
      case 'agent-menu': return toggleMenu()
      case 'strip-toggle':
        state.ui.stripOpen = !state.ui.stripOpen
        if (!state.ui.stripOpen) closeDetail()
        return render()
      case 'board-open':
        return request('board.url').then(function (res) { return openExternal(res && res.url) }).then(null, fail)
      case 'starter': return send(d.text)
      case 'answer': return after(request('chat.answer', { id: d.id, option: d.option }))
      case 'pick-agent': return after(request('firstrun.save', { agent: d.agent }))
      case 'card':
        return request('card.act', { id: d.id, action: d.action }).then(function (res) {
          return refresh().then(function () {
            if (res && res.open && state.detail.key !== res.open) return openDetail(res.open)
          })
        }, fail)
      case 'plan-toggle':
        state.ui.plans[d.id] = bool(d.open)
        return render()
      case 'copy': return copyItem(d.id)
      case 'link':
        return /^https?:\/\//i.test(d.url || '') ? openExternal(d.url).then(null, fail) : undefined
      case 'idle-toggle':
        state.ui.idleOpen = !state.ui.idleOpen
        return render()
      case 'remove-ask':
        state.ui.confirmRemove = d.key
        return render()
      case 'remove-cancel':
        state.ui.confirmRemove = null
        return render()
      case 'row': return rowAct(el, d)
      case 'peek-key':
        return request('peek.key', { key: d.key, name: d.name }).then(function () { return fetchDetail() }, fail)
      case 'pr-open':
        return request('pr.url', { key: d.key }).then(function (res) { return openExternal(res && res.url) }, fail)
      default:
        return undefined
    }
  }

  function rowAct(el, d) {
    var input = { key: d.key, action: d.action }
    if (d.on != null) input.on = bool(d.on)
    if (d.confirmed != null) input.confirmed = bool(d.confirmed)
    return after(request('row.act', input))
  }

  function target(ev, attr) {
    var t = ev && ev.target
    return t && t.closest ? t.closest(attr || '[data-act]') : null
  }

  function onClick(ev) {
    var el = target(ev)
    if (state.ui.menu && !target(ev, '[data-role="agent-menu"]') && !(el && el.dataset && el.dataset.act === 'agent-menu')) {
      state.ui.menu = false
      render()
    }
    if (!el || !el.dataset || Object.prototype.hasOwnProperty.call(CLICK_SKIP, el.dataset.act)) return
    if (ev.preventDefault && el.dataset.act !== 'pr-open') ev.preventDefault()
    act(el, ev)
  }

  function onChange(ev) {
    var el = target(ev)
    if (!el || !el.dataset || el.dataset.act !== 'setting') return
    var name = el.dataset.name
    var value
    if (el.type === 'checkbox') value = !!el.checked
    else if (Object.prototype.hasOwnProperty.call(NUMERIC, name)) value = Number(el.value)
    else if (el.value === 'true' || el.value === 'false') value = el.value === 'true'
    else value = el.value
    var patch = {}
    patch[name] = value
    request('settings.save', patch).then(function (s) {
      acceptSettings(s)
      return refresh()
    }, fail)
  }

  function onSubmitEvent(ev) {
    var form = target(ev, 'form[data-act="send"]') || target(ev)
    if (!form || !form.dataset || form.dataset.act !== 'send') return
    if (ev.preventDefault) ev.preventDefault()
    onSubmit(form)
  }

  function onKeydown(ev) {
    var t = ev.target
    if (!t || !t.dataset || t.dataset.role !== 'chat-input') return
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return
    if (ev.preventDefault) ev.preventDefault()
    var form = t.closest ? t.closest('form') : null
    if (form) onSubmit(form)
  }

  function onScroll(ev) {
    var t = ev.target
    if (t && t.dataset && t.dataset.role === 'chat-list') {
      stick = t.scrollHeight - t.scrollTop - t.clientHeight < 24
    }
  }

  function paintTheme() {
    var el = doc.documentElement
    if (!el || !el.classList || !g.getComputedStyle) return
    if (el.classList.contains('light') || el.classList.contains('dark')) return
    var bg = g.getComputedStyle(doc.body).getPropertyValue('--orca-background').trim()
    var m = /^#([0-9a-f]{6})$/i.exec(bg)
    var rgb = /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(bg)
    var lum = 0
    if (m) { var n = parseInt(m[1], 16); lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 }
    else if (rgb) lum = (0.2126 * rgb[1] + 0.7152 * rgb[2] + 0.0722 * rgb[3]) / 255
    else lum = g.matchMedia && g.matchMedia('(prefers-color-scheme: dark)').matches ? 0 : 1
    el.classList.add(lum > 0.5 ? 'light' : 'dark')
  }

  function visible() { return doc.visibilityState !== 'hidden' }

  doc.addEventListener('click', onClick)
  doc.addEventListener('change', onChange)
  doc.addEventListener('submit', onSubmitEvent)
  doc.addEventListener('keydown', onKeydown)
  if (doc.addEventListener) doc.addEventListener('scroll', onScroll, true)
  if (api.plugin && api.plugin.on) api.plugin.on('view', function () { refresh() })
  if (api.on) api.on('theme', function () { setTimeout(function () { paintTheme() }, 0) })
  setInterval(function () { if (visible()) refresh() }, POLL_MS)
  paintTheme()
  render()
  refresh()
  g.OrchApp = { state: state, refresh: refresh }
})(window)
