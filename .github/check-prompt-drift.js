#!/usr/bin/env node
/**
 * Fails if a built-in polish prompt in index.html has drifted from the Android
 * app's PolishPresets.kt.
 *
 * The two apps share preset names. If the same preset produces different output
 * on the phone and on the iPad, that is a silent bug — nothing crashes, the
 * results just quietly stop matching. This check is the only thing standing
 * between the two copies, since they live in separate repos.
 *
 * Source of truth is mds08011/stow. Run with no arguments to fetch it from
 * GitHub, or pass a path to a local checkout:
 *
 *   node .github/check-prompt-drift.js
 *   node .github/check-prompt-drift.js ../stow
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KT_PATH = 'app/src/main/java/com/example/stow/PolishPresets.kt';
const KT_URL = 'https://raw.githubusercontent.com/mds08011/stow/main/' + KT_PATH;
const HTML = path.join(__dirname, '..', 'index.html');

/** Prompts to compare: JS const in index.html ↔ Kotlin val in PolishPresets.kt. */
const PROMPTS = [
  { label: 'Clean prose', name: 'DEFAULT_CLEAN_PROSE_PROMPT' },
  { label: 'Task capture', name: 'DEFAULT_TASK_CAPTURE_PROMPT' }
];

const norm = s => s.replace(/\r\n?/g, '\n');

/**
 * Reads a Kotlin `val NAME = """ … """.trimMargin()` block.
 * trimMargin strips each line up to and including the '|' margin prefix, and
 * drops a blank first and last line.
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

/**
 * Reads a JS `const NAME = 'a\n' + 'b';` concatenation from index.html by
 * evaluating the literal expression — no manual unescaping to get wrong.
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

/** First differing line, for an error message that points at the actual change. */
function firstDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) {
      return '  line ' + (i + 1) + '\n' +
        '    index.html:        ' + JSON.stringify(x[i] === undefined ? null : x[i]) + '\n' +
        '    PolishPresets.kt:  ' + JSON.stringify(y[i] === undefined ? null : y[i]);
    }
  }
  return '  (identical line-by-line; trailing whitespace or line count differs)';
}

async function loadKotlin() {
  const local = process.argv[2];
  if (local) {
    const p = path.join(local, KT_PATH);
    console.log('Comparing against local checkout: ' + p);
    return fs.readFileSync(p, 'utf8');
  }
  console.log('Comparing against ' + KT_URL);
  const res = await fetch(KT_URL);
  if (!res.ok) throw new Error('Could not fetch PolishPresets.kt: HTTP ' + res.status);
  return res.text();
}

(async () => {
  const kt = await loadKotlin();
  const html = fs.readFileSync(HTML, 'utf8');

  let failed = 0;
  for (const { label, name } of PROMPTS) {
    const web = jsPrompt(html, name);
    const android = kotlinPrompt(kt, name);
    if (web === android) {
      console.log('  ok    ' + label + ' (' + web.length + ' chars)');
    } else {
      failed++;
      console.error('  DRIFT ' + label);
      console.error(firstDiff(web, android));
    }
  }

  if (failed) {
    console.error('\n' + failed + ' prompt(s) have drifted from Android Stow.');
    console.error('Update the const in index.html to match PolishPresets.kt, or update both');
    console.error('together if the prompt was deliberately revised.');
    // Set the code and let the loop drain. process.exit() here trips a libuv
    // assertion on Windows because fetch's handle is still open.
    process.exitCode = 1;
    return;
  }
  console.log('\nBoth built-in prompts match Android Stow.');
})().catch(e => {
  console.error('check failed: ' + e.message);
  process.exitCode = 1;
});
