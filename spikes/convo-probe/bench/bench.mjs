import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { judge } from './thresholds.mjs'

const require = createRequire(import.meta.url)
const here = path.dirname(new URL(import.meta.url).pathname)
const models = path.join(here, 'models')
const json = process.argv.includes('--json')
const log = (...a) => {
  if (!json) console.log(...a)
}

const t0 = Date.now()
const sherpa = require('sherpa-onnx')
const piper = require('piper-phonemize')
const loadWasmMs = Date.now() - t0
const version = JSON.parse(readFileSync(path.join(here, 'node_modules', 'sherpa-onnx', 'package.json'), 'utf8')).version

function find(dir, re) {
  const f = readdirSync(dir).find((n) => re.test(n))
  if (!f) throw new Error(`no ${re} in ${dir}`)
  return path.join(dir, f)
}

function timed(fn) {
  const s = performance.now()
  const out = fn()
  return { out, ms: performance.now() - s }
}

function makeTts(kind) {
  const dir = path.join(models, kind === 'piper' ? 'vits-piper-en_US-lessac-medium' : 'kokoro-en-v0_19')
  const modelConfig =
    kind === 'piper'
      ? { offlineTtsVitsModelConfig: { model: find(dir, /\.onnx$/), tokens: path.join(dir, 'tokens.txt') } }
      : { offlineTtsKokoroModelConfig: { model: path.join(dir, 'model.onnx'), voices: path.join(dir, 'voices.bin'), tokens: path.join(dir, 'tokens.txt') } }
  return sherpa.createOfflineTts({ offlineTtsModelConfig: { ...modelConfig, numThreads: 2, provider: 'cpu', debug: 0 }, maxNumSentences: 1 })
}

function say(tts, text) {
  const phonemeCodepoints = piper.phonemize(text, tts.lang || 'en-us').filter((x) => x.length > 0)
  return tts.generateWithConfig('', { phonemeCodepoints, sid: 0, speed: 1.0, silenceScale: 0.2 })
}

function resample(samples, from, to) {
  const n = Math.floor((samples.length * to) / from)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * from) / to
    const j = Math.floor(x)
    const f = x - j
    out[i] = (samples[j] ?? 0) * (1 - f) + (samples[j + 1] ?? 0) * f
  }
  return out
}

const FIRST = 'Here is a first pass.'
const FULL = 'Here is a first pass. The two copies of the submittal draft are marked Duplicate.'
const ttsFirstAudioMs = {}
const ttsFullMs = {}
const ttsLoadMs = {}
const errors = []
let piperAudio = null

for (const kind of ['piper', 'kokoro']) {
  try {
    const made = timed(() => makeTts(kind))
    ttsLoadMs[kind] = Math.round(made.ms)
    const tts = made.out
    const first = timed(() => say(tts, FIRST))
    if (!first.out.samples.length) throw new Error('generated no samples')
    ttsFirstAudioMs[kind] = Math.round(first.ms)
    ttsFullMs[kind] = Math.round(timed(() => say(tts, FULL)).ms)
    if (kind === 'piper') piperAudio = say(tts, 'Collapse the duplicates into one row with a count, then show me the plan.')
    tts.free()
    log(`${kind}: load ${ttsLoadMs[kind]} ms, first sentence ${ttsFirstAudioMs[kind]} ms, full ${ttsFullMs[kind]} ms`)
  } catch (e) {
    ttsFirstAudioMs[kind] = Infinity
    errors.push(`${kind}: ${e.message}`)
  }
}

let sttRtf = Infinity
let vadRtf = Infinity
let transcript = ''
let sttLoadMs = null
if (piperAudio) {
  const speech = resample(piperAudio.samples, piperAudio.sampleRate, 16000)
  const wave = new Float32Array(16000 * 10)
  wave.set(speech.subarray(0, wave.length), 8000)
  const seconds = wave.length / 16000
  try {
    const dir = path.join(models, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8')
    const made = timed(() =>
      sherpa.createOfflineRecognizer({
        modelConfig: {
          transducer: { encoder: find(dir, /^encoder.*\.onnx$/), decoder: find(dir, /^decoder.*\.onnx$/), joiner: find(dir, /^joiner.*\.onnx$/) },
          tokens: path.join(dir, 'tokens.txt'),
          modelType: 'nemo_transducer',
          numThreads: 2,
          debug: 0
        }
      })
    )
    sttLoadMs = Math.round(made.ms)
    const rec = made.out
    const r = timed(() => {
      const s = rec.createStream()
      s.acceptWaveform(16000, wave)
      rec.decode(s)
      const text = rec.getResult(s).text
      s.free()
      return text
    })
    transcript = r.out.trim()
    sttRtf = r.ms / 1000 / seconds
    rec.free()
    log(`parakeet: load ${sttLoadMs} ms, RTF ${sttRtf.toFixed(3)}, "${transcript}"`)
  } catch (e) {
    errors.push(`parakeet: ${e.message}`)
  }
  try {
    const vad = sherpa.createVad({
      sileroVad: { model: path.join(models, 'silero_vad.onnx'), threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.5, maxSpeechDuration: 20, windowSize: 512 },
      sampleRate: 16000,
      debug: false,
      numThreads: 1,
      bufferSizeInSeconds: 30
    })
    let segments = 0
    const r = timed(() => {
      for (let i = 0; i < wave.length; i += 512) {
        vad.acceptWaveform(wave.subarray(i, i + 512))
        while (!vad.isEmpty()) {
          vad.pop()
          segments++
        }
      }
    })
    vadRtf = r.ms / 1000 / seconds
    log(`silero vad: RTF ${vadRtf.toFixed(4)}, ${segments} segments`)
  } catch (e) {
    errors.push(`vad: ${e.message}`)
  }
}

const result = {
  versions: { sherpa: version, node: process.version, platform: process.platform, arch: process.arch },
  loadWasmMs,
  ttsLoadMs,
  sttLoadMs,
  sttRtf,
  vadRtf,
  ttsFirstAudioMs,
  ttsFullMs,
  transcript,
  errors,
  judge: judge({ sttRtf, vadRtf, ttsFirstAudioMs: { piper: ttsFirstAudioMs.piper ?? Infinity, kokoro: ttsFirstAudioMs.kokoro ?? Infinity } })
}
console.log(json ? JSON.stringify(result) : JSON.stringify(result, null, 2))
