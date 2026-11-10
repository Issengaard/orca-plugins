export function judge(m) {
  const reasons = []
  if (m.sttRtf > 0.5) reasons.push(`speech-to-text RTF ${m.sttRtf.toFixed(2)} > 0.5`)
  if (m.vadRtf > 0.05) reasons.push(`voice detection RTF ${m.vadRtf.toFixed(3)} > 0.05`)
  for (const k of ['piper', 'kokoro']) {
    const ms = Math.round(m.ttsFirstAudioMs[k])
    if (ms > 1000) reasons.push(`${k} first audio ${ms} ms > 1000 ms`)
  }
  const bothSlow = m.ttsFirstAudioMs.piper > 3000 && m.ttsFirstAudioMs.kokoro > 3000
  if (m.sttRtf > 1.0 || bothSlow) return { status: 'fail', reasons }
  return { status: reasons.length ? 'partial' : 'pass', reasons }
}
