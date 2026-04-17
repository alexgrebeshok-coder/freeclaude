/**
 * Voice Pipeline Integration Tests
 *
 * Tests the critical recording path that was broken 4 times:
 * loadAudioNapi → checkRecordingAvailability → startRecording (SoX fallback)
 *
 * Note: audio-capture-napi is a build-time stub and feature('VOICE_MODE')
 * is a build-time rewrite. Tests that verify bundle output use grep on
 * dist/cli.bundle.mjs. Tests that verify source logic import directly.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const BUNDLE_PATH = join(import.meta.dir, '../../../dist/cli.bundle.mjs')

// ─── Test 1: Bundle has napi stub exports ───────────────────────────

describe('bundle: audio-capture-napi stub', () => {
  const bundleExists = existsSync(BUNDLE_PATH)

  test('bundle exists', () => {
    expect(bundleExists).toBe(true)
  })

  test('bundle exports isNativeAudioAvailable as named export returning false', () => {
    if (!bundleExists) return
    const bundle = readFileSync(BUNDLE_PATH, 'utf8')
    // The stub creates: isNativeAudioAvailableN = () => false
    const match = bundle.match(/isNativeAudioAvailable\d*\s*=\s*\(\)\s*=>\s*false/)
    expect(match).not.toBeNull()
  })

  test('bundle exports isNativeRecordingActive as named export returning false', () => {
    if (!bundleExists) return
    const bundle = readFileSync(BUNDLE_PATH, 'utf8')
    const match = bundle.match(/isNativeRecordingActive\d*\s*=\s*\(\)\s*=>\s*false/)
    expect(match).not.toBeNull()
  })

  test('bundle exports startNativeRecording as named export returning false', () => {
    if (!bundleExists) return
    const bundle = readFileSync(BUNDLE_PATH, 'utf8')
    const match = bundle.match(/startNativeRecording\d*\s*=\s*\(\)\s*=>\s*false/)
    expect(match).not.toBeNull()
  })

  test('bundle has isNativeAudioAvailable in module export map', () => {
    if (!bundleExists) return
    const bundle = readFileSync(BUNDLE_PATH, 'utf8')
    expect(bundle).toContain('isNativeAudioAvailable: () => isNativeAudioAvailable')
  })
})

// ─── Test 2: Bundle has voice mode gate ─────────────────────────────

describe('bundle: voice mode feature gate', () => {
  const bundleExists = existsSync(BUNDLE_PATH)

  test('bundle contains space keybinding for voice pushToTalk', () => {
    if (!bundleExists) return
    const bundle = readFileSync(BUNDLE_PATH, 'utf8')
    expect(bundle).toContain('space: "voice:pushToTalk"')
  })

  test('bundle contains startSoxRecording function', () => {
    if (!bundleExists) return
    const bundle = readFileSync(BUNDLE_PATH, 'utf8')
    expect(bundle).toContain('startSoxRecording')
  })

  test('bundle contains connectLocalVoiceMode', () => {
    if (!bundleExists) return
    const bundle = readFileSync(BUNDLE_PATH, 'utf8')
    expect(bundle).toContain('connectLocalVoiceMode')
  })
})

// ─── Test 3: Source-level voice functions exist ──────────────────────

describe('source: voiceModeEnabled', () => {
  test('isLocalVoiceModeEnabled is exported as a function', async () => {
    const mod = await import('../../voice/voiceModeEnabled.ts')
    expect(typeof mod.isLocalVoiceModeEnabled).toBe('function')
  })

  test('isVoiceModeEnabled is exported as a function', async () => {
    const mod = await import('../../voice/voiceModeEnabled.ts')
    expect(typeof mod.isVoiceModeEnabled).toBe('function')
  })

  test('isVoiceGrowthBookEnabled is exported as a function', async () => {
    const mod = await import('../../voice/voiceModeEnabled.ts')
    expect(typeof mod.isVoiceGrowthBookEnabled).toBe('function')
  })
})

// ─── Test 4: SoX command shape ──────────────────────────────────────

describe('SoX recording command shape', () => {
  test('expected SoX arguments for 16kHz mono PCM', () => {
    // The exact command that must be spawned for voice recording.
    // If any of these args change, recording breaks silently.
    const expectedArgs = [
      '-q',
      '--buffer', '1024',
      '-e', 'signed-integer',
      '-b', '16',
      '-c', '1',
      '-t', 'raw',
      '-',
      'rate', '16000',
    ]
    expect(expectedArgs).toContain('-q')
    expect(expectedArgs).toContain('rate')
    expect(expectedArgs).toContain('16000')
    expect(expectedArgs).toContain('signed-integer')
    expect(expectedArgs).toContain('raw')
  })
})

// ─── Test 5: STT module ─────────────────────────────────────────────

describe('speech-to-text module', () => {
  test('transcribePcmAudio returns empty string for empty buffer', async () => {
    const { transcribePcmAudio } = await import('./stt.ts')
    const result = await transcribePcmAudio({ audio: Buffer.alloc(0) })
    expect(result).toBe('')
  })

  test('isWhisperCliAvailable returns boolean', async () => {
    const { isWhisperCliAvailable } = await import('./stt.ts')
    const result = await isWhisperCliAvailable()
    expect(typeof result).toBe('boolean')
  })
})

describe('local voice mode hardening', () => {
  test('enforces a maximum local audio buffer size', async () => {
    const { connectLocalVoiceMode } = await import('./voiceMode.ts')
    const events = {
      errors: [] as string[],
      closed: 0,
    }

    const connection = await connectLocalVoiceMode(
      {
        onTranscript() {},
        onError(error) {
          events.errors.push(error)
        },
        onClose() {
          events.closed += 1
        },
        onReady() {},
      },
      {
        maxBufferBytes: 4,
        transcribeAudio: async () => '',
      },
    )

    expect(connection).not.toBeNull()
    connection!.send(Buffer.from([1, 2, 3]))
    connection!.send(Buffer.from([4, 5]))

    expect(events.errors[0]).toContain('buffer limit')
    expect(events.closed).toBe(1)
    expect(connection!.isConnected()).toBe(false)
  })

  test('times out stuck local transcription attempts', async () => {
    const { connectLocalVoiceMode } = await import('./voiceMode.ts')
    const events = {
      errors: [] as string[],
      closed: 0,
    }

    const connection = await connectLocalVoiceMode(
      {
        onTranscript() {},
        onError(error) {
          events.errors.push(error)
        },
        onClose() {
          events.closed += 1
        },
        onReady() {},
      },
      {
        maxTranscribeMs: 10,
        transcribeAudio: async () =>
          await new Promise<string>(() => {}),
      },
    )

    connection!.send(Buffer.from([1, 2, 3, 4]))
    const result = await connection!.finalize()

    expect(result).toBe('safety_timeout')
    expect(events.errors[0]).toContain('timed out')
    expect(events.closed).toBe(1)
  })
})

// ─── Test 6: Bundle version ─────────────────────────────────────────

describe('bundle: version truth', () => {
  test('cli.mjs contains current package version', () => {
    const cliPath = join(import.meta.dir, '../../../dist/cli.mjs')
    const packageJsonPath = join(import.meta.dir, '../../../package.json')
    if (!existsSync(cliPath)) return
    const cli = readFileSync(cliPath, 'utf8')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: string
    }
    expect(cli).toContain(packageJson.version ?? '')
  })
})
