/**
 * Renderer-side migration chain for `localStorage`-backed UI state.
 *
 * Why we need this: until 1.0, the renderer wrote the shell state under
 * `freeclaude-shell-state-v1` with no `schemaVersion`. P4 introduces a stable
 * key (`freeclaude-shell-state`) plus an explicit `schemaVersion` so we can
 * evolve the shape without silently dropping in-flight chats.
 *
 * Each migration takes the previous shape and produces the next. They are
 * pure, synchronous, idempotent. Add a new entry to `MIGRATIONS` whenever the
 * shape changes; never modify an old entry.
 */

import type { ChatSession, ProjectSummary, WorkspaceSelection } from '../types';

export const STORAGE_KEY = 'freeclaude-shell-state';
export const LEGACY_STORAGE_KEY = 'freeclaude-shell-state-v1';
export const CURRENT_SCHEMA_VERSION = 1;

export interface ShellStateV1 {
  schemaVersion: 1;
  chats: ChatSession[];
  activeWorkspace?: WorkspaceSelection;
  selectedProjectId?: string;
  homeDraft?: string;
  projects?: ProjectSummary[];
}

export type CurrentShellState = ShellStateV1;

type AnyShellState = { schemaVersion?: number; [key: string]: unknown };

type Migration = (input: AnyShellState) => AnyShellState;

/**
 * Migrations array, indexed by the *target* schema version. The migration at
 * index N takes shape (N-1) and returns shape N.
 *
 * Index 0 is unused — schemaVersion 0 means "legacy unversioned state".
 */
const MIGRATIONS: Record<number, Migration> = {
  1: (input) => {
    // From legacy unversioned ({chats, activeWorkspace, selectedProjectId, homeDraft})
    // to v1 by simply stamping the version. We do not mutate fields; existing
    // App code already tolerates missing properties.
    return {
      schemaVersion: 1,
      chats: Array.isArray(input.chats) ? input.chats : [],
      activeWorkspace: input.activeWorkspace,
      selectedProjectId: input.selectedProjectId,
      homeDraft: typeof input.homeDraft === 'string' ? input.homeDraft : '',
      // Projects stored as full ProjectSummary shapes; cast via unknown for forward compatibility.
      projects: Array.isArray(input.projects) ? (input.projects as unknown as ProjectSummary[]) : []
    };
  }
};

export function migrate(input: AnyShellState): CurrentShellState {
  let current: AnyShellState = input ?? {};
  let from = typeof current.schemaVersion === 'number' ? current.schemaVersion : 0;
  while (from < CURRENT_SCHEMA_VERSION) {
    const next = from + 1;
    const step = MIGRATIONS[next];
    if (!step) {
      break;
    }
    current = step(current);
    from = next;
  }
  current.schemaVersion = CURRENT_SCHEMA_VERSION;
  return current as unknown as CurrentShellState;
}

/**
 * Read the latest shell state from localStorage, applying migrations from any
 * legacy key. Falls back to a fresh CurrentShellState when nothing is stored.
 */
export function loadShellState(): CurrentShellState {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        chats: [],
        homeDraft: '',
        projects: []
      };
    }
    const parsed = JSON.parse(raw) as AnyShellState;
    const migrated = migrate(parsed);

    // Persist the migrated payload under the canonical key so future loads
    // don't have to re-migrate from the legacy key.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      if (raw === localStorage.getItem(LEGACY_STORAGE_KEY)) {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch {
      // ignore quota errors — we still return the migrated value in memory
    }

    return migrated;
  } catch (err) {
    console.error('[shell-state] failed to load:', err);
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      chats: [],
      homeDraft: '',
      projects: []
    };
  }
}

export function saveShellState(state: Omit<CurrentShellState, 'schemaVersion'>): void {
  try {
    const payload: CurrentShellState = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      ...state
    } as CurrentShellState;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[shell-state] failed to save:', err);
  }
}
