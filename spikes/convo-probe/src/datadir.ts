import path from 'node:path'

export function dataDir(platform: NodeJS.Platform, env: Record<string, string | undefined>, home: string): string {
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'convo-mode')
  if (platform === 'win32') return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'convo-mode')
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'convo-mode')
}
