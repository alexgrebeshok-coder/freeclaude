import React, { useState, useEffect } from 'react';

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  mtime: number;
}

interface FileExplorerProps {
  onFileSelect?: (path: string, content: string) => void;
}

export function FileExplorer({ onFileSelect }: FileExplorerProps): React.ReactElement {
  const [currentPath, setCurrentPath] = useState<string>('/Users');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const loadDirectory = async (path: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.fs.readDir(path);
      if ('error' in result) {
        setError(result.error);
      } else {
        setItems(result as FileItem[]);
        setCurrentPath(path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory(currentPath);
  }, []);

  const handleItemClick = async (item: FileItem) => {
    if (item.isDirectory) {
      await loadDirectory(item.path);
    } else if (item.isFile) {
      setSelectedFile(item.path);
      const result = await window.electron.fs.readFile(item.path);
      if (!result.error && onFileSelect) {
        onFileSelect(item.path, result.content);
      }
    }
  };

  const handleNavigateUp = () => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    loadDirectory(parent);
  };

  const handleOpenFile = async () => {
    const paths = await window.electron.dialog.openFile({
      properties: ['openFile', 'multiSelections']
    });
    if (paths && paths.length > 0) {
      const result = await window.electron.fs.readFile(paths[0]);
      if (!result.error && onFileSelect) {
        onFileSelect(paths[0], result.content);
      }
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <div className="breadcrumb">
          <button className="breadcrumb-up" onClick={handleNavigateUp} disabled={currentPath === '/'}>
            ↑
          </button>
          <span className="breadcrumb-path" title={currentPath}>
            {currentPath}
          </span>
        </div>
        <button className="file-action" onClick={handleOpenFile}>
          Open File
        </button>
      </div>

      <div className="file-explorer-content">
        {loading && <div className="loading">Loading...</div>}
        {error && <div className="error">{error}</div>}

        {!loading && !error && (
          <div className="file-list">
            {items.length === 0 && (
              <div className="empty">Empty directory</div>
            )}
            {items.map(item => (
              <div
                key={item.path}
                className={`file-item ${item.isDirectory ? 'directory' : 'file'} ${selectedFile === item.path ? 'selected' : ''}`}
                onClick={() => handleItemClick(item)}
              >
                <span className="file-icon">
                  {item.isDirectory ? '📁' : getFileIcon(item.name)}
                </span>
                <span className="file-name" title={item.name}>
                  {item.name}
                </span>
                <span className="file-size">{formatSize(item.size)}</span>
                <span className="file-date">{formatDate(item.mtime)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const icons: Record<string, string> = {
    js: '📜',
    ts: '📘',
    tsx: '⚛️',
    jsx: '⚛️',
    py: '🐍',
    json: '📋',
    md: '📝',
    css: '🎨',
    html: '🌐',
    svg: '🖼️',
    png: '🖼️',
    jpg: '🖼️',
    gif: '🖼️',
    pdf: '📄',
    zip: '📦',
    txt: '📄'
  };
  return icons[ext || ''] || '📄';
}
