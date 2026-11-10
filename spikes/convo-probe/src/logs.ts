import path from 'node:path'

export function claudeProjectDir(home: string, cwd: string): string {
  return path.join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
}

export function pickSession(files: { path: string; mtimeMs: number }[], sinceMs: number): string | null {
  const recent = files.filter((f) => f.mtimeMs >= sinceMs).sort((a, b) => b.mtimeMs - a.mtimeMs)
  return recent.length ? recent[0].path : null
}

export function lastAssistantText(jsonl: string): string | null {
  let last: string | null = null
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let row: { type?: string; message?: { content?: unknown } }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type !== 'assistant') continue
    const content = row.message?.content
    const parts = Array.isArray(content)
      ? content.filter((c: { type?: string }) => c?.type === 'text').map((c: { text?: string }) => c.text ?? '')
      : typeof content === 'string'
        ? [content]
        : []
    if (parts.length) last = parts.join(' ').trim()
  }
  return last
}
