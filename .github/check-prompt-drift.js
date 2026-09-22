#!/usr/bin/env node
/**
 * Fails if anything shared with Android Stow has drifted.
 *
 * The two apps duplicate the built-in polish prompts and a handful of identifiers.
 * They share preset names, so a divergence is silent — nothing crashes, the same
 * preset just quietly stops producing the same output on the phone and the iPad.
 * This check is the only thing standing between the two copies, since they live in
 * separate repos.
 *
 * Source of truth is mds08011/stow. Run with no arguments to fetch it from GitHub,
 * or pass a path to a local checkout:
 *
 *   node .github/check-prompt-drift.js
 *   node .github/check-prompt-drift.js ../stow
 *
 * Kotlin sources are located by FILENAME, never by package path. A previous version
 * hardcoded `com/example/stow/...` and was silently disarmed the day the Android
 * package was renamed to `io.github.mds08011.stow` — it then reported a missing file
 * rather than the real prompt drift that had landed alongside the rename.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = 'mds08011/stow';
const BRANCH = 'main';
const HTML = path.join(__dirname, '..', 'index.html');

/** Kotlin files this check reads, by basename. */
const KT_FILES = ['PolishPresets.kt', 'AudioTranscriber.kt', 'TranscriptionPolisher.kt'];

/** Multi-line prompts: JS const in index.html ↔ Kotlin val in PolishPresets.kt. */
const PROMPTS = [
  { label: 'Clean prose', name: 'DEFAULT_CLEAN_PROSE_PROMPT' },
  { label: 'Task capture', name: 'DEFAULT_TASK_CAPTURE_PROMPT' }
];

/**
 * Single-string identifiers that must match. Divergence here is the quietest kind:
 * a differing preset id breaks nothing until two histories are compared, and a
 * differing model id makes the apps incomparable while both keep working fine.
 */
const CONSTANTS = [
  { label: 'Clean prose id', js: 'ID_CLEAN_PROSE', kt: 'ID_CLEAN_PROSE', file: 'PolishPresets.kt' },
  { label: 'Task capture id', js: 'ID_TASK_CAPTURE', kt: 'ID_TASK_CAPTURE', file: 'PolishPresets.kt' },
  { label: 'Clean prose name', js: 'DEFAULT_CLEAN_PROSE_NAME', kt: 'DEFAULT_CLEAN_PROSE_NAME', file: 'PolishPresets.kt' },
  { label: 'Task capture name', js: 'DEFAULT_TASK_CAPTURE_NAME', kt: 'DEFAULT_TASK_CAPTURE_NAME', file: 'PolishPresets.kt' },
  { label: 'Jargon placeholder', js: 'JARGON_PLACEHOLDER', kt: 'JARGON_PLACEHOLDER', file: 'PolishPresets.kt' },
  { label: 'Today placeholder', js: 'TODAY_PLACEHOLDER', kt: 'TODAY_PLACEHOLDER', file: 'PolishPresets.kt' },
  { label: 'Transcribe model', js: 'MODELS.transcribe', kt: 'MODEL_TURBO', file: 'AudioTranscriber.kt' },
  { label: 'Polish model', js: 'MODELS.polish', kt: 'MODEL', file: 'TranscriptionPolisher.kt' }
];

const norm = s => s.replace(/\r\n?/g, '\n');

/**
 * Reads a Kotlin `val NAME = """ … """.trimMargin()` block.
 * trimMargin strips each line up to and including the '|' margin prefix, and drops a
 * blank first and last line.
 */
function kotlinPrompt(src, name) {
  const start = src.indexOf('val ' + name + ' = """');
  if (start < 0) throw new Error('PolishPresets.kt: no val named ' + name);
  const open = src.indexOf('"""', start) + 3;
  const close = src.indexOf('"""', open);
  if (close < 0) throw new Error('PolishPresets.kt: unterminated string for ' + name);
  return norm(src.slice(open, close))
    .split('\n')
    .map(l => l.replace(/^\s*\|/, ''))
    .join('\n')
    .replace(/^\n/, '')
    .replace(/\n[ \t]*$/, '');
}

