const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../exercises.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
const worker = fs.readFileSync(path.join(__dirname, '../service-worker.js'), 'utf8');

function tableSection(id, nextId) {
  const start = html.indexOf(`id="${id}"`);
  const end = nextId ? html.indexOf(`id="${nextId}"`, start) : html.indexOf('<section class="section grid two">', start);
  assert.ok(start >= 0 && end > start, `missing ${id} section`);
  return html.slice(start, end);
}

test('all workout tables use labelled keyboard-scrollable regions', () => {
  const regions = html.match(/<div class="workout-table-wrap" tabindex="0" role="region" aria-label="[^"]+">/g) || [];
  assert.equal(regions.length, 3);
  for (const label of ['Beginner workout table', 'Intermediate workout table', 'Advanced workout table']) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
  assert.equal((html.match(/<caption class="sr-only">/g) || []).length, 3);
});

test('workout tables declare balanced column roles for responsive sizing', () => {
  const beginner = tableSection('beginner', 'intermediate');
  const intermediate = tableSection('intermediate', 'advanced');
  const advanced = tableSection('advanced');

  for (const section of [beginner, intermediate]) {
    assert.match(section, /<col class="table-level">/);
    assert.equal((section.match(/<col class="table-day">/g) || []).length, 3);
  }
  assert.match(advanced, /<col class="table-reps">/);
  assert.equal((advanced.match(/<col class="table-day">/g) || []).length, 3);
  assert.match(html, /scope="col"/);
  assert.match(html, /scope="row"/);
});

test('mobile workout tables preserve native semantics and balanced widths', () => {
  assert.match(css, /\.workout-table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.workout-table\s*\{[^}]*display:\s*table[^}]*overflow:\s*visible/s);
  assert.match(css, /\.workout-table--beginner[^}]*min-width:/s);
  assert.match(css, /\.workout-table--intermediate[^}]*min-width:/s);
  assert.match(css, /\.workout-table--advanced[^}]*min-width:/s);
  assert.match(css, /\.workout-table col\.table-level\s*\{[^}]*width:/s);
  assert.match(css, /\.workout-table col\.table-reps\s*\{[^}]*width:/s);
  assert.doesNotMatch(css, /\.workout-table\s*\{\s*display:\s*block/);
});

test('exercise page and service worker use a coherent table-layout stylesheet version', () => {
  assert.match(html, /styles\.css\?v=workout-tables-1/);
  assert.match(worker, /const CACHE = 'simplefit-v11'/);
  assert.match(worker, /'styles\.css\?v=workout-tables-1'/);
});
