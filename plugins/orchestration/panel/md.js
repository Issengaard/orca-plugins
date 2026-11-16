(function (g) {
  var RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
  var BULLET = /^\s*[-*]\s+(.*)$/
  var NUMBER = /^\s*\d+[.)]\s+(.*)$/
  var HEADING = /^(#{1,4})\s+(.*)$/
  var FENCE = /^\s*(`{3,})/

  function e(s) { return g.OrchEsc.html(s) }

  function format(text) {
    var s = e(text)
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="#" data-act="link" data-url="$2">$1</a>')
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/(^|[\s(])\*([^*\s][^*\n]*)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    return s
  }

  function inline(text) {
    var parts = String(text == null ? '' : text).split(/(`[^`\n]+`)/)
    var out = ''
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i]
      if (p.length > 2 && p.charAt(0) === '`' && p.charAt(p.length - 1) === '`') out += '<code>' + e(p.slice(1, -1)) + '</code>'
      else out += format(p)
    }
    return out
  }

  function cells(line) {
    var t = line.trim()
    if (t.charAt(0) === '|') t = t.slice(1)
    if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1)
    return t.split('|').map(function (c) { return c.trim() })
  }

  function table(head, rows) {
    var html = '<div class="md-table"><table><thead><tr>'
    for (var i = 0; i < head.length; i++) html += '<th>' + inline(head[i]) + '</th>'
    html += '</tr></thead><tbody>'
    for (var r = 0; r < rows.length; r++) {
      html += '<tr>'
      for (var c = 0; c < head.length; c++) html += '<td>' + inline(rows[r][c] || '') + '</td>'
      html += '</tr>'
    }
    return html + '</tbody></table></div>'
  }

  function listOf(lines, start, pattern, tag) {
    var items = []
    var i = start
    while (i < lines.length) {
      var m = pattern.exec(lines[i])
      if (m) items.push(m[1])
      else if (items.length && /^\s+\S/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBER.test(lines[i])) items[items.length - 1] += ' ' + lines[i].trim()
      else break
      i++
    }
    var html = '<' + tag + '>'
    for (var k = 0; k < items.length; k++) html += '<li>' + inline(items[k]) + '</li>'
    return { html: html + '</' + tag + '>', next: i }
  }

  function plain(line) {
    return line.trim() !== '' && !FENCE.test(line) && !HEADING.test(line) && !BULLET.test(line) && !NUMBER.test(line)
  }

  function html(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n')
    var out = ''
    var i = 0
    while (i < lines.length) {
      var line = lines[i]
      if (line.trim() === '') { i++; continue }
      var fence = FENCE.exec(line)
      if (fence) {
        var body = []
        i++
        while (i < lines.length && lines[i].trim().indexOf(fence[1]) !== 0) { body.push(lines[i]); i++ }
        i++
        out += '<pre class="md-pre"><code>' + e(body.join('\n')) + '</code></pre>'
        continue
      }
      var h = HEADING.exec(line)
      if (h) {
        out += '<div class="md-h md-h' + h[1].length + '">' + inline(h[2]) + '</div>'
        i++
        continue
      }
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && lines[i + 1].indexOf('-') >= 0 && RULE.test(lines[i + 1])) {
        var head = cells(line)
        var rows = []
        i += 2
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim() !== '') { rows.push(cells(lines[i])); i++ }
        out += table(head, rows)
        continue
      }
      if (BULLET.test(line)) {
        var ul = listOf(lines, i, BULLET, 'ul')
        out += ul.html
        i = ul.next
        continue
      }
      if (NUMBER.test(line)) {
        var ol = listOf(lines, i, NUMBER, 'ol')
        out += ol.html
        i = ol.next
        continue
      }
      var para = []
      while (i < lines.length && plain(lines[i])) {
        if (para.length && lines[i].indexOf('|') >= 0 && i + 1 < lines.length && RULE.test(lines[i + 1])) break
        para.push(inline(lines[i]))
        i++
      }
      out += '<p>' + para.join('<br>') + '</p>'
    }
    return out
  }

  g.OrchMd = { html: html, inline: inline }
})(window)
