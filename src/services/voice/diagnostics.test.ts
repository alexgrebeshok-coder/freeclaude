import { describe, expect, test } from 'bun:test'
import {
  describeLocalVoiceRecordingReadiness,
  describeVoiceTranscriptionReadiness,
  getLocalVoiceDiagnostics,
  isLocalVoiceRecordingReady,
  isVoiceTranscriptionReady,
} from './diagnostics.ts'

describe('voice diagnostics', () => {
  test('transcription readiness requires ffmpeg, whisper-cli, and a model', () => {
    expect(
      isVoiceTranscriptionReady({
        ffmpegAvailable: true,
        whisperCliAvailable: true,
        modelExists: true,
        modelPath: '/tmp/model.bin',
      }),
    ).toBe(true)

    expect(
      isVoiceTranscriptionReady({
        ffmpegAvailable: false,
        whisperCliAvailable: true,
        modelExists: true,
        modelPath: '/tmp/model.bin',
      }),
    ).toBe(false)
  })

  test('transcription guidance prioritizes missing ffmpeg', () => {
    expect(
      describeVoiceTranscriptionReadiness({
        ffmpegAvailable: false,
        whisperCliAvailable: true,
        modelExists: true,
        modelPath: '/tmp/model.bin',
      }),
    ).toContain('brew install ffmpeg')
  })

  test('transcription guidance points to whisper-cli when missing', () => {
    expect(
      describeVoiceTranscriptionReadiness({
        ffmpegAvailable: true,
        whisperCliAvailable: false,
        modelExists: true,
        modelPath: '/tmp/model.bin',
      }),
    ).toContain('brew install whisper-cpp')
  })

  test('transcription guidance points to the missing model path', () => {
    expect(
      describeVoiceTranscriptionReadiness({
        ffmpegAvailable: true,
        whisperCliAvailable: true,
        modelExists: false,
        modelPath: '/tmp/model.bin',
      }),
    ).toContain('/tmp/model.bin')
  })

  test('linux recording can use arecord without SoX', () => {
    expect(
      isLocalVoiceRecordingReady({
        platform: 'linux',
        remoteEnvironment: false,
        soxAvailable: false,
        arecordAvailable: true,
        installCommand: 'sudo apt-get install sox',
      }),
    ).toBe(true)
  })

  test('recording guidance points to SoX when missing on macOS', () => {
    expect(
      describeLocalVoiceRecordingReadiness({
        platform: 'darwin',
        remoteEnvironment: false,
        soxAvailable: false,
        arecordAvailable: false,
        installCommand: 'brew install sox',
      }),
    ).toContain('brew install sox')
  })

  test('getLocalVoiceDiagnostics returns the expected shape', async () => {
    const diagnostics = await getLocalVoiceDiagnostics()

    expect(typeof diagnostics.inputReady).toBe('boolean')
    expect(typeof diagnostics.recording.ready).toBe('boolean')
    expect(typeof diagnostics.recording.detail).toBe('string')
    expect(typeof diagnostics.transcription.ready).toBe('boolean')
    expect(typeof diagnostics.transcription.detail).toBe('string')
    expect(typeof diagnostics.ffmpegAvailable).toBe('boolean')
    expect(typeof diagnostics.whisperCliAvailable).toBe('boolean')
    expect(typeof diagnostics.whisperModelAvailable).toBe('boolean')
    expect(typeof diagnostics.modelPath).toBe('string')
  })
})
