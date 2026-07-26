/* Validate widget files and stamp the widget version (for SE auto-update).
   Usage:
     npm run build      → stamp widget.json widgetVersion from package.json
     npm run validate   → validate only (no writes)  [build.mjs --check] */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const read = (p) => readFile(path.join(ROOT, p), 'utf8');

function fail(msg) { console.error('✗ ' + msg); process.exitCode = 1; }

const pkg = JSON.parse(await read('package.json'));
const readme = await read('README.md');

const readmeVersion = readme.match(/\*\*Current: v([^*]+)\*\*/);
if (readmeVersion && readmeVersion[1] !== pkg.version) {
  fail(`README current version (${readmeVersion[1]}) does not match package.json (${pkg.version})`);
}

// Widgets tracking the root package.json version (auto-stamped below) vs.
// widgets that ship as their own independently-versioned SE Custom Widget
// (only checked for being well-formed and present).
const VERSION_SYNCED_DIRS = ['widget'];
const WIDGET_DIRS = ['widget', 'widget-kick-alerts'];

for (const dir of WIDGET_DIRS) {
  const rawJson = await read(`${dir}/widget.json`);
  let fields;
  try { fields = JSON.parse(rawJson); }
  catch (e) { fail(`${dir}/widget.json is not valid JSON: ` + e.message); continue; }

  // Required hidden fields for auto-update.
  for (const k of ['widgetName', 'widgetAuthor', 'widgetVersion', 'widgetUpdateUrl']) {
    if (!fields[k]) fail(`${dir}/widget.json missing required field: ${k}`);
  }
  if (VERSION_SYNCED_DIRS.includes(dir) && CHECK && fields.widgetVersion.value !== pkg.version) {
    fail(`${dir}/widget.json widgetVersion (${fields.widgetVersion.value}) does not match package.json (${pkg.version})`);
  }
  // Every field needs a type.
  for (const [k, v] of Object.entries(fields)) {
    if (!v || typeof v !== 'object' || !v.type) fail(`${dir}: field "${k}" missing "type"`);
  }

  const groups = [...new Set(Object.values(fields).map(f => f.group).filter(Boolean))];
  console.log(`${dir} — Fields: ${Object.keys(fields).length}  ·  Groups: ${groups.length} (${groups.join(', ')})`);

  // Confirm html/css/js exist and are non-empty.
  for (const f of [`${dir}/widget.html`, `${dir}/widget.css`, `${dir}/widget.js`]) {
    const c = await read(f).catch(() => '');
    if (!c.trim()) fail(`${f} is empty or missing`);
  }
}

if (process.exitCode === 1) { console.error('Build validation failed.'); process.exit(1); }

if (CHECK) { console.log('✓ Validation passed.'); process.exit(0); }

// Stamp version from package.json into the version-synced widget(s) only.
for (const dir of VERSION_SYNCED_DIRS) {
  const rawJson = await read(`${dir}/widget.json`);
  const fields = JSON.parse(rawJson);
  if (fields.widgetVersion.value !== pkg.version) {
    fields.widgetVersion.value = pkg.version;
    await writeFile(path.join(ROOT, `${dir}/widget.json`), JSON.stringify(fields, null, 2) + '\n');
    console.log(`✓ Stamped ${dir}/widget.json widgetVersion = ${pkg.version}`);
  } else {
    console.log(`✓ ${dir}/widget.json widgetVersion already ${pkg.version}`);
  }
}
