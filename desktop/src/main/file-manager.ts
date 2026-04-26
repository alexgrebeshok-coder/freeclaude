import fs from 'fs/promises';
import path from 'path';

interface FileStat {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  mtime: number;
}

export class FileManager {
  async readFile(filePath: string): Promise<{ content: string; error?: string }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
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
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
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
      const stats = await fs.stat(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
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

  async readDir(dirPath: string): Promise<FileStat[] | { error: string }> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const stats: FileStat[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
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
          // Skip entries we can't stat
        }
      }

      // Sort: directories first, then alphabetically
      stats.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return stats;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to read directory'
      };
    }
  }
}
