import { useEffect, type RefObject } from 'react';
import type { WorkspaceSelection } from '../types';

interface Params {
  enabled: boolean;
  activeWorkspace: WorkspaceSelection;
  onNewChat: () => void;
  onToggleInspector: () => void;
  onCloseInspector: () => void;
  inspectorOpen: boolean;
  homeComposerRef: RefObject<HTMLTextAreaElement | null>;
  chatComposerRef: RefObject<HTMLTextAreaElement | null>;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}

export function useShellShortcuts({
  enabled,
  activeWorkspace,
  onNewChat,
  onToggleInspector,
  onCloseInspector,
  inspectorOpen,
  homeComposerRef,
  chatComposerRef,
  searchInputRef
}: Params): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const focusComposer = () => {
      if (activeWorkspace.type === 'search') {
        searchInputRef?.current?.focus({ preventScroll: true });
      } else if (activeWorkspace.type === 'chat') {
        chatComposerRef.current?.focus();
      } else if (activeWorkspace.type === 'home') {
        homeComposerRef.current?.focus();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusComposer();
        return;
      }
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        onNewChat();
        return;
      }
      if (meta && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        onToggleInspector();
        return;
      }
      if (event.key === 'Escape' && inspectorOpen) {
        event.preventDefault();
        onCloseInspector();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    enabled,
    activeWorkspace.type,
    onNewChat,
    onToggleInspector,
    onCloseInspector,
    inspectorOpen,
    homeComposerRef,
    chatComposerRef,
    searchInputRef
  ]);
}
