const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBackupZip, parseBackupBytes } = require('../backup.js');

const root = path.resolve(__dirname, '..');
const logs = [{
  id: '2026-07-26T06:15:00.000Z',
  createdAt: '2026-07-26T06:15:00.000Z',
  program: 'beginner',
  level: 4,
  day: 1,
  type: 'amrap',
  title: 'Beginner level 4 · Day 1',
  durationSeconds: 1200,
  roundsCompleted: 14,
  score: '14 rounds',
  notes: 'Felt good'
}];

test('ZIP export round-trips workout history', () => {
  const bytes = createBackupZip(logs, '2026-07-26T07:00:00.000Z');
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');

  const backup = parseBackupBytes(bytes);
  assert.equal(backup.version, 1);
  assert.equal(backup.exportedAt, '2026-07-26T07:00:00.000Z');
  assert.deepEqual(backup.logs, logs);
});

test('workout app exposes ZIP export and ZIP/JSON import', () => {
  const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  assert.match(html, /vendor\/fflate\.min\.js/);
  assert.match(html, /backup\.js/);
  assert.match(html, /accept="[^"]*\.zip[^"]*\.json/);
  assert.match(app, /createBackupZip\(logs/);
  assert.match(app, /parseBackupBytes/);
});
