# FreeClaude v3 — Master Plan: "Best Free AI Coding Agent on the Market"

**Date:** 2026-04-11
**Vision:** Free Claude Code for everyone — no subscriptions, no API keys required, works with ANY provider
**Strategy:** Take the best from Claude Code + OpenClaw + OpenCode + Aider, combine with our unique stack

---

## Current State (v2.0)

**What works:**
- ✅ Claude Code fork builds and runs (`bun run build` → `dist/cli.mjs`)
- ✅ Fallback chain with multi-provider support (ZAI, Ollama, Gemini, etc.)
- ✅ GBrain semantic memory integration
- ✅ Debug Agent (evidence-based hypothesis generation)
- ✅ Token counter + cost calculator
- ✅ Provider setup wizard
- ✅ All 5 v2 sprints completed, pushed to GitHub

**What needs fixing:**
- ❌ Fallback chain not deeply integrated with all API paths
- ❌ Debug agent hypotheses are keyword-based (not LLM-powered)
- ❌ No tests for v2 features
- ❌ GBrain path is hardcoded
- ❌ Provider config wizard is basic
- ❌ Cost calculator doesn't track actual API usage
- ❌ No CI/CD pipeline
- ❌ Branding still says "Open Claude"

**Codebase:** 387K+ lines (Claude Code fork), 16 files modified in v2 (+2185 lines)

---

## Phase 0: Quality Foundation (DO FIRST)

### 0.1 Fix v2 Issues
- Fallback chain deep integration (all API paths)
- GBrain path resolution (not hardcoded)
- Cost calculator real tracking (parse API usage)
- Provider wizard connectivity test

### 0.2 Testing
- Test suite for all v2 features
- GitHub Actions CI

### 0.3 Branding
- Rename "Open Claude" → "FreeClaude"
- Version: 3.0.0
- Startup banner

---

## Phase 1: Core Features

### 1.1 Git Integration (from Aider)
- Auto-commit AI changes with meaningful messages
- `/undo` rollback, `/diff` view
- Repo-map for context

### 1.2 Voice Mode (from OpenClaw)
- Whisper STT + Edge TTS (code already exists)
- Push-to-talk, multi-language

### 1.3 Enhanced Fallback
- Latency tracking, cost awareness
- Smart retry with exponential backoff

### 1.4 Session Memory
- Auto-save/load via GBrain
- `/remember`, `/forget` commands

---

## Phase 2: Differentiation

### 2.1 Hooks System (already in fork, 5K+ lines)
### 2.2 Plugin System (already in fork, 30K+ lines)
### 2.3 Desktop App (Tauri — lightweight, cross-platform)

---

## Phase 3: Ecosystem

### 3.1 VS Code Extension
### 3.2 MCP Server Support (already in fork)
### 3.3 CEOClaw MCP Server (unique)
### 3.4 1С OData MCP Server (unique)

---

## Phase 4: Launch

### Website, npm, Homebrew, Docker, Community

---

## Execution

```
Phase 0 (tonight):   Fix + Test + Brand
Phase 1 (this week): Git + Voice + Fallback + Memory
Phase 2 (next week): Hooks + Plugins + Desktop MVP
Phase 3 (week 3):    VS Code + MCP + CEOClaw/1С
Phase 4 (week 4):    Launch
```

## OpenClaw Inspiration

1. Memory System — GBrain (done)
2. Voice Pipeline — Whisper + Edge TTS (from TOOLS.md)
3. Heartbeat — health checks
4. Skills — markdown definitions (in fork)
5. Telegram — notifications
6. Self-Improvement — reflection loops
7. Multi-agent — subagent spawning (in fork)
