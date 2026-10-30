/**
 * Configuration / smoke tests for the Expense & Budget Visualizer.
 *
 * Uses only Node.js built-ins (fs, path, node:assert) — no browser or jsdom needed.
 * Run with:  node tests/config.test.js
 *
 * Requirements traced:
 *  - Req 6.1  : HTML + CSS + vanilla JS only (no frameworks)
 *  - Req 6.3  : exactly one CSS file in css/, exactly one JS file in js/
 *  - Req 9.1  : body font-size >= 16px
 *  - Req 9.2  : heading font-size >= body font-size + 4px
 *  - Req 2.2  : #transaction-list scrollable with bounded height
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const assert = require('assert');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');

/** Read a file relative to the workspace root. */
function readRoot(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** List all files in a directory (non-recursive, names only). */
function listFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir)).filter(name => {
    const full = path.join(ROOT, dir, name);
    return fs.statSync(full).isFile();
  });
}

/**
 * Parse a px value string like "16px" → 16.
 * Returns NaN if it can't parse.
 */
function parsePx(str) {
  const m = /^(\d+(\.\d+)?)px$/.exec((str || '').trim());
  return m ? parseFloat(m[1]) : NaN;
}

/**
 * Extract the value of a CSS property for a given selector block.
 * Finds the LAST matching selector block (so `var(--name)` fallbacks work too).
 *
 * @param {string} css      - full CSS source
 * @param {string} selector - e.g. "body", "h1", "#transaction-list"
 * @param {string} prop     - e.g. "font-size", "overflow-y"
 * @returns {string|null}
 */
function getCssProp(css, selector, prop) {
  // Find all blocks that start with the exact selector (accounting for whitespace).
  // We look for: <selector> { ... }
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the selector followed by an opening brace, then capture until the matching close
  const re = new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'g');
  let lastBlock = null;
  let m;
  while ((m = re.exec(css)) !== null) {
    lastBlock = m[1];
  }
  if (!lastBlock) return null;

  // Within the block, find the property
  const propRe = new RegExp('(?:^|;|\\s)' + prop.replace('-', '\\-') + '\\s*:\\s*([^;\\n]+)', 'i');
  const pm = propRe.exec(lastBlock);
  return pm ? pm[1].trim() : null;
}

/**
 * Resolve a CSS value that may be a var() reference.
 * Only one level of indirection is handled (sufficient for this project).
 *
 * @param {string} css   - full CSS source
 * @param {string} value - raw value, e.g. "var(--font-body)"
 * @returns {string}     - resolved value, e.g. "16px"
 */
function resolveCssValue(css, value) {
  if (!value) return value;
  const varMatch = /^var\((--[\w-]+)\)/.exec(value.trim());
  if (!varMatch) return value;
  const varName = varMatch[1];
  // Find the variable in :root { ... }
  const rootBlock = /:root\s*\{([^}]*)\}/s.exec(css);
  if (!rootBlock) return value;
  const varRe = new RegExp(varName.replace('-', '\\-') + '\\s*:\\s*([^;\\n]+)', 'i');
  const vm = varRe.exec(rootBlock[1]);
  return vm ? vm[1].trim() : value;
}

// ---------------------------------------------------------------------------
// Test runner (ultra-lightweight, no dependencies)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Load source files once
// ---------------------------------------------------------------------------
const css      = readRoot('css/style.css');
const html     = readRoot('index.html');
const appJs    = readRoot('js/app.js');

// ---------------------------------------------------------------------------
// 1. Project structure (Requirements 6.1, 6.3)
// ---------------------------------------------------------------------------
console.log('\n── Project structure (Req 6.1, 6.3) ──');

test('css/ contains exactly one file: style.css', () => {
  const files = listFiles('css');
  assert.deepStrictEqual(
    files,
    ['style.css'],
    `Expected only style.css in css/, got: ${files.join(', ')}`
  );
});

test('js/ contains exactly one file: app.js', () => {
  const files = listFiles('js');
  assert.deepStrictEqual(
    files,
    ['app.js'],
    `Expected only app.js in js/, got: ${files.join(', ')}`
  );
});

