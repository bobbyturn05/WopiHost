const test = require('node:test');
const assert = require('node:assert/strict');
const { LocksService } = require('../dist/locks/locks.service');

function createService(currentLock = null) {
  return new LocksService(
    { findOne: () => ({ lean: async () => currentLock }) },
    30_000,
    {},
    { async findByFileId() { return { fileId: 'file-id', bucket: 'documents', key: 'test.pptx' }; } },
  );
}

test('allows the initial save only for an unlocked zero-byte file without a lock header', async () => {
  await assert.doesNotReject(() => createService().assertPutFileLock('file-id', 'documents', 'test.pptx', undefined, 0));
});

test('rejects an unlocked zero-byte file when a stale lock header is supplied', async () => {
  await assert.rejects(
    () => createService().assertPutFileLock('file-id', 'documents', 'test.pptx', 'stale-lock', 0),
    (error) => error.getStatus() === 409,
  );
});

test('rejects an unlocked non-empty file', async () => {
  await assert.rejects(
    () => createService().assertPutFileLock('file-id', 'documents', 'test.pptx', undefined, 10),
    (error) => error.getStatus() === 409,
  );
});

test('rejects a lock header that does not match the active lock', async () => {
  await assert.rejects(
    () => createService({ lockId: 'active-lock' }).assertPutFileLock('file-id', 'documents', 'test.pptx', 'other-lock', 10),
    (error) => error.getStatus() === 409,
  );
});

test('Lock honors the requested extended lock expiration timeout', async () => {
  let update;
  const lockModel = {
    findOne: () => ({ lean: async () => null }),
    async updateOne(filter, changes) {
      update = { filter, changes };
      return { matchedCount: 1 };
    },
  };
  const operationLease = {
    run: async (_fileId, operation) => operation(async () => undefined),
  };
  const service = new LocksService(lockModel, 180_000, operationLease, { async findByFileId() { return { fileId: 'file-id', bucket: 'documents', key: 'test.pptx' }; } });
  const startedAt = Date.now();

  await service.lock('file-id', 'documents', 'test.pptx', 'lock-1', 360_000);

  assert.ok(update.changes.$set.expiresAt.getTime() >= startedAt + 359_000);
  assert.ok(update.changes.$set.expiresAt.getTime() <= startedAt + 361_000);
});

test('PutFile verifies the active lock without extending its expiration', async () => {
  let updates = 0;
  const lockModel = {
    findOne: () => ({ lean: async () => ({ lockId: 'active-lock' }) }),
    async updateOne() {
      updates += 1;
      return { matchedCount: 1 };
    },
  };
  const service = new LocksService(lockModel, 180_000, {}, { async findByFileId() { return { fileId: 'file-id', bucket: 'documents', key: 'test.pptx' }; } });

  await service.assertPutFileLock('file-id', 'documents', 'test.pptx', 'active-lock', 100);
  assert.equal(updates, 0);
});

test('LockExpirationTimeout accepts the WOPI range and rejects invalid values', () => {
  const { WopiController } = require('../dist/wopi/wopi.controller');
  const controller = new WopiController({}, {});

  assert.equal(controller.parseLockExpirationTimeout(undefined), undefined);
  assert.equal(controller.parseLockExpirationTimeout('60'), 60);
  assert.equal(controller.parseLockExpirationTimeout('3600'), 3600);
  assert.throws(() => controller.parseLockExpirationTimeout('59'), (error) => error.getStatus() === 400);
  assert.throws(() => controller.parseLockExpirationTimeout('3601'), (error) => error.getStatus() === 400);
  assert.throws(() => controller.parseLockExpirationTimeout('60s'), (error) => error.getStatus() === 400);
});


test('PutFile rejects a stale WOPI session after the document location changes', async () => {
  const service = new LocksService(
    { findOne: () => ({ lean: async () => null }) },
    30_000,
    {},
    { async findByFileId() { return { fileId: 'file-id', bucket: 'archive', key: 'renamed.pptx' }; } },
  );
  await assert.rejects(
    () => service.assertPutFileLock('file-id', 'documents', 'old.pptx', undefined, 0),
    (error) => error.getStatus() === 409,
  );
});
