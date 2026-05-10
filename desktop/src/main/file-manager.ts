import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const READ_DIR_MAX_ENTRIES = 5000;

interface FileStat {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  mtime: number;
}

interface TruncatedDirResult {
  entries: FileStat[];
  truncated: boolean;
  total: number;
}

export class FileManager {
  private readonly rootDir: string;

  /**
   * @param rootDir All file operations are restricted to paths under this
   *   directory. Defaults to the current user's home directory.
   */
  constructor(rootDir?: string) {
    this.rootDir = path.resolve(rootDir ?? os.homedir());
  }

  /**
   * Normalize and validate a caller-supplied path.
   *
   * Rejects:
   * - Paths containing NUL bytes (shell injection vector)
   * - Paths that resolve outside `rootDir` after normalization (path traversal)
   *
   * Returns the absolute, normalized path if safe.
   */
  private safePath(inputPath: string): string {
    if (inputPath.includes('\u0000')) {
      throw new Error('path must not contain NUL bytes');
    }
    const normalized = path.resolve(path.normalize(inputPath));
    // Allow the rootDir itself or anything strictly under it.
    const root = this.rootDir;
    if (normalized !== root && !normalized.startsWith(root + path.sep)) {
      throw new Error(`path must be under ${root}`);
    }
    return normalized;
  }

  async readFile(filePath: string): Promise<{ content: string; error?: string }> {
    try {
      const safe = this.safePath(filePath);
      const content = await fs.readFile(safe, 'utf-8');
      return { content };
    } catch (error) {
      return {
        content: '',
        error: error instanceof Error ? error.message : 'Failed to read file'
      };
    }
  }

  async writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
      const safe = this.safePath(filePath);
      const dir = path.dirname(safe);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(safe, content, 'utf-8');
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write file'
      };
    }
  }

  async stat(filePath: string): Promise<FileStat | { error: string }> {
    try {
      const safe = this.safePath(filePath);
      const stats = await fs.stat(safe);
      return {
        name: path.basename(safe),
        path: safe,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        size: stats.size,
        mtime: stats.mtime.getTime()
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to stat file'
      };
    }
  }

  async readDir(dirPath: string): Promise<FileStat[] | TruncatedDirResult | { error: string }> {
    try {
      const safe = this.safePath(dirPath);
      const rawEntries = await fs.readdir(safe, { withFileTypes: true });
      const total = rawEntries.length;

      // Cap the entries we stat to avoid pathologically large directories
      const limited = rawEntries.slice(0, READ_DIR_MAX_ENTRIES);
      const stats: FileStat[] = [];

      for (const entry of limited) {
        const fullPath = path.join(safe, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          stats.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
            size: stat.size,
            mtime: stat.mtime.getTime()
          });
        } catch {
          // Skip entries we can't stat (e.g. broken symlinks)
        }
      }

      // Sort: directories first, then alphabetically
      stats.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      if (total > READ_DIR_MAX_ENTRIES) {
        return { entries: stats, truncated: true, total };
      }
      return stats;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to read directory'
      };
    }
  }
}