test('No JS framework imported in index.html or js/app.js (Req 6.1)', () => {
  const frameworks = ['react', 'vue', 'angular', 'jquery', 'backbone', 'ember', 'svelte', 'preact'];
  const combined = (html + appJs).toLowerCase();
  for (const fw of frameworks) {
    // Check for script src or import/require references
    const patterns = [
      new RegExp(`src=["'][^"']*${fw}[^"']*["']`),
      new RegExp(`import\\s+.*from\\s+["']${fw}`),
      new RegExp(`require\\s*\\(\\s*["']${fw}`),
    ];
    for (const pat of patterns) {
      assert.ok(
        !pat.test(combined),
        `Found framework reference matching /${pat.source}/`
      );
    }
  }
});

test('Chart.js is the only external CDN script in index.html (Req 6.3)', () => {
  // Collect all <script src="..."> tags that reference an external URL
  const externalScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)]
    .map(m => m[1])
    .filter(src => /^https?:\/\//i.test(src));

  assert.ok(
    externalScripts.length >= 1,
    'Expected at least one external CDN script (Chart.js) in index.html'
  );

  for (const src of externalScripts) {
    assert.ok(
      /chart\.js/i.test(src),
      `External CDN script is not Chart.js: ${src}`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Visual design (Requirements 9.1, 9.2, 2.2)
// ---------------------------------------------------------------------------
console.log('\n── Visual design (Req 9.1, 9.2, 2.2) ──');

test('body font-size is at least 16px (Req 9.1)', () => {
  const raw = getCssProp(css, 'body', 'font-size');
  assert.ok(raw, 'Could not find font-size in body selector');

  const resolved = resolveCssValue(css, raw);
  const px = parsePx(resolved);
  assert.ok(!isNaN(px), `Could not parse body font-size value: "${resolved}" (raw: "${raw}")`);
  assert.ok(px >= 16, `body font-size is ${px}px, expected >= 16px`);
});

test('h1 font-size is at least 20px (Req 9.2)', () => {
  const raw = getCssProp(css, 'h1', 'font-size');
  assert.ok(raw, 'Could not find font-size in h1 selector');

  const resolved = resolveCssValue(css, raw);
  const px = parsePx(resolved);
  assert.ok(!isNaN(px), `Could not parse h1 font-size value: "${resolved}" (raw: "${raw}")`);
  assert.ok(px >= 20, `h1 font-size is ${px}px, expected >= 20px (body + 4px)`);
});

test('h2 font-size is at least 20px (Req 9.2)', () => {
  const raw = getCssProp(css, 'h2', 'font-size');
  assert.ok(raw, 'Could not find font-size in h2 selector');

  const resolved = resolveCssValue(css, raw);
  const px = parsePx(resolved);
  assert.ok(!isNaN(px), `Could not parse h2 font-size value: "${resolved}" (raw: "${raw}")`);
  assert.ok(px >= 20, `h2 font-size is ${px}px, expected >= 20px (body + 4px)`);
});

test('#transaction-list has a bounded height property (max-height or height) (Req 2.2)', () => {
  const maxHeight = getCssProp(css, '#transaction-list', 'max-height');
  const height    = getCssProp(css, '#transaction-list', 'height');
  assert.ok(
    maxHeight || height,
    '#transaction-list has neither max-height nor height — scroll bounding not enforced'
  );
  // At least one must be a definite value (not "none" or "auto")
  const bounded = [maxHeight, height].filter(Boolean);
  const hasDefinite = bounded.some(v => {
    const resolved = resolveCssValue(css, v);
    return resolved !== 'none' && resolved !== 'auto';
  });
  assert.ok(hasDefinite, `#transaction-list bounded height is "${bounded.join(', ')}" — not a definite value`);
});

test('#transaction-list has overflow-y: auto or scroll (Req 2.2)', () => {
  const oy = getCssProp(css, '#transaction-list', 'overflow-y');
  assert.ok(oy, 'Could not find overflow-y in #transaction-list selector');
  const resolved = resolveCssValue(css, oy);
  assert.ok(
    resolved === 'auto' || resolved === 'scroll',
    `#transaction-list overflow-y is "${resolved}", expected "auto" or "scroll"`
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(44)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  • ${f.name}\n    ${f.message}`));
  process.exit(1);
} else {
  console.log('\n  All configuration tests passed.');
  process.exit(0);
}
