const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_BACKUP_BYTES, MAX_BACKUP_FILE_BYTES, createBackupZip, parseBackupBytes, validateBackup } = require('../backup.js');

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


test('backup validation rejects unsupported and malformed records before import', () => {
  assert.throws(() => validateBackup({ version: 2, logs }), /version/i);
  assert.throws(() => validateBackup({ version: 1, logs: [] }), /at least one/i);
  assert.throws(() => validateBackup({ version: 1, logs: [{ id: 'x' }] }), /createdAt/i);
});

test('backup validation rejects duplicate record IDs', () => {
  assert.throws(() => validateBackup({ version: 1, logs: [logs[0], { ...logs[0] }] }), /duplicate/i);
});


test('backup parsing rejects oversized plain and compressed payloads', () => {
  const fflate = require('../vendor/fflate.min.js');
  const oversizedText = 'x'.repeat(5 * 1024 * 1024 + 1);
  assert.throws(() => parseBackupBytes(fflate.strToU8(oversizedText)), /too large/i);

  const zip = fflate.zipSync({ 'simplefit-history.json': fflate.strToU8(oversizedText) });
  assert.throws(() => parseBackupBytes(zip), /too large/i);
});


test('parsed backups report schema errors without mislabeling them as invalid JSON', () => {
  const fflate = require('../vendor/fflate.min.js');
  const malformed = fflate.strToU8(JSON.stringify({ version: 1, logs: [{ id: 'x' }] }));
  assert.throws(() => parseBackupBytes(malformed), /createdAt/i);
});


test('ZIP import ignores arbitrary JSON members and requires the stable backup name', () => {
  const fflate = require('../vendor/fflate.min.js');
  const validJson = fflate.strToU8(JSON.stringify({ version: 1, logs }));
  const zip = fflate.zipSync({ 'other.json': validJson });
  assert.throws(() => parseBackupBytes(zip), /does not contain/i);
});

test('ZIP export refuses records that the importer would reject', () => {
  const invalid = [{ ...logs[0], notes: 'x'.repeat(10001) }];
  assert.throws(() => createBackupZip(invalid), /notes/i);
});


test('ZIP import rejects duplicate case-variant stable backup members', () => {
  const fflate = require('../vendor/fflate.min.js');
  const bytes = fflate.strToU8(JSON.stringify({ version: 1, logs }));
  const zip = fflate.zipSync({
    'simplefit-history.json': bytes,
    'SIMPLEFIT-HISTORY.JSON': bytes
  });
  assert.throws(() => parseBackupBytes(zip), /multiple/i);
});


test('backup API exposes its maximum input size for pre-read browser checks', () => {
  assert.equal(MAX_BACKUP_BYTES, 5 * 1024 * 1024);
  assert.ok(MAX_BACKUP_FILE_BYTES > MAX_BACKUP_BYTES);
});


function patchZipUint32(bytes, signature, fieldOffset, value) {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  for (let offset = 0; offset <= copy.length - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) {
      view.setUint32(offset + fieldOffset, value, true);
      return copy;
    }
  }
  throw new Error('ZIP signature not found in test fixture.');
}

test('ZIP import verifies entry CRC integrity', () => {
  const zip = createBackupZip(logs);
  const corrupted = patchZipUint32(zip, 0x02014b50, 16, 0);
  assert.throws(() => parseBackupBytes(corrupted), /integrity/i);
});

test('ZIP import bounds actual output even when headers understate expansion', () => {
  const fflate = require('../vendor/fflate.min.js');
  const huge = new Uint8Array(6 * 1024 * 1024).fill(120);
  const zip = fflate.zipSync({ 'simplefit-history.json': huge });
  let forged = patchZipUint32(zip, 0x04034b50, 22, 100);
  forged = patchZipUint32(forged, 0x02014b50, 24, 100);
  assert.throws(() => parseBackupBytes(forged), /decompressed.*too large/i);
});


test('round counts must be non-negative safe integers', () => {
  assert.throws(
    () => validateBackup({ version: 1, logs: [{ ...logs[0], roundsCompleted: 1.5 }] }),
    /roundsCompleted/i
  );
  assert.throws(
    () => validateBackup({ version: 1, logs: [{ ...logs[0], roundsCompleted: Number.MAX_SAFE_INTEGER + 1 }] }),
    /roundsCompleted/i
  );
});


test('backup record count is bounded for safe synchronous history rendering', () => {
  const many = Array.from({ length: 10001 }, (_, index) => ({
    ...logs[0],
    id: `record-${index}`
  }));
  assert.throws(() => validateBackup({ version: 1, logs: many }), /too many/i);
});


test('backup validation rejects unknown record fields before aggregate serialization', () => {
  assert.throws(
    () => validateBackup({ version: 1, logs: [{ ...logs[0], unexpected: 'x' }] }),
    /unknown.*field/i
  );
});


test('every generated ZIP fits the importer file bound', () => {
  const zip = createBackupZip(logs);
  assert.ok(zip.length <= MAX_BACKUP_FILE_BYTES);
  assert.equal(parseBackupBytes(zip).logs.length, 1);
});
