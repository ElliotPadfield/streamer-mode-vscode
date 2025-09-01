# Streamer Mode (VS Code)

Hide secrets and sensitive info while streaming or screen sharing.

## Features

- Mask secret-like text via decorations (regex driven)
- Guard opening sensitive files (like `.env`, keys)
- Status bar toggle and context key
- Redacted copy: overrides copy to redact while enabled
- Optional window title masking to hide workspace names

## Settings

- `streamerMode.enabled`: Enable Streamer Mode
- `streamerMode.obfuscationStyle`: `dots` | `block` | `blur`
- `streamerMode.patterns`: Array of `{ name, regex }` patterns
- `streamerMode.dangerousFiles`: Glob patterns to warn on open
- `streamerMode.maskWindowTitle`: Toggle title masking
- `streamerMode.windowTitleMaskedValue`: Title format while enabled

## Commands

- `Streamer Mode: Toggle` — enable/disable
- `Streamer Mode: Copy Redacted` — copy selection with patterns redacted
- `Streamer Mode: Open Sensitive File Anyway` — bypass guard for a file

## Keybindings

When enabled, `Cmd/Ctrl+C` in the editor runs "Copy Redacted".

## Notes & Limitations

- Decorations visually hide text but do not modify the file. Hover text shows a generic label.
- Terminal output redaction is not implemented (VS Code API limitation). Consider using a dedicated terminal when streaming.
- The sensitive file guard prompts after the document opens; choose "Open Anyway" to bypass for that file.

## Development

```
npm install
npm run watch
F5 in VS Code to launch Extension Development Host
```

