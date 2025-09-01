import * as vscode from 'vscode';
import * as path from 'path';

type Pattern = { name: string; regex: string; group?: string | number };

let enabled = false;
let decorationType: vscode.TextEditorDecorationType | null = null;
let statusItem: vscode.StatusBarItem | null = null;
let suppressedSensitiveUris = new Set<string>();
const tempReveals = new Map<string, { start: number; end: number; expires: number }[]>();

const CTX_KEY = 'streamPrivacyActive';
const MEMENTO_PREV_TITLE_KEY = 'streamPrivacy.prevWindowTitle';

export function activate(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration();
  enabled = cfg.get<boolean>('streamPrivacy.enabled', false);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('streamPrivacy.toggle', async () => {
      await toggle(context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('streamPrivacy.statusActions', async () => {
      await showStatusActions(context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('streamPrivacy.cycleStyle', async () => {
      await cycleStyle();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('streamPrivacy.revealAtRange', async (uriStr?: string, sLine?: number, sChar?: number, eLine?: number, eChar?: number, ms?: number) => {
      const uri = uriStr ? vscode.Uri.parse(uriStr) : vscode.window.activeTextEditor?.document.uri;
      if (!uri) return;
      const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
      if (!ed) return;
      const start = new vscode.Position(sLine ?? ed.selection.start.line, sChar ?? ed.selection.start.character);
      const end = new vscode.Position(eLine ?? ed.selection.end.line, eChar ?? ed.selection.end.character);
      temporarilyReveal(ed.document, start, end, typeof ms === 'number' ? ms : 5000);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('streamPrivacy.copyRedacted', async () => {
      await copyRedacted();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('streamPrivacy.openSensitiveFileAnyway', async (uri?: vscode.Uri) => {
      if (!uri && vscode.window.activeTextEditor) {
        uri = vscode.window.activeTextEditor.document.uri;
      }
      if (uri) {
        suppressedSensitiveUris.add(uri.toString());
        await vscode.window.showTextDocument(uri);
      }
    })
  );

  // Status bar
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusItem.command = 'streamPrivacy.statusActions';
  context.subscriptions.push(statusItem);
  updateStatusItem();

  // Event listeners
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      refreshDecorations();
      if (ed) {
        // Also guard already-open sensitive files when switching focus
        handleSensitiveOpen(ed.document).catch(() => void 0);
      }
    })
  );
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => {
    if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
      refreshDecorations();
    }
  }));
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(handleSensitiveOpen));

  // Start
  setContext(enabled);
  applyMaskWindowTitle(context, enabled).catch(() => void 0);
  if (enabled) {
    ensureDecorationType();
    refreshDecorations();
  }
}

export function deactivate() {
  if (decorationType) {
    decorationType.dispose();
    decorationType = null;
  }
}

async function toggle(context: vscode.ExtensionContext) {
  enabled = !enabled;
  await vscode.workspace.getConfiguration().update('streamPrivacy.enabled', enabled, vscode.ConfigurationTarget.Global);
  setContext(enabled);
  updateStatusItem();

  if (enabled) {
    ensureDecorationType();
    refreshDecorations();
  } else {
    clearDecorations();
  }

  await applyMaskWindowTitle(context, enabled);
}

function updateStatusItem() {
  if (!statusItem) return;
  const style = vscode.workspace.getConfiguration().get<string>('streamPrivacy.obfuscationStyle', 'dots');
  statusItem.text = enabled ? '$(eye-closed) Streamer Mode' : '$(eye) Streamer Mode';
  const tooltip = new vscode.MarkdownString();
  tooltip.isTrusted = true;
  tooltip.appendMarkdown(enabled ? '**Streamer Mode: Enabled**\n\n' : '**Streamer Mode: Disabled**\n\n');
  tooltip.appendMarkdown(`Style: \`${style}\`  •  [Cycle](command:streamPrivacy.cycleStyle)\n\n`);
  tooltip.appendMarkdown('Click for quick actions.');
  statusItem.tooltip = tooltip;
  statusItem.show();
}

function setContext(on: boolean) {
  vscode.commands.executeCommand('setContext', CTX_KEY, on);
}

function ensureDecorationType() {
  if (decorationType) return;
  const style = vscode.workspace.getConfiguration().get<string>('streamPrivacy.obfuscationStyle', 'dots');
  const base: vscode.DecorationRenderOptions = {
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    overviewRulerColor: new vscode.ThemeColor('editorCodeLens.foreground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  };
  let opts: vscode.DecorationRenderOptions;
  if (style === 'blur') {
    opts = {
      ...base,
      // Use a tiny transparent background to ensure hover hit-testing
      backgroundColor: 'rgba(0,0,0,0.001)',
      textDecoration: 'none; filter: blur(6px);',
    };
  } else if (style === 'block') {
    opts = {
      ...base,
      color: 'rgba(0,0,0,0)',
      backgroundColor: new vscode.ThemeColor('editor.background'),
    };
  } else {
    // dots (default): hide text and overlay with dot placeholders using before
    opts = {
      ...base,
      color: 'rgba(0,0,0,0)',
      backgroundColor: 'rgba(0,0,0,0.001)',
    };
  }
  decorationType = vscode.window.createTextEditorDecorationType(opts);
}

function clearDecorations() {
  if (decorationType) {
    for (const ed of vscode.window.visibleTextEditors) {
      ed.setDecorations(decorationType, []);
    }
    decorationType.dispose();
    decorationType = null;
  }
}

function getPatterns(): Pattern[] {
  const arr = vscode.workspace.getConfiguration().get<any[]>('streamPrivacy.patterns', []);
  const out: Pattern[] = [];
  for (const p of arr) {
    if (p && typeof p.regex === 'string') {
      const item: Pattern = { name: String(p.name || 'secret'), regex: p.regex };
      if (p.group !== undefined) item.group = p.group as any;
      out.push(item);
    }
  }
  // Optionally add extra built-in presets
  if (vscode.workspace.getConfiguration().get<boolean>('streamPrivacy.extraPresets', true)) {
    out.push(...BUILTIN_PRESETS);
  }
  return out;
}

function refreshDecorations() {
  if (!enabled) return;
  if (!decorationType) ensureDecorationType();
  const editor = vscode.window.activeTextEditor;
  if (!editor || !decorationType) return;
  const text = editor.document.getText();
  const decorations: vscode.DecorationOptions[] = [];
  const style = vscode.workspace.getConfiguration().get<string>('streamPrivacy.obfuscationStyle', 'dots');
  cleanupExpiredReveals(editor.document);

  for (const p of getPatterns()) {
    try {
      const re = buildRegex(p.regex);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const [maskStart, maskEnd] = maskSpanFromMatch(m, p.group);
        if (maskStart == null || maskEnd == null || maskEnd <= maskStart) continue;
        if (isTemporarilyRevealed(editor.document, maskStart, maskEnd)) continue;
        const start = editor.document.positionAt(maskStart);
        const end = editor.document.positionAt(maskEnd);
        const maskedLen = Math.max(1, maskEnd - maskStart);
        const placeholder = style === 'dots' ? dotString(Math.min(64, maskedLen)) : '■'.repeat(Math.min(32, Math.ceil(maskedLen / 2)));
        const render: vscode.DecorationInstanceRenderOptions | undefined =
          style === 'dots'
            ? { before: { contentText: placeholder, color: new vscode.ThemeColor('editorCodeLens.foreground') } }
            : undefined;
        const hover = new vscode.MarkdownString();
        hover.isTrusted = true;
        const openSettingsCmd = `command:workbench.action.openSettings?${encodeURIComponent(JSON.stringify('streamPrivacy.patterns'))}`;
        const revealArgs = encodeURIComponent(JSON.stringify([editor.document.uri.toString(), start.line, start.character, end.line, end.character, 5000]));
        hover.appendMarkdown(`Streamer Mode: hidden ${p.name}\n\n[Temporarily reveal (5s)](command:streamPrivacy.revealAtRange?${revealArgs}) · [Manage Patterns](${openSettingsCmd}) · [Cycle Style](command:streamPrivacy.cycleStyle)`);
        decorations.push({
          range: new vscode.Range(start, end),
          hoverMessage: hover,
          renderOptions: render,
        });
      }
    } catch (err) {
      // ignore invalid regex
    }
  }

  editor.setDecorations(decorationType, decorations);
}

function dotString(length: number) {
  if (length <= 0) return '';
  const unit = '•';
  return unit.repeat(Math.max(6, Math.min(64, length)));
}

async function copyRedacted() {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return;
  const doc = ed.document;
  const sels = ed.selections && ed.selections.length ? ed.selections : [ed.selection];
  const parts: string[] = [];
  for (const s of sels) {
    if (s.isEmpty) {
      const line = doc.lineAt(s.active.line);
      const nl = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      const withEol = line.lineNumber < doc.lineCount - 1 ? line.text + nl : line.text;
      parts.push(withEol);
    } else {
      parts.push(doc.getText(s));
    }
  }
  const text = parts.join('\n');
  const redacted = redactText(text);
  await vscode.env.clipboard.writeText(redacted);
  vscode.window.setStatusBarMessage('Copied redacted text to clipboard', 2000);
}

function redactText(text: string): string {
  for (const p of getPatterns()) {
    try {
      const re = buildRegex(p.regex);
      if (p.group != null) {
        text = replaceGroupWith(text, re, p.group, '«hidden»');
      } else {
        text = text.replace(re, () => '«hidden»');
      }
    } catch (e) {
      // ignore invalid regex
    }
  }
  return text;
}

async function handleSensitiveOpen(doc: vscode.TextDocument) {
  if (!enabled) return;
  const uriStr = doc.uri.toString();
  if (suppressedSensitiveUris.has(uriStr)) return;
  const patterns = vscode.workspace.getConfiguration().get<string[]>('streamPrivacy.dangerousFiles', []);
  const rel = vscode.workspace.asRelativePath(doc.uri, false);
  const full = doc.uri.fsPath;
  const match = patterns.some((g) => globMatch(g, rel) || globMatch(g, full));
  if (!match) return;

  const choice = await vscode.window.showWarningMessage(
    `Streamer Mode: “${path.basename(full)}” matches a sensitive pattern.`,
    { modal: true },
    'Open Anyway',
    'Close'
  );
  if (choice === 'Open Anyway') {
    suppressedSensitiveUris.add(uriStr);
    return; // allow open
  }
  // Close if it's the active editor
  if (vscode.window.activeTextEditor?.document === doc) {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  }
}

function globToRegExp(glob: string): RegExp {
  // Very small globber: **, *, ?, and path separators
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
      } else {
        re += '[^/\\]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '.';
      i += 1;
    } else if (c === '.') {
      re += '\\.';
      i += 1;
    } else if (c === '/') {
      re += '[\\/]{1}';
      i += 1;
    } else {
      re += escapeRegex(c);
      i += 1;
    }
  }
  re += '$';
  return new RegExp(re, 'i');
}

function escapeRegex(s: string) {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function globMatch(glob: string, target: string): boolean {
  try {
    return globToRegExp(glob).test(target);
  } catch {
    return false;
  }
}

async function applyMaskWindowTitle(context: vscode.ExtensionContext, turnOn: boolean) {
  const cfg = vscode.workspace.getConfiguration('window');
  const mask = vscode.workspace.getConfiguration().get<boolean>('streamPrivacy.maskWindowTitle', true);
  if (!mask) return;
  const maskedValue = vscode.workspace.getConfiguration().get<string>('streamPrivacy.windowTitleMaskedValue', '${appName}');
  if (turnOn) {
    const current = cfg.get<string>('title');
    await context.globalState.update(MEMENTO_PREV_TITLE_KEY, current ?? null);
    await cfg.update('title', maskedValue, vscode.ConfigurationTarget.Global);
  } else {
    const prev = context.globalState.get<string | null>(MEMENTO_PREV_TITLE_KEY, null);
    await cfg.update('title', prev ?? undefined, vscode.ConfigurationTarget.Global);
    await context.globalState.update(MEMENTO_PREV_TITLE_KEY, null);
  }
}

// Parse simple inline flags like (?im) or (?i) at the start of a pattern
// and convert them to JS RegExp flags. Always includes 'g' and 'd' (hasIndices) when available.
function parseRegex(input: string): { source: string; flags: string } {
  let pattern = input.trim();
  let collected = '';
  // Support a single leading inline flag group like (?im)
  if (pattern.startsWith('(?')) {
    const close = pattern.indexOf(')');
    if (close > 2) {
      const maybeFlags = pattern.slice(2, close);
      // Only accept letters, no colon (to avoid constructs like (?:...))
      if (/^[a-zA-Z]+$/.test(maybeFlags)) {
        for (const ch of maybeFlags) {
          if ('imsuy'.includes(ch) && !collected.includes(ch)) collected += ch;
          if (ch === 'i' && !collected.includes('i')) collected += 'i';
        }
        pattern = pattern.slice(close + 1);
      }
    }
  }
  // Always global for repeated matches, and request indices if supported (Node 16+)
  const base = 'gd';
  const flags = Array.from(new Set((base + collected).split(''))).join('');
  return { source: pattern, flags };
}

function buildRegex(input: string): RegExp {
  const { source, flags } = parseRegex(input);
  try {
    return new RegExp(source, flags);
  } catch {
    // Fallback without 'd' if environment doesn't support it
    const noD = flags.replace('d', '');
    return new RegExp(source, noD);
  }
}

// Given a match and optional group key, return [start,end] indices to mask
function maskSpanFromMatch(m: RegExpExecArray, group?: string | number): [number | null, number | null] {
  const anyM = m as any;
  const baseIndex: number = m.index ?? 0;
  if (group == null) {
    return [baseIndex, baseIndex + m[0].length];
  }
  // Prefer hasIndices API when available
  if (anyM.indices) {
    if (typeof group === 'number') {
      const tup = anyM.indices[group];
      if (tup && tup[0] != null && tup[1] != null) return [tup[0], tup[1]];
    } else if (anyM.indices.groups && anyM.indices.groups[group]) {
      const tup = anyM.indices.groups[group];
      if (tup && tup[0] != null && tup[1] != null) return [tup[0], tup[1]];
    }
  }
  // Fallback: find the group text inside the full match (may be ambiguous)
  const idx = typeof group === 'number' ? group : (m.groups ? m.groups[group] : undefined);
  const gText = typeof idx === 'string' ? idx : m[Number(group) || 0];
  if (!gText) return [baseIndex, baseIndex + m[0].length];
  const rel = m[0].indexOf(gText);
  if (rel < 0) return [baseIndex, baseIndex + m[0].length];
  const start = baseIndex + rel;
  return [start, start + gText.length];
}

// Replace only the specified group within matches
function replaceGroupWith(text: string, re: RegExp, group: string | number, replacement: string): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [s, e] = maskSpanFromMatch(m, group);
    if (s == null || e == null) continue;
    out += text.slice(last, s) + replacement;
    last = e;
  }
  out += text.slice(last);
  return out;
}

function temporarilyReveal(doc: vscode.TextDocument, startPos: vscode.Position, endPos: vscode.Position, ms: number) {
  const key = doc.uri.toString();
  const start = doc.offsetAt(startPos);
  const end = doc.offsetAt(endPos);
  const list = tempReveals.get(key) ?? [];
  const expires = Date.now() + Math.max(500, ms);
  list.push({ start, end, expires });
  tempReveals.set(key, list);
  if (doc === vscode.window.activeTextEditor?.document) {
    refreshDecorations();
  }
  setTimeout(() => {
    const arr = tempReveals.get(key);
    if (!arr) return;
    const now = Date.now();
    tempReveals.set(key, arr.filter(x => x.expires > now && !(x.start === start && x.end === end)));
    if (doc === vscode.window.activeTextEditor?.document) {
      refreshDecorations();
    }
  }, Math.max(500, ms));
}

function cleanupExpiredReveals(doc: vscode.TextDocument) {
  const key = doc.uri.toString();
  const arr = tempReveals.get(key);
  if (!arr) return;
  const now = Date.now();
  const next = arr.filter(x => x.expires > now);
  if (next.length !== arr.length) tempReveals.set(key, next);
}

function isTemporarilyRevealed(doc: vscode.TextDocument, start: number, end: number): boolean {
  const key = doc.uri.toString();
  const arr = tempReveals.get(key);
  if (!arr || !arr.length) return false;
  const now = Date.now();
  for (const r of arr) {
    if (r.expires <= now) continue;
    // any overlap hides the decoration
    if (Math.max(r.start, start) < Math.min(r.end, end)) return true;
  }
  return false;
}

async function showStatusActions(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration();
  const style = cfg.get<string>('streamPrivacy.obfuscationStyle', 'dots');
  const maskTitle = cfg.get<boolean>('streamPrivacy.maskWindowTitle', true);
  const items: vscode.QuickPickItem[] = [
    { label: enabled ? '$(circle-slash) Disable Streamer Mode' : '$(check) Enable Streamer Mode', description: '' },
    { label: '$(symbol-color) Obfuscation Style: dots', picked: style === 'dots' },
    { label: '$(symbol-color) Obfuscation Style: block', picked: style === 'block' },
    { label: '$(symbol-color) Obfuscation Style: blur', picked: style === 'blur' },
    { label: maskTitle ? '$(eye-closed) Disable Window Title Mask' : '$(eye) Enable Window Title Mask' },
    { label: '$(gear) Manage Patterns' },
  ];
  const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Streamer Mode actions' });
  if (!choice) return;
  const l = choice.label;
  if (l.includes('Enable Streamer Mode') || l.includes('Disable Streamer Mode')) {
    await toggle(context);
    return;
  }
  if (l.includes('dots')) {
    await cfg.update('streamPrivacy.obfuscationStyle', 'dots', vscode.ConfigurationTarget.Global);
  } else if (l.includes('block')) {
    await cfg.update('streamPrivacy.obfuscationStyle', 'block', vscode.ConfigurationTarget.Global);
  } else if (l.includes('blur')) {
    await cfg.update('streamPrivacy.obfuscationStyle', 'blur', vscode.ConfigurationTarget.Global);
  } else if (l.includes('Window Title Mask')) {
    const next = !maskTitle;
    await cfg.update('streamPrivacy.maskWindowTitle', next, vscode.ConfigurationTarget.Global);
    if (enabled) {
      // Re-apply window title according to new preference
      await applyMaskWindowTitle(context, enabled).catch(() => void 0);
    }
  } else if (l.includes('Manage Patterns')) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'streamPrivacy.patterns');
    return;
  }
  // Refresh to apply style change
  if (enabled) {
    if (decorationType) {
      decorationType.dispose();
      decorationType = null;
    }
    ensureDecorationType();
    refreshDecorations();
  }
  updateStatusItem();
}

