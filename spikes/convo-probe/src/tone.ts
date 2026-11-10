export function sineWavePcm16(hz: number, seconds: number, sampleRate: number): { base64: string; samples: number } {
  const samples = Math.round(seconds * sampleRate)
  const buf = Buffer.alloc(samples * 2)
  const amp = 0.95 * 32767
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * hz * i) / sampleRate)), i * 2)
  }
  return { base64: buf.toString('base64'), samples }
}