/** Reads a Kotlin `const val NAME = "value"`. */
function kotlinConst(src, name, file) {
  const m = new RegExp('const val ' + name + '\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(src);
  if (!m) throw new Error(file + ': no const val named ' + name);
  return JSON.parse('"' + m[1] + '"');
}

/**
 * Reads a JS `const NAME = 'a\n' + 'b';` concatenation from index.html by evaluating
 * the literal expression — no manual unescaping to get wrong.
 */
function jsPrompt(src, name) {
  const start = src.indexOf('const ' + name + ' =');
  if (start < 0) throw new Error('index.html: no const named ' + name);
  const eq = src.indexOf('=', start) + 1;
  const end = src.indexOf(";\n", src.indexOf("';", eq));
  if (end < 0) throw new Error('index.html: could not find end of ' + name);
  const expr = norm(src.slice(eq, end)).trim();
  return new Function('"use strict"; return (' + expr + ')')();
}

/** Reads a JS `const NAME = 'value';`, or `OBJ.key: 'value'` for a dotted path. */
function jsConst(src, name) {
  if (name.includes('.')) {
    const [obj, key] = name.split('.');
    const block = new RegExp('const ' + obj + '\\s*=\\s*\\{([\\s\\S]*?)\\}').exec(src);
    if (!block) throw new Error('index.html: no const object named ' + obj);
    const m = new RegExp(key + '\\s*:\\s*\'((?:[^\'\\\\]|\\\\.)*)\'').exec(block[1]);
    if (!m) throw new Error('index.html: ' + obj + ' has no key ' + key);
    return m[1];
  }
  const m = new RegExp('const ' + name + '\\s*=\\s*\'((?:[^\'\\\\]|\\\\.)*)\'').exec(src);
  if (!m) throw new Error('index.html: no const named ' + name);
  return m[1];
}

/** First differing line, for an error message that points at the actual change. */
function firstDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) {
      return '  line ' + (i + 1) + '\n' +
        '    stow-web:  ' + JSON.stringify(x[i] === undefined ? null : x[i]) + '\n' +
        '    android:   ' + JSON.stringify(y[i] === undefined ? null : y[i]);
    }
  }
  return '  (identical line-by-line; trailing whitespace or line count differs)';
}

/** Reads the wanted .kt files out of a local checkout, keyed by basename. */
function localKotlin(root) {
  const found = {};
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'build') walk(p);
      } else if (KT_FILES.includes(e.name)) {
        found[e.name] = fs.readFileSync(p, 'utf8');
      }
    }
  };
  walk(path.join(root, 'app', 'src', 'main'));
  return found;
}

/** Resolves paths via the git tree API so a package rename cannot disarm the check. */
async function remoteKotlin() {
  const headers = { 'User-Agent': 'stow-web-drift-check' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  }

  const treeUrl = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
  const res = await fetch(treeUrl, { headers });
  if (!res.ok) throw new Error(`Could not list ${REPO}: HTTP ${res.status}`);
  const tree = (await res.json()).tree || [];

  const found = {};
  for (const name of KT_FILES) {
    const hit = tree.find(t => t.type === 'blob' && t.path.endsWith('/' + name));
    if (!hit) continue;
    const raw = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${hit.path}`;
    const file = await fetch(raw, { headers });
    if (!file.ok) throw new Error(`Could not fetch ${hit.path}: HTTP ${file.status}`);
    found[name] = await file.text();
    console.log('  found ' + hit.path);
  }
  return found;
}

async function loadKotlin() {
  const local = process.argv[2];
  if (local) {
    console.log('Comparing against local checkout: ' + local);
    return localKotlin(local);
  }
  console.log(`Comparing against ${REPO}@${BRANCH}`);
  return remoteKotlin();
}

(async () => {
  const kt = await loadKotlin();
  const missing = KT_FILES.filter(f => !kt[f]);
  if (missing.length) {
    throw new Error(
      'could not locate in Android Stow: ' + missing.join(', ') +
      '\nIf a file was renamed or deleted there, update KT_FILES in this script.'
    );
  }

  const html = fs.readFileSync(HTML, 'utf8');
  let failed = 0;

  console.log('\nPrompts');
  for (const { label, name } of PROMPTS) {
    const web = jsPrompt(html, name);
    const android = kotlinPrompt(kt['PolishPresets.kt'], name);
    if (web === android) {
      console.log('  ok    ' + label + ' (' + web.length + ' chars)');
    } else {
      failed++;
      console.error('  DRIFT ' + label);
      console.error(firstDiff(web, android));
    }
  }

  console.log('\nShared identifiers');
  for (const { label, js, kt: ktName, file } of CONSTANTS) {
    const web = jsConst(html, js);
    const android = kotlinConst(kt[file], ktName, file);
    if (web === android) {
      console.log('  ok    ' + label + ' = ' + JSON.stringify(web));
    } else {
      failed++;
      console.error('  DRIFT ' + label);
      console.error('    stow-web:  ' + JSON.stringify(web));
      console.error('    android:   ' + JSON.stringify(android) + '  (' + file + ')');
    }
  }

  if (failed) {
    console.error('\n' + failed + ' item(s) have drifted from Android Stow.');
    console.error('Update index.html to match, or change both repos together if the');
    console.error('divergence is deliberate — and record it in stow/docs/parity.md.');
    // Set the code and let the loop drain. process.exit() here trips a libuv
    // assertion on Windows because fetch's handle is still open.
    process.exitCode = 1;
    return;
  }
  console.log('\nEverything shared with Android Stow matches.');
})().catch(e => {
  console.error('check failed: ' + e.message);
  process.exitCode = 1;
});
