(function (root, factory) {
  const library = typeof module === 'object' && module.exports
    ? require('./vendor/fflate.min.js')
    : root.fflate;
  const api = factory(library);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimpleFitBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fflate) {
  const BACKUP_NAME = 'simplefit-history.json';
  const MAX_LOGS = 10000;
  const MAX_TEXT = 10000;
  const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
  const MAX_BACKUP_FILE_BYTES = MAX_BACKUP_BYTES + 64 * 1024;
  const BACKUP_FIELDS = new Set(['version', 'exportedAt', 'logs']);
  const RECORD_FIELDS = new Set([
    'id', 'createdAt', 'program', 'level', 'day', 'type', 'title',
    'durationSeconds', 'roundsCompleted', 'score', 'notes'
  ]);

  function requireText(record, field, allowEmpty = false) {
    const value = record[field];
    if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > MAX_TEXT) {
      throw new Error(`Invalid ${field} in workout history record.`);
    }
  }

  function validateBackup(backup) {
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
      throw new Error('This file is not a valid SimpleFit history backup.');
    }
    for (const field of Object.keys(backup)) {
      if (!BACKUP_FIELDS.has(field)) throw new Error(`Unknown backup field: ${field}`);
    }
    if (backup.version !== 1) throw new Error('Unsupported SimpleFit backup version.');
    if (!Array.isArray(backup.logs)) throw new Error('This file is not a valid SimpleFit history backup.');
    if (backup.logs.length === 0) throw new Error('A history backup must contain at least one workout.');
    if (backup.logs.length > MAX_LOGS) throw new Error('This history backup contains too many workouts.');

    const ids = new Set();
    for (const record of backup.logs) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('Invalid workout history record.');
      }
      for (const field of Object.keys(record)) {
        if (!RECORD_FIELDS.has(field)) throw new Error(`Unknown workout history field: ${field}`);
      }
      requireText(record, 'id');
      requireText(record, 'createdAt');
      requireText(record, 'program');
      requireText(record, 'type');
      requireText(record, 'title');
      requireText(record, 'score', true);
      requireText(record, 'notes', true);
      if (Number.isNaN(Date.parse(record.createdAt))) throw new Error('Invalid createdAt in workout history record.');
      if (ids.has(record.id)) throw new Error(`Duplicate workout history id: ${record.id}`);
      ids.add(record.id);

      if (!Number.isFinite(record.durationSeconds) || record.durationSeconds < 0) {
        throw new Error('Invalid durationSeconds in workout history record.');
      }
      if (!Number.isSafeInteger(record.roundsCompleted) || record.roundsCompleted < 0) {
        throw new Error('Invalid roundsCompleted in workout history record.');
      }
      for (const field of ['level', 'day']) {
        if (record[field] !== null && (!Number.isInteger(record[field]) || record[field] < 0)) {
          throw new Error(`Invalid ${field} in workout history record.`);
        }
      }
    }
    return backup;
  }

  function backupJsonBytes(logs, exportedAt = new Date().toISOString()) {
    const backup = validateBackup({ version: 1, exportedAt, logs });
    const prefix = `{"version":1,"exportedAt":${JSON.stringify(exportedAt)},"logs":[`;
    const suffix = ']}';
    const records = [];
    let byteLength = fflate.strToU8(prefix).length + fflate.strToU8(suffix).length;
    for (const record of backup.logs) {
      const json = JSON.stringify(record);
      byteLength += fflate.strToU8(json).length + (records.length ? 1 : 0);
      if (byteLength > MAX_BACKUP_BYTES) throw new Error('The SimpleFit backup content is too large.');
      records.push(json);
    }
    return fflate.strToU8(prefix + records.join(',') + suffix);
  }

  function validateExportableLogs(logs) {
    backupJsonBytes(logs);
    return logs;
  }

  function createBackupZip(logs, exportedAt = new Date().toISOString()) {
    const zip = fflate.zipSync({ [BACKUP_NAME]: backupJsonBytes(logs, exportedAt) }, { level: 6 });
    if (zip.length > MAX_BACKUP_FILE_BYTES) throw new Error('The SimpleFit backup file is too large.');
    return zip;
  }

  function readZipBackupEntry(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const get16 = offset => {
      if (offset < 0 || offset + 2 > bytes.length) throw new Error('Invalid ZIP archive.');
      return view.getUint16(offset, true);
    };
    const get32 = offset => {
      if (offset < 0 || offset + 4 > bytes.length) throw new Error('Invalid ZIP archive.');
      return view.getUint32(offset, true);
    };

    let eocd = -1;
    const earliest = Math.max(0, bytes.length - 65557);
    for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
      if (get32(offset) === 0x06054b50 && get16(offset + 20) === bytes.length - offset - 22) {
        eocd = offset;
        break;
      }
    }
    if (eocd < 0) throw new Error('Invalid ZIP archive.');

    const disk = get16(eocd + 4);
    const centralDisk = get16(eocd + 6);
    const diskEntries = get16(eocd + 8);
    const totalEntries = get16(eocd + 10);
    const centralSize = get32(eocd + 12);
    const centralOffset = get32(eocd + 16);
    const commentLength = get16(eocd + 20);
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries || totalEntries > 1000
      || eocd + 22 + commentLength !== bytes.length
      || centralOffset + centralSize > eocd) {
      throw new Error('Unsupported or invalid ZIP archive.');
    }

    let cursor = centralOffset;
    let backupEntry = null;
    for (let index = 0; index < totalEntries; index += 1) {
      if (get32(cursor) !== 0x02014b50) throw new Error('Invalid ZIP central directory.');
      const flags = get16(cursor + 8);
      const method = get16(cursor + 10);
      const expectedCrc = get32(cursor + 16);
      const compressedSize = get32(cursor + 20);
      const originalSize = get32(cursor + 24);
      const nameLength = get16(cursor + 28);
      const extraLength = get16(cursor + 30);
      const entryCommentLength = get16(cursor + 32);
      const entryDisk = get16(cursor + 34);
      const localOffset = get32(cursor + 42);
      const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
      if (end > centralOffset + centralSize || entryDisk !== 0
        || compressedSize === 0xffffffff || originalSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error('Unsupported or invalid ZIP archive.');
      }
      const name = fflate.strFromU8(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (name.toLowerCase() === BACKUP_NAME) {
        if (backupEntry) throw new Error('The ZIP archive contains multiple SimpleFit history files.');
        backupEntry = { flags, method, expectedCrc, compressedSize, originalSize, localOffset, name };
      }
      cursor = end;
    }
    if (cursor !== centralOffset + centralSize) throw new Error('Invalid ZIP central directory.');
    if (!backupEntry) throw new Error('The ZIP archive does not contain a JSON history file.');
    if (backupEntry.flags & 1) throw new Error('Encrypted ZIP backups are not supported.');
    if (![0, 8].includes(backupEntry.method)) throw new Error('Unsupported ZIP compression method.');
    if (backupEntry.originalSize > MAX_BACKUP_BYTES) {
      throw new Error('The SimpleFit backup content is too large.');
    }

    const local = backupEntry.localOffset;
    if (get32(local) !== 0x04034b50) throw new Error('Invalid ZIP local header.');
    const localFlags = get16(local + 6);
    const localMethod = get16(local + 8);
    const localCrc = get32(local + 14);
    const localCompressedSize = get32(local + 18);
    const localOriginalSize = get32(local + 22);
    const localNameLength = get16(local + 26);
    const localExtraLength = get16(local + 28);
    const localName = fflate.strFromU8(bytes.subarray(local + 30, local + 30 + localNameLength));
    if (localName.toLowerCase() !== BACKUP_NAME || localFlags !== backupEntry.flags
      || localMethod !== backupEntry.method || (localFlags & 1)) {
      throw new Error('ZIP entry metadata failed its integrity check.');
    }
    if (!(localFlags & 8) && (localCrc !== backupEntry.expectedCrc
      || localCompressedSize !== backupEntry.compressedSize
      || localOriginalSize !== backupEntry.originalSize)) {
      throw new Error('ZIP entry metadata failed its integrity check.');
    }

    const dataStart = local + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + backupEntry.compressedSize;
    if (dataStart > bytes.length || dataEnd > centralOffset) throw new Error('Invalid ZIP entry bounds.');
    return { ...backupEntry, compressed: bytes.subarray(dataStart, dataEnd) };
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function decompressZipEntry(entry) {
    let output;
    if (entry.method === 0) {
      output = entry.compressed.slice();
      if (output.length > MAX_BACKUP_BYTES) throw new Error('The decompressed SimpleFit backup is too large.');
    } else {
      const chunks = [];
      let total = 0;
      let finished = false;
      const inflate = new fflate.Inflate((chunk, final) => {
        total += chunk.length;
        if (total > MAX_BACKUP_BYTES) throw new Error('The decompressed SimpleFit backup is too large.');
        if (chunk.length) chunks.push(chunk);
        if (final) finished = true;
      });
      try {
        if (!entry.compressed.length) {
          inflate.push(new Uint8Array(), true);
        } else {
          for (let offset = 0; offset < entry.compressed.length; offset += 512) {
            const end = Math.min(offset + 512, entry.compressed.length);
            inflate.push(entry.compressed.subarray(offset, end), end === entry.compressed.length);
          }
        }
      } catch (error) {
        if (/decompressed SimpleFit backup is too large/i.test(error.message)) throw error;
        throw new Error('ZIP entry failed its integrity check.');
      }
      if (!finished) throw new Error('ZIP entry failed its integrity check.');
      output = new Uint8Array(total);
      let cursor = 0;
      for (const chunk of chunks) {
        output.set(chunk, cursor);
        cursor += chunk.length;
      }
    }

    if (output.length !== entry.originalSize || crc32(output) !== entry.expectedCrc) {
      throw new Error('ZIP entry failed its integrity check.');
    }
    return output;
  }

  function parseBackupBytes(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > MAX_BACKUP_FILE_BYTES) throw new Error('The SimpleFit backup file is too large.');
    const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    let jsonBytes = bytes;

    if (isZip) {
      jsonBytes = decompressZipEntry(readZipBackupEntry(bytes));
    } else if (jsonBytes.length > MAX_BACKUP_BYTES) {
      throw new Error('The SimpleFit backup content is too large.');
    }

    let parsed;
    try {
      parsed = JSON.parse(fflate.strFromU8(jsonBytes));
    } catch (_) {
      throw new Error('The selected file does not contain valid SimpleFit history JSON.');
    }
    return validateBackup(parsed);
  }

  return { MAX_BACKUP_BYTES, MAX_BACKUP_FILE_BYTES, createBackupZip, parseBackupBytes, validateBackup, validateExportableLogs };
});
