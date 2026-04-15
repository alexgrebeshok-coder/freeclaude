import { execFile } from 'node:child_process'
import { writeFile, unlink, mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class STTService {
  constructor(
    private modelPath: string = '~/.openclaw/models/whisper/ggml-small.bin',
    private language: string = 'ru',
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('whisper-cli', ['--help'], { timeout: 5_000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Transcribe OGG/Opus audio buffer (as received from Telegram) to text.
   * Returns null if transcription fails.
   */
  async transcribe(audioBuffer: Buffer): Promise<string | null> {
    const workDir = await mkdtemp(join(tmpdir(), 'fc-stt-'))
    const inputPath = join(workDir, 'input.ogg')
    const wavPath = join(workDir, 'input.wav')

    try {
      await writeFile(inputPath, audioBuffer)

      // Convert to 16kHz mono WAV required by whisper-cli
      await execFileAsync(
        'ffmpeg',
        ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', wavPath],
        { timeout: 10_000 },
      )

      const expandedModel = this.modelPath.replace(
        /^~/,
        process.env.HOME ?? '~',
      )
      const { stdout } = await execFileAsync(
        'whisper-cli',
        ['-m', expandedModel, '-l', this.language, '-t', '8', wavPath],
        { timeout: 60_000 },
      )

      return stdout.trim() || null
    } catch (err) {
      console.error('[STT] transcription error:', err)
      return null
    } finally {
      await unlink(inputPath).catch(() => {})
      await unlink(wavPath).catch(() => {})
      await rmdir(workDir).catch(() => {})
    }
  }
}
