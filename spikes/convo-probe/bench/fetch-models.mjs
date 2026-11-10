import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, statSync, readdirSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const here = path.dirname(new URL(import.meta.url).pathname)
const models = path.join(here, 'models')
const REL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'
const ITEMS = [
  { name: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8', url: `${REL}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`, orca: 'parakeet-tdt-0.6b-v3-int8' },
  { name: 'silero_vad.onnx', url: `${REL}/asr-models/silero_vad.onnx` },
  { name: 'vits-piper-en_US-lessac-medium', url: `${REL}/tts-models/vits-piper-en_US-lessac-medium.tar.bz2` },
  { name: 'kokoro-en-v0_19', url: `${REL}/tts-models/kokoro-en-v0_19.tar.bz2` }
]

function orcaSpeechDir() {
  const home = os.homedir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'orca', 'speech-models')
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'orca', 'speech-models')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca', 'speech-models')
}

function sizeOf(p) {
  const s = statSync(p)
  if (!s.isDirectory()) return s.size
  return readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0)
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${res.status} for ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

mkdirSync(models, { recursive: true })
let total = 0
for (const it of ITEMS) {
  const target = path.join(models, it.name)
  if (!existsSync(target) && it.orca) {
    const fromOrca = path.join(orcaSpeechDir(), it.orca)
    if (existsSync(path.join(fromOrca, 'encoder.int8.onnx'))) {
      symlinkSync(fromOrca, target, 'dir')
      console.log(`linked ${it.name} to Orca's copy at ${fromOrca}`)
    }
  }
  if (!existsSync(target)) {
    const file = it.url.endsWith('.tar.bz2') ? `${target}.tar.bz2` : target
    console.log(`downloading ${it.url}`)
    await download(it.url, file)
    if (file !== target) {
      execFileSync('tar', ['-xjf', file, '-C', models])
      execFileSync(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'del', file] : ['-f', file])
    }
  }
  const mb = sizeOf(target) / 1e6
  total += mb
  console.log(`${it.name}: ${mb.toFixed(0)} MB`)
}
console.log(`total: ${total.toFixed(0)} MB`)
