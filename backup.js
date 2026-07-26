(function (root, factory) {
  const library = typeof module === 'object' && module.exports
    ? require('./vendor/fflate.min.js')
    : root.fflate;
  const api = factory(library);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SimpleFitBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fflate) {
  const BACKUP_NAME = 'simplefit-history.json';

  function validateBackup(backup) {
    if (!backup || typeof backup !== 'object' || !Array.isArray(backup.logs)) {
      throw new Error('This file is not a valid SimpleFit history backup.');
    }
    return backup;
  }

  function createBackupZip(logs, exportedAt = new Date().toISOString()) {
    const backup = { version: 1, exportedAt, logs };
    const json = JSON.stringify(backup, null, 2);
    return fflate.zipSync({ [BACKUP_NAME]: fflate.strToU8(json) }, { level: 6 });
  }

  function parseBackupBytes(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    let jsonBytes = bytes;

    if (isZip) {
      const files = fflate.unzipSync(bytes);
      const name = Object.keys(files).find(key => key.toLowerCase() === BACKUP_NAME)
        || Object.keys(files).find(key => key.toLowerCase().endsWith('.json'));
      if (!name) throw new Error('The ZIP archive does not contain a JSON history file.');
      jsonBytes = files[name];
    }

    try {
      return validateBackup(JSON.parse(fflate.strFromU8(jsonBytes)));
    } catch (error) {
      if (error.message.includes('SimpleFit') || error.message.includes('ZIP archive')) throw error;
      throw new Error('The selected file does not contain valid SimpleFit history JSON.');
    }
  }

  return { createBackupZip, parseBackupBytes, validateBackup };
});