async function cycleStyle() {
  const cfg = vscode.workspace.getConfiguration();
  const cur = cfg.get<string>('streamPrivacy.obfuscationStyle', 'dots');
  const order = ['dots', 'block', 'blur'] as const;
  const idx = order.indexOf(cur as any);
  const next = order[(idx + 1) % order.length];
  await cfg.update('streamPrivacy.obfuscationStyle', next, vscode.ConfigurationTarget.Global);
  if (enabled) {
    if (decorationType) {
      decorationType.dispose();
      decorationType = null;
    }
    ensureDecorationType();
    refreshDecorations();
  }
  updateStatusItem();
}

// Extra built-in presets maintained in code to avoid noisy JSON escaping.
const BUILTIN_PRESETS: Pattern[] = [
  // Value-only K/V styles
  { name: '.env (value only)', regex: String.raw`(?m)^(?:export\s+)?(?<key>[A-Z0-9_]{2,})=(?<value>(?:"[^"]*"|[^#\n]*))`, group: 'value' },
  { name: 'YAML/TOML secret keys (value only)', regex: String.raw`(?mi)^(?:\s*(?:password|pass|pwd|secret|token|api[_-]?key|client[_-]?secret|stripe[_-]?secret)\s*[:=]\s*)(?<value>(?:"[^"]*"|'[^']*'|[^#\n]+))`, group: 'value' },
  { name: 'JSON secret keys (value only)', regex: String.raw`(?mi)"(?:password|pass|pwd|secret|token|api[_-]?key|client[_-]?secret)"[ \t\r\n]*:[ \t\r\n]*(?<value>"[^"]*"|'[^']*'|[^ \t\r\n,}]+)`, group: 'value' },

  // Cloud/API tokens
  { name: 'Stripe secret key', regex: String.raw`(?i)sk_(?:test|live)_[0-9A-Za-z]{24,}` },
  { name: 'Stripe webhook secret', regex: String.raw`(?i)whsec_[A-Za-z0-9]{32,}` },
  { name: 'Google API key', regex: String.raw`AIza[0-9A-Za-z-_]{35}` },
  { name: 'Slack token', regex: String.raw`xox[baprs]-[A-Za-z0-9-]{10,48}` },
  { name: 'Slack webhook URL', regex: String.raw`https?://hooks\.slack\.com/services/T[0-9A-Z]{8,}/B[0-9A-Z]{8,}/[A-Za-z0-9]{24,}` },
  { name: 'Discord bot token', regex: String.raw`[A-Za-z\d]{24}\.[\w-]{6}\.[\w-]{27}` },
  { name: 'Telegram bot token', regex: String.raw`\b[0-9]{6,}:[A-Za-z0-9_-]{35}\b` },
  { name: 'GitLab personal token', regex: String.raw`glpat-[A-Za-z0-9_-]{20,}` },
  { name: 'Twilio Account SID', regex: String.raw`AC[0-9a-fA-F]{32}` },
  { name: 'Twilio Auth Token', regex: String.raw`(?i)\b[0-9a-f]{32}\b` },
  { name: 'SendGrid API key', regex: String.raw`SG\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{27}` },
  { name: 'Mailgun API key', regex: String.raw`key-[0-9a-zA-Z]{32}` },
  { name: 'Datadog API key', regex: String.raw`\b[0-9a-f]{32}\b` },
  { name: 'New Relic license key', regex: String.raw`\b[0-9A-Z]{40}\b` },

  // Provider specific/value-only
  { name: 'AWS credentials file (value only)', regex: String.raw`(?mi)^(?:aws_access_key_id|aws_secret_access_key)\s*=\s*(?<value>[^ \t\r\n]+)`, group: 'value' },

  // URIs (mask password only)
  { name: 'MongoDB URI password (value only)', regex: String.raw`(?i)mongodb(?:\+srv)?:\/\/[^:\s]+:(?<value>[^@\s]+)@`, group: 'value' },
  { name: 'Postgres URI password (value only)', regex: String.raw`(?i)postgres(?:ql)?:\/\/[^:\s]+:(?<value>[^@\s]+)@`, group: 'value' },
  { name: 'Redis URI password (value only)', regex: String.raw`(?i)redis(?:\+ssl)?:\/\/:?(?<value>[^@\s]+)@`, group: 'value' },
  { name: 'HTTP Basic auth password (value only)', regex: String.raw`(?i)https?:\/\/[^:\s]+:(?<value>[^@\s]+)@`, group: 'value' },
  { name: 'Azure SAS signature (value only)', regex: String.raw`(?i)([?&]sig=)(?<value>[A-Za-z0-9%+\/=]{20,})`, group: 'value' },

  // Blobs
  { name: 'Private key block', regex: String.raw`-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----` },
];
