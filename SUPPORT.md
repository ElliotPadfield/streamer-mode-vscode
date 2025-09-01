# Support

Thanks for using Streamer Mode! Here’s how to get help and report problems.

- Issues: https://github.com/ElliotPadfield/streamer-mode-vscode/issues
- Feature Requests: https://github.com/ElliotPadfield/streamer-mode-vscode/issues/new?labels=enhancement&template=feature_request.md
- Bugs: https://github.com/ElliotPadfield/streamer-mode-vscode/issues/new?labels=bug&template=bug_report.md

Before filing an issue
- Update to the latest extension version.
- Include VS Code version, OS, and reproduction steps.
- If safe, share a minimal snippet of text that reproduces the masking issue (redact sensitive data!).

Common tips
- Only values masked: Use named groups (e.g. `(?<value>...)`) with `group: "value"` in `streamerMode.patterns`.
- Hover actions: If hover doesn’t appear, ensure the style isn’t fully transparent (blur or block recommended).
- Built‑in presets: Toggle via `streamerMode.extraPresets`.

Security disclosure
- Please do not include real secrets in issues. If you believe you’ve found a security problem, open a private issue with minimal details and we’ll reach out.
