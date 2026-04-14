/**
 * FreeClaude v3 — Voice Service Tests
 */

import { describe, expect, test } from 'bun:test'
import {
  isWhisperAvailable,
  isEdgeTTSAvailable,
  getVoiceStatus,
} from './voiceService.ts'

describe('Voice Service', () => {
  test('getVoiceStatus returns object with required fields', () => {
    const status = getVoiceStatus()
    expect(status).toHaveProperty('stt')
    expect(status).toHaveProperty('tts')
    expect(status).toHaveProperty('ffmpeg')
    expect(status).toHaveProperty('whisperModel')
    expect(status).toHaveProperty('whisperModelPath')
    expect(status).toHaveProperty('transcriptionReady')
    expect(status).toHaveProperty('sttDetails')
    expect(status).toHaveProperty('ttsDetails')
    expect(status).toHaveProperty('transcriptionDetails')
    expect(typeof status.stt).toBe('boolean')
    expect(typeof status.tts).toBe('boolean')
    expect(typeof status.ffmpeg).toBe('boolean')
    expect(typeof status.whisperModel).toBe('boolean')
    expect(typeof status.whisperModelPath).toBe('string')
    expect(typeof status.transcriptionReady).toBe('boolean')
  })

  test('isWhisperAvailable returns boolean', () => {
    expect(typeof isWhisperAvailable()).toBe('boolean')
  })

  test('isEdgeTTSAvailable returns boolean', () => {
    expect(typeof isEdgeTTSAvailable()).toBe('boolean')
  })

  test('sttDetails mentions whisper when available', () => {
    const status = getVoiceStatus()
    if (status.stt) {
      expect(status.sttDetails).toContain('whisper')
    }
  })

  test('ttsDetails mentions edge-tts when available', () => {
    const status = getVoiceStatus()
    if (status.tts) {
      expect(status.ttsDetails).toContain('edge-tts')
    }
  })

  test('transcriptionReady matches the required local dependencies', () => {
    const status = getVoiceStatus()
    expect(status.transcriptionReady).toBe(
      status.stt && status.ffmpeg && status.whisperModel,
    )
  })
})
