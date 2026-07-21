// Active TTS provider, sourced from config.yaml (the single source of truth,
// also mounted into the worker). Exposed to the SPA via GET /api/config so the
// TunePanel can disable the voice/speed controls the ElevenLabs provider ignores.

export type TtsProvider = 'fpt' | 'elevenlabs'

const TTS_PROVIDERS: readonly TtsProvider[] = ['fpt', 'elevenlabs']

function isTtsProvider(value: unknown): value is TtsProvider {
  return typeof value === 'string' && (TTS_PROVIDERS as readonly string[]).includes(value)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

/**
 * Parse the active TTS provider out of a config.yaml document. Any shape that
 * does not name a recognized `tts.provider` falls back to `fpt` so the SPA's
 * voice controls stay active — we never falsely disable them.
 */
export function parseTtsProvider(yamlText: string): TtsProvider {
  let doc: unknown
  try {
    doc = Bun.YAML.parse(yamlText)
  } catch {
    return 'fpt'
  }
  const provider = asRecord(asRecord(doc)?.tts)?.provider
  return isTtsProvider(provider) ? provider : 'fpt'
}

/**
 * Read config.yaml from `path` and resolve the active TTS provider. An
 * unreadable file falls back to `fpt` (controls active) rather than failing
 * startup — the provider only drives cosmetic UI gating.
 */
export async function loadTtsProvider(path: string): Promise<TtsProvider> {
  try {
    const text = await Bun.file(path).text()
    return parseTtsProvider(text)
  } catch (err) {
    console.warn(`loadTtsProvider: cannot read ${path}, defaulting to fpt:`, err)
    return 'fpt'
  }
}
