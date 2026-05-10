import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './ui/Icon';

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

// ── Tiny inline virtualizer ──────────────────────────────────────────────────

const ROW_HEIGHT = 56; // px — kept in sync with .file-item fixed height in components.css
const OVERSCAN = 5;
const VIRTUALIZE_THRESHOLD = 200;
const SKELETON_ROW_COUNT = 8;

interface VirtualSlice {
  visible: FileItem[];
  paddingTop: number;
  paddingBottom: number;
}

function computeVirtualSlice(
  items: FileItem[],
  containerHeight: number,
  scrollTop: number
): VirtualSlice {
  if (items.length <= VIRTUALIZE_THRESHOLD) {
    return { visible: items, paddingTop: 0, paddingBottom: 0 };
  }
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIdx = Math.min(items.length - 1, startIdx + visibleCount);
  return {
    visible: items.slice(startIdx, endIdx + 1),
    paddingTop: startIdx * ROW_HEIGHT,
    paddingBottom: Math.max(0, (items.length - endIdx - 1) * ROW_HEIGHT),
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function FileExplorer({ onFileSelect }: FileExplorerProps): React.ReactElement {
  const { t } = useTranslation();

  // null = home dir not yet resolved
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileReadError, setFileReadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [highlightedIdx, setHighlightedIdx] = useState<number>(-1);

  // Virtualization
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);
  const [scrollTop, setScrollTop] = useState(0);

  // ── Directory loader ──────────────────────────────────────────────────────

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setFileReadError(null);
    setHighlightedIdx(-1);
    setScrollTop(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    try {
      const result = (await window.electron.fs.readDir(path)) as
        | FileItem[]
        | { error: string }
        | { entries: FileItem[]; truncated: boolean; total: number };

      if ('error' in result) {
        setError((result as { error: string }).error);
      } else if ('entries' in result) {
        setItems((result as { entries: FileItem[] }).entries);
        setCurrentPath(path);
      } else {
        setItems(result as FileItem[]);
        setCurrentPath(path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('files.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Initialise to user home dir
  useEffect(() => {
    const init = async () => {
      try {
        const home = (await window.electron.paths.home()) as string | undefined;
        const startPath = home || '/';
        await loadDirectory(startPath);
      } catch {
        await loadDirectory('/');
      }
    };
    void init();
  }, [loadDirectory]);

  // ── Virtualization: measure container & track scroll ────────────────────

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      setScrollTop(scrollContainerRef.current.scrollTop);
    }
  }, []);

  // ── Navigation helpers ───────────────────────────────────────────────────

  const handleItemClick = useCallback(
    async (item: FileItem) => {
      if (item.isDirectory) {
        await loadDirectory(item.path);
      } else if (item.isFile) {
        setSelectedFile(item.path);
        setFileReadError(null);
        try {
          const result = (await window.electron.fs.readFile(item.path)) as {
            content: string;
            error?: string;
          };
          if (result.error) {
            setFileReadError(t('files.failedToReadFile', { path: item.path, error: result.error }));
            return;
          }
          if (onFileSelect) {
            onFileSelect(item.path, result.content);
          }
        } catch (err) {
          setFileReadError(
            t('files.failedToReadFile', {
              path: item.path,
              error: err instanceof Error ? err.message : t('errors.fileLoad'),
            })
          );
        }
      }
    },
    [loadDirectory, onFileSelect, t]
  );

  const handleNavigateUp = useCallback(() => {
    if (!currentPath || currentPath === '/') return;
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    void loadDirectory(parent);
  }, [currentPath, loadDirectory]);

  const handleOpenFile = useCallback(async () => {
    const paths = (await window.electron.dialog.openFile({
      properties: ['openFile'],
    })) as string[] | undefined;
    if (paths && paths.length > 0) {
      setFileReadError(null);
      try {
        const result = (await window.electron.fs.readFile(paths[0])) as {
          content: string;
          error?: string;
        };
        if (result.error) {
          setFileReadError(t('files.failedToReadFile', { path: paths[0], error: result.error }));
          return;
        }
        if (onFileSelect) {
          onFileSelect(paths[0], result.content);
        }
      } catch (err) {
        setFileReadError(
          t('files.failedToReadFile', {
            path: paths[0],
            error: err instanceof Error ? err.message : t('errors.fileLoad'),
          })
        );
      }
    }
  }, [onFileSelect, t]);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const count = items.length;
      if (count === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIdx((prev) => Math.min(prev + 1, count - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIdx((prev) => Math.max(prev - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          setHighlightedIdx(0);
          break;
        case 'End':
          e.preventDefault();
          setHighlightedIdx(count - 1);
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightedIdx >= 0 && highlightedIdx < count) {
            void handleItemClick(items[highlightedIdx]);
          }
          break;
        case 'Backspace':
          e.preventDefault();
          handleNavigateUp();
          break;
        default:
          if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleNavigateUp();
          }
      }
    },
    [items, highlightedIdx, handleItemClick, handleNavigateUp]
  );

  // Scroll the highlighted row into view (works for both regular and virtual lists)
  useEffect(() => {
    if (highlightedIdx < 0) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const itemTop = highlightedIdx * ROW_HEIGHT;
    const itemBottom = itemTop + ROW_HEIGHT;
    if (itemTop < el.scrollTop) {
      el.scrollTop = itemTop;
    } else if (itemBottom > el.scrollTop + containerHeight) {
      el.scrollTop = itemBottom - containerHeight;
    }
  }, [highlightedIdx, containerHeight]);

  // ── Formatting helpers ────────────────────────────────────────────────────

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (timestamp: number): string =>
    new Date(timestamp).toLocaleDateString();

  // ── Compute virtual slice ─────────────────────────────────────────────────

  const { visible, paddingTop, paddingBottom } = computeVirtualSlice(
    items,
    containerHeight,
    scrollTop
  );

  // The global index of the first item in `visible`
  const visibleStartIdx =
    items.length > VIRTUALIZE_THRESHOLD
      ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
      : 0;

  const renderSkeletonRows = () => (
    <div className="file-list file-list-skeleton" aria-hidden="true">
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
        <div className="file-item file-item-skeleton" key={index}>
          <span className="file-skeleton-icon skeleton-line" />
          <span className="file-skeleton-name skeleton-line" />
          <span className="file-skeleton-size skeleton-line" />
          <span className="file-skeleton-date skeleton-line" />
        </div>
      ))}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <div className="breadcrumb">
          <button
            type="button"
            className="breadcrumb-up"
            onClick={handleNavigateUp}
            disabled={!currentPath || currentPath === '/'}
            aria-label={t('files.navigateUp')}
          >
            ↑
          </button>
          <span className="breadcrumb-path" title={currentPath ?? ''}>
            {currentPath ?? t('files.loading')}
          </span>
        </div>
        <button type="button" className="file-action" onClick={() => void handleOpenFile()}>
          {t('files.openFile')}
        </button>
      </div>

      <div
        ref={scrollContainerRef}
        className="file-explorer-content"
        tabIndex={0}
        role="listbox"
        aria-busy={loading}
        aria-label={t('files.listLabel', { path: currentPath ?? t('files.loading') })}
        onKeyDown={handleContainerKeyDown}
        onScroll={handleScroll}
      >
        {loading && renderSkeletonRows()}
        {error && <div className="error" role="alert">{error}</div>}
        {fileReadError && <div className="error file-read-error" role="alert">{fileReadError}</div>}

        {!loading && !error && (
          <div
            className="file-list"
            style={{
              paddingTop: paddingTop > 0 ? paddingTop : undefined,
              paddingBottom: paddingBottom > 0 ? paddingBottom : undefined,
            }}
          >
            {!currentPath && items.length === 0 && (
              <div className="loading">{t('files.loading')}</div>
            )}
            {currentPath && items.length === 0 && (
              <div className="empty">{t('files.empty')}</div>
            )}

            {visible.map((item, localIdx) => {
              const globalIdx = visibleStartIdx + localIdx;
              const isSelected = selectedFile === item.path;
              const isHighlighted = highlightedIdx === globalIdx;

              return (
                <button
                  type="button"
                  role="option"
                  key={item.path}
                  className={`file-item ${item.isDirectory ? 'directory' : 'file'}${isSelected ? ' selected' : ''}${isHighlighted ? ' highlighted' : ''}`}
                  tabIndex={isHighlighted ? 0 : -1}
                  aria-current={isSelected ? 'true' : undefined}
                  aria-selected={isSelected}
                  aria-label={t(item.isDirectory ? 'files.directoryItemLabel' : 'files.fileItemLabel', {
                    name: item.name,
                    size: formatSize(item.size),
                    modified: formatDate(item.mtime),
                  })}
                  onClick={() => {
                    setHighlightedIdx(globalIdx);
                    void handleItemClick(item);
                  }}
                >
                  <span className="file-icon" aria-hidden="true">
                    <Icon name={item.isDirectory ? 'folder' : 'file'} size={18} />
                  </span>
                  <span className="file-name" title={item.name}>
                    {item.name}
                  </span>
                  <span className="file-size">{formatSize(item.size)}</span>
                  <span className="file-date">{formatDate(item.mtime)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
