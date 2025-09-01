# Streamer Mode (VS Code)

Blur or hide secrets while streaming, screen sharing, or live demoing. Value‑only masking for .env, YAML/TOML/JSON; built‑in detectors for API keys and tokens (Stripe, AWS, GitHub, Slack, JWTs, URIs, and more). Hover to temporarily reveal.

## Features

- Value‑only masking: Keeps keys visible; hides only values in `.env`, YAML/TOML, JSON, properties, URIs (passwords).
- Built‑in presets: Stripe (`sk_`/`whsec_`), AWS, GitHub, JWTs, Slack, Google API keys, Twilio, SendGrid, Mailgun, Datadog, New Relic, and more.
- Temporary reveal: Hover masked text and click “Temporarily reveal (5s)”.
- Redacted copy: Overrides Copy to place a redacted version on the clipboard when enabled.
- Sensitive file guard: Warns when opening `.env`, keys, or other configured patterns.
- Status bar quick actions: Toggle, change style (blur/block/dots), toggle window‑title masking, open settings.
- Overview ruler markers: See masked regions at a glance.
- Default style: Blur (clean look for streams and recordings).

## Quick start

1) Install and run “Streamer Mode: Toggle”.  
2) Open a `.env` or config file — keys stay visible, values are blurred.  
3) Hover a masked value and click “Temporarily reveal (5s)”.

## Settings

- `streamerMode.enabled`: Enable Streamer Mode.
- `streamerMode.obfuscationStyle`: `blur` | `block` | `dots` (default: `blur`).
- `streamerMode.extraPresets`: Enable built‑in provider presets (default: `true`).
- `streamerMode.patterns`: Add your own patterns. Items support `{ name, regex, group? }`.
  - If `group` (number or name) is provided, only that capture group is masked (useful for value‑only masking).
  - Inline regex flags like `(?i)`/`(?m)` are supported at the start of the pattern.
- `streamerMode.dangerousFiles`: Glob patterns to warn on open (e.g., `**/.env*`).
- `streamerMode.maskWindowTitle`: Hide workspace names in the window title.
- `streamerMode.windowTitleMaskedValue`: Title format when masked (uses VS Code variables).

## Commands

- `Streamer Mode: Toggle` — Enable/disable.
- `Streamer Mode: Status Actions` — Quick actions from the status bar.
- `Streamer Mode: Cycle Obfuscation Style` — Switch blur/block/dots.
- `Streamer Mode: Copy Redacted` — Copy selection with secrets redacted.
- `Streamer Mode: Open Sensitive File Anyway` — Bypass guard for a file.

## Tips

- False positives: Add exceptions by narrowing your custom regex or disabling `extraPresets` and using explicit rules.
- Mask just the value: Use a named group `(?<value>...)` and set `"group": "value"`.
- Workspace overrides: Place settings in Workspace settings to tailor per‑project behavior.


## Development

```
npm install
npm run watch
F5 in VS Code to launch Extension Development Host
```

<!-- Screenshots can be added later once available -->
