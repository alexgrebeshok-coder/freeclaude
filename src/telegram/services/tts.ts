import { execFile } from 'node:child_process'
import { readFile, unlink, rmdir } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class TTSService {
  constructor(
    private voice: string = 'ru-RU-DmitryNeural',
    private enabled: boolean = true,
  ) {}

  async isAvailable(): Promise<boolean> {
    if (!this.enabled) return false
    try {
      await execFileAsync('python3', ['-m', 'edge_tts', '--help'], {
        timeout: 5_000,
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Convert text to OGG audio (Telegram voice-compatible).
   * Returns null if TTS is disabled, unavailable, or text is too short.
   */
  async synthesize(text: string): Promise<Buffer | null> {
    if (!this.enabled || text.trim().length < 5) return null

    const workDir = await mkdtemp(join(tmpdir(), 'fc-tts-'))
    const mp3Path = join(workDir, 'output.mp3')
    const oggPath = join(workDir, 'output.ogg')

    try {
      await execFileAsync(
        'python3',
        [
          '-m',
          'edge_tts',
          '--voice',
          this.voice,
          '--text',
          text.slice(0, 4_000),
          '--write-media',
          mp3Path,
        ],
        { timeout: 30_000 },
      )

      await execFileAsync(
        'ffmpeg',
        ['-y', '-i', mp3Path, '-c:a', 'libopus', '-b:a', '64k', oggPath],
        { timeout: 10_000 },
      )

      return await readFile(oggPath)
    } catch (err) {
      console.error('[TTS] synthesis error:', err)
      return null
    } finally {
      await unlink(mp3Path).catch(() => {})
      await unlink(oggPath).catch(() => {})
      await rmdir(workDir).catch(() => {})
    }
  }
}
