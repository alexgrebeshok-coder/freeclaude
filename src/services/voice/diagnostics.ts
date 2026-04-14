import { existsSync } from 'node:fs'
import { isEnvTruthy, isRunningOnHomespace } from '../../utils/envUtils.js'
import {
  getDefaultWhisperModelPath,
  isFfmpegAvailable,
  isWhisperCliAvailable,
} from './stt.js'
import { execVoiceCommandNoThrow } from './exec.js'

export interface VoiceReadinessCheck {
  ready: boolean
  detail: string
}

export interface VoiceTranscriptionProbe {
  ffmpegAvailable: boolean
  whisperCliAvailable: boolean
  modelExists: boolean
  modelPath: string
}

export interface VoiceRecordingProbe {
  platform: NodeJS.Platform
  remoteEnvironment: boolean
  soxAvailable: boolean
  arecordAvailable: boolean
  installCommand: string | null
}

export interface LocalVoiceDiagnostics {
  recording: VoiceReadinessCheck
  transcription: VoiceReadinessCheck
  inputReady: boolean
  modelPath: string
  ffmpegAvailable: boolean
  whisperCliAvailable: boolean
  whisperModelAvailable: boolean
}

export function isVoiceTranscriptionReady(
  probe: VoiceTranscriptionProbe,
): boolean {
  return probe.ffmpegAvailable && probe.whisperCliAvailable && probe.modelExists
}

export function describeVoiceTranscriptionReadiness(
  probe: VoiceTranscriptionProbe,
): string {
  if (!probe.ffmpegAvailable) {
    return 'Transcription requires ffmpeg. Install with: brew install ffmpeg'
  }

  if (!probe.whisperCliAvailable) {
    return 'Transcription requires whisper-cli. Install with: brew install whisper-cpp'
  }

  if (!probe.modelExists) {
    return `Transcription requires a Whisper model. Expected at: ${probe.modelPath}`
  }

  return `Local transcription ready (${probe.modelPath})`
}

export function isLocalVoiceRecordingReady(
  probe: VoiceRecordingProbe,
): boolean {
  if (probe.remoteEnvironment) {
    return false
  }

  if (probe.platform === 'win32') {
    return false
  }

  if (probe.platform === 'linux') {
    return probe.arecordAvailable || probe.soxAvailable
  }

  return probe.soxAvailable
}

export function describeLocalVoiceRecordingReadiness(
  probe: VoiceRecordingProbe,
): string {
  if (probe.remoteEnvironment) {
    return 'Voice mode requires microphone access, but no audio device is available in this environment. Run FreeClaude locally to use voice input.'
  }

  if (probe.platform === 'win32') {
    return 'Voice recording requires the native audio module, which is not shipped in the open build.'
  }

  if (probe.platform === 'linux' && probe.arecordAvailable) {
    return 'Local audio capture ready via arecord.'
  }

  if (probe.soxAvailable) {
    return 'Local audio capture ready via SoX (`rec`).'
  }

  return probe.installCommand
    ? `Voice recording requires SoX. Install with: ${probe.installCommand}`
    : 'Voice recording requires SoX. Install with: brew install sox'
}

async function isCommandAvailable(
  command: string,
  args: string[],
): Promise<boolean> {
  const result = await execVoiceCommandNoThrow(command, args, {
    preserveOutputOnError: false,
  })
  return result.code === 0
}

async function detectInstallCommand(): Promise<string | null> {
  if (process.platform === 'darwin') {
    return (await isCommandAvailable('brew', ['--version']))
      ? 'brew install sox'
      : null
  }

  if (process.platform !== 'linux') {
    return null
  }

  if (await isCommandAvailable('apt-get', ['--version'])) {
    return 'sudo apt-get install sox'
  }

  if (await isCommandAvailable('dnf', ['--version'])) {
    return 'sudo dnf install sox'
  }

  if (await isCommandAvailable('pacman', ['--version'])) {
    return 'sudo pacman -S sox'
  }

  return null
}

export async function getLocalVoiceDiagnostics(): Promise<LocalVoiceDiagnostics> {
  const remoteEnvironment =
    isRunningOnHomespace() || isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  const [soxAvailable, arecordAvailable, installCommand] = await Promise.all([
    isCommandAvailable('rec', ['--version']),
    process.platform === 'linux'
      ? isCommandAvailable('arecord', ['--version'])
      : Promise.resolve(false),
    detectInstallCommand(),
  ])

  const recordingProbe: VoiceRecordingProbe = {
    platform: process.platform,
    remoteEnvironment,
    soxAvailable,
    arecordAvailable,
    installCommand,
  }

  const modelPath = getDefaultWhisperModelPath()
  const [ffmpegAvailable, whisperCliAvailable] = await Promise.all([
    isFfmpegAvailable(),
    isWhisperCliAvailable(),
  ])

  const transcriptionProbe: VoiceTranscriptionProbe = {
    ffmpegAvailable,
    whisperCliAvailable,
    modelExists: existsSync(modelPath),
    modelPath,
  }

  const recordingReady = isLocalVoiceRecordingReady(recordingProbe)
  const transcriptionReady = isVoiceTranscriptionReady(transcriptionProbe)

  return {
    recording: {
      ready: recordingReady,
      detail: describeLocalVoiceRecordingReadiness(recordingProbe),
    },
    transcription: {
      ready: transcriptionReady,
      detail: describeVoiceTranscriptionReadiness(transcriptionProbe),
    },
    inputReady: recordingReady && transcriptionReady,
    modelPath,
    ffmpegAvailable,
    whisperCliAvailable,
    whisperModelAvailable: transcriptionProbe.modelExists,
  }
}
