# Memory System Guide

Complete guide to FreeClaude's memory system — persistent, session, and semantic memory.

## Overview

FreeClaude has a three-layer memory system:

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERFACE                           │
│              /remember /recall /forget                      │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   PERSISTENT  │    │    SESSION    │    │   SEMANTIC    │
│    MEMORY     │    │    MEMORY     │    │    MEMORY     │
│               │    │               │    │               │
│ ~/.freeclaude │    │  In-process   │    │   GBrain      │
│ /memory.json  │    │   storage     │    │  embeddings   │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │  MEMORY BRIDGE  │
                    │   (OpenClaw)    │
                    └─────────────────┘
```

---

## Persistent Memory

Long-term storage saved to disk. Survives restarts.

### Storage Location

```
~/.freeclaude/memory.json      # Main memory store
~/.freeclaude/vault/           # Memory vault notes
~/.freeclaude/daily/           # Daily notes (YYYY-MM-DD.md)
```

### Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/remember <key> <value>` | Save a fact | `/remember editor "Uses VS Code"` |
| `/recall <key>` | Retrieve by key | `/recall editor` |
| `/forget <key>` | Delete by key | `/forget editor` |
| `/memories` | List all memories | `/memories` |

### Examples

```
> /remember tech-stack "TypeScript, React, Node.js"
✓ Saved to memory.

> /remember prefers-hooks "User prefers functional components"
✓ Saved to memory.

> /recall tech-stack
TypeScript, React, Node.js

> /memories
┌────┬─────────────────┬──────────────────────────────┐
│ #  │ Key             │ Value                        │
├────┼─────────────────┼──────────────────────────────┤
│ 1  │ tech-stack      │ TypeScript, React, Node.js   │
│ 2  │ prefers-hooks   │ User prefers functional...   │
│ 3  │ editor          │ Uses VS Code                 │
└────┴─────────────────┴──────────────────────────────┘

> /forget prefers-hooks
✓ Memory "prefers-hooks" removed.
```

### Memory Format

```json
{
  "memories": [
    {
      "key": "tech-stack",
      "value": "TypeScript, React, Node.js",
      "created": "2026-04-17T10:30:00Z",
      "updated": "2026-04-17T10:30:00Z",
      "tags": ["project", "preferences"]
    }
  ],
  "version": "3.2.6"
}
```

### Best Practices

1. **Use descriptive keys** — `project-structure` not `info`
2. **Tag memories** — Organize with `/remember key value [tag1 tag2]`
3. **Regular cleanup** — Use `/forget` for outdated info
4. **Backup** — `~/.freeclaude/memory.json` is portable

---

## Session Memory

Temporary storage for the current session only.

### What It Stores

- **Conversation history** — All Q&A in current session
- **File context** — Recently read files
- **Tool results** — Previous command outputs
- **User preferences** — Inferred from interaction

### How It Works

```
User: Read package.json
[Session stores: file contents, structure, dependencies]

User: What's the main dependency?
[Session recalls: "bun" from stored file]

AI: The main dependency is Bun (from package.json)
```

### Managing Session Context

| Command | Description |
|---------|-------------|
| `/compact` | Compress long conversation |
| `/clear` | Clear screen (keeps memory) |
| `/context` | Show current context size |

### Session Persistence

By default, sessions are saved and can be resumed:

```bash
# Start a session
freeclaude

# ... do work ...

# Exit (or Ctrl+C)

# Resume later
freeclaude -c              # Continue last session
freeclaude -r              # Resume picker
freeclaude -r abc-123      # Resume specific session
```

### Disable Persistence

```bash
# For single command
freeclaude -p "query" --no-session-persistence

# Or in config
{
  "sessionPersistence": false
}
```

---

## Semantic Memory (GBrain)

AI-powered search across memories using embeddings.

### How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Memory     │────▶│ Embeddings   │────▶│   Vector     │
│    Text      │     │  (local)     │     │   Store      │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                         Query ────────────────────┤
                           │                       │
                           ▼                       ▼
                    ┌──────────────┐     ┌──────────────┐
                    │   Similarity │◀────│   Search     │
                    │    Scoring   │     │              │
                    └──────────────┘     └──────────────┘
