# Voice

> Status: stub.

FreeClaude has an experimental voice mode that pipes a local recording stack
(SoX `rec` + `whisper-cli` + `ffmpeg`) into the REPL. The Tauri prototype
exposed a "voice readiness" panel that probed each binary; the equivalent
panel for the Electron desktop app is parked for a post-1.0 iteration.

## Requirements

- macOS or Linux.
- `sox` (provides the `rec` binary) on `PATH`.
- `whisper-cli` on `PATH` and a downloaded GGUF/ggml model.
- `ffmpeg` on `PATH`.

## Quick check

```bash
which rec whisper-cli ffmpeg
```

If any of those are missing, voice mode falls back to text input.

## Roadmap

- 1.0: voice readiness diagnostics back in the desktop Settings → Diagnostics tab.
- Post-1.0: streaming push-to-talk inside the chat composer.
