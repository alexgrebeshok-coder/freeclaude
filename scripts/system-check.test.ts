import { describe, expect, test } from 'bun:test'
import {
  createReportPayload,
  createVoiceRuntimeResults,
  parseOptions,
} from './system-check.ts'

describe('system-check', () => {
  test('parseOptions reads json and out flags', () => {
    expect(parseOptions(['--json', '--out', 'reports/runtime.json'])).toEqual({
      json: true,
      outFile: 'reports/runtime.json',
    })
  })

  test('createReportPayload counts passes, warnings, and failures', () => {
    const payload = createReportPayload(
      [
        { ok: true, label: 'Node.js version', detail: '24.3.0' },
        {
          ok: true,
          label: 'Voice recording (optional)',
          detail: 'Install SoX',
          severity: 'warn',
        },
        { ok: false, label: 'Provider reachability', detail: 'network error' },
      ],
      {
        cwd: '/tmp/freeclaude',
        timestamp: '2026-04-14T00:00:00.000Z',
        env: { OPENAI_API_KEY_SET: false },
      },
    )

    expect(payload.cwd).toBe('/tmp/freeclaude')
    expect(payload.timestamp).toBe('2026-04-14T00:00:00.000Z')
    expect(payload.env).toEqual({ OPENAI_API_KEY_SET: false })
    expect(payload.summary).toEqual({
      total: 3,
      passed: 1,
      warnings: 1,
      failed: 1,
    })
  })

  test('createVoiceRuntimeResults reports optional voice gaps as warnings', () => {
    const results = createVoiceRuntimeResults({
      recording: {
        ready: false,
        detail: 'Voice recording requires SoX. Install with: brew install sox',
      },
      transcription: {
        ready: false,
        detail: 'Transcription requires a Whisper model. Expected at: /tmp/model.bin',
      },
      inputReady: false,
      modelPath: '/tmp/model.bin',
      ffmpegAvailable: true,
      whisperCliAvailable: true,
      whisperModelAvailable: false,
    })

    expect(results).toHaveLength(2)
    expect(results.every(result => result.ok)).toBe(true)
    expect(results.map(result => result.severity)).toEqual(['warn', 'warn'])
  })

  test('createVoiceRuntimeResults passes when local voice input is ready', () => {
    const results = createVoiceRuntimeResults({
      recording: {
        ready: true,
        detail: 'Local audio capture ready via SoX (`rec`).',
      },
      transcription: {
        ready: true,
        detail: 'Local transcription ready (/tmp/model.bin)',
      },
      inputReady: true,
      modelPath: '/tmp/model.bin',
      ffmpegAvailable: true,
      whisperCliAvailable: true,
      whisperModelAvailable: true,
    })

    expect(results.map(result => result.ok)).toEqual([true, true])
    expect(results.map(result => result.severity)).toEqual([undefined, undefined])
  })
})
