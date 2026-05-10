# FAQ

> Status: stub.

### Why a fork of Claude Code?

To remove the OAuth lock-in and let the user pick any OpenAI-compatible
provider, including local Ollama. See the comparison table in the [docs
README](README.md).

### Where does my API key live?

In `~/.freeclaude.json` under the matching provider entry. The desktop app
never copies it into its own settings file unless you explicitly type it into
Settings → Providers, in which case the override is stored under
`<userData>/FreeClaude/config/settings.json`. See [CONFIGURATION.md](CONFIGURATION.md).

### Does FreeClaude send analytics?

Off by default. The desktop app exposes an opt-in toggle (P4); when off, the
app never makes outbound network calls beyond the configured providers and
the auto-update feed.

### Can I run it offline?

Yes — pair the CLI with Ollama (or LM Studio). Point the relevant provider
entry in `~/.freeclaude.json` at `http://localhost:11434/v1` and the rest of
the stack works without internet.

### Why are some `docs/*.md` pages still stubs?

We are filling them out as part of the 1.0 documentation pass tracked in
`.cursor/plans/freeclaude_desktop_1.0_assembly_*.plan.md`.