```

### Features

- **Automatic indexing** — Memories indexed in background
- **Local embeddings** — No data sent to external services
- **Fuzzy matching** — Finds semantically similar content

### Using Semantic Search

```
> /recall code preferences
[Returns all memories about code style,
 even if key doesn't match "code"]

Results:
1. tech-stack: "TypeScript, React..." (score: 0.85)
2. prefers-hooks: "User prefers functional..." (score: 0.72)
3. editor: "Uses VS Code" (score: 0.45)
```

### Configuration

```json
{
  "semanticMemory": {
    "enabled": true,
    "indexOnSave": true,
    "maxResults": 10,
    "minScore": 0.5
  }
}
```

---

## Memory Bridge (OpenClaw Integration)

Sync FreeClaude memories with OpenClaw's MEMORY.md system.

### How It Works

```
┌──────────────┐         ┌──────────────┐
│  FreeClaude  │◄───────►│   OpenClaw   │
│   Memory     │  sync   │   MEMORY.md  │
└──────────────┘         └──────────────┘
      │                          │
      └──────────┬───────────────┘
                 ▼
        ┌──────────────┐
        │  Project     │
        │  Context     │
        └──────────────┘
```

### Syncing

```bash
# Manual sync
> /memory sync

# Auto-sync on project open
{
  "memory": {
    "autoSync": true,
    "syncPath": "./MEMORY.md"
  }
}
```

### MEMORY.md Format

```markdown
# Project Memory

## User Preferences
- Prefers TypeScript over JavaScript
- Uses functional React components
- Vim keybindings in editor

## Project Structure
- src/ — Source code
- tests/ — Test files
- docs/ — Documentation

## Decisions
- 2026-04-17: Switched from npm to Bun
- 2026-04-15: Added MCP server integration
```

---

## Daily Notes

For session summaries and daily reflections.

### Commands

| Command | Description |
|---------|-------------|
| `/daily` | Open today's note |
| `/daily view` | View recent entries |
| `/daily search <term>` | Search notes |

### Storage

```
~/.freeclaude/daily/
├── 2026-04-17.md
├── 2026-04-16.md
├── 2026-04-15.md
└── ...
```

### Example

```
> /daily
Opening 2026-04-17.md...

---
date: 2026-04-17
---

## Session 1 (Project: freeclaude-docs)
- Created comprehensive documentation
- Focus: Provider configuration
- Time: 2 hours

## Learnings
- Bun build is faster than npm
- MCP servers need explicit config
```

---

## Memory Vault

Long-term storage for important project notes.

### Access

```
> /vault list
Projects:
- freeclaude (last updated: 2026-04-17)
- website-redesign (last updated: 2026-04-15)

> /vault show freeclaude
[Shows project summary and key decisions]

> /vault search "TypeScript"
[Finds all notes mentioning TypeScript]
```

### Storage Structure

```
~/.freeclaude/vault/
├── projects/
│   ├── freeclaude.md
│   ├── website-redesign.md
│   └── ...
└── tasks/
    ├── task-abc-123.md
    └── ...
```

---

## Usage Scenarios

### Scenario 1: Coding Preferences

```
> /remember indent "2 spaces, not tabs"
> /remember quotes "Prefer single quotes"
> /remember imports "Sort: builtin, external, internal"

[Later in new session]
> Format this file
[AI recalls preferences from memory]
```

### Scenario 2: Project Context

```
> /remember project-auth "Auth uses JWT, not sessions"
> /remember project-db "PostgreSQL with Prisma ORM"

[Later]
> How do I query users?
[AI knows to suggest Prisma syntax]
```

### Scenario 3: API Keys (careful!)

```
❌ NEVER do this:
> /remember openai-api-key "sk-abc123..."

✅ Do this instead:
> /remember api-location "Keys in ~/.env"
# And use proper secret management
```

---

## Advanced: Memory API

For programmatic access:

```javascript
// In FreeClaude scripts/plugins
const memory = await freeclaude.memory.get('key');
await freeclaude.memory.set('key', 'value');
await freeclaude.memory.delete('key');
const all = await freeclaude.memory.list();

// Semantic search
const results = await freeclaude.memory.search('code style', { limit: 5 });
```

---

## Tips & Tricks

1. **Use namespaces in keys**: `project-auth`, `personal-editor`
2. **Review weekly**: `/memories` → `/forget` outdated info
3. **Export/import**: `~/.freeclaude/memory.json` is portable
4. **Backup**: Add to your dotfiles repo
5. **Privacy**: Sensitive data → don't `/remember`
