const test = require('node:test');
const assert = require('node:assert/strict');
const { OperationLeaseService } = require('../dist/locks/operation-lease.service');

function createLeaseModel() {
  const records = new Map();
  const keyOf = (fileId) => fileId;
  return {
    records,
    findOneAndUpdate(filter, update) {
      const key = keyOf(filter.fileId);
      const current = records.get(key);
      const expiredAt = filter.$or[0].expiresAt.$lte;
      if (current && current.expiresAt > expiredAt) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      const next = { ...update.$set };
      records.set(key, next);
      return { lean: async () => ({ ...next }) };
    },
    async updateOne(filter, update) {
      const record = records.get(keyOf(filter.fileId));
      if (!record || record.ownerToken !== filter.ownerToken || record.expiresAt <= filter.expiresAt.$gt) {
        return { matchedCount: 0 };
      }
      record.expiresAt = update.$set.expiresAt;
      return { matchedCount: 1 };
    },
    async deleteOne(filter) {
      const key = keyOf(filter.fileId);
      const record = records.get(key);
      if (record?.ownerToken === filter.ownerToken) records.delete(key);
      return { deletedCount: 1 };
    },
  };
}

test('document operations are serialized across service instances', async () => {
  const model = createLeaseModel();
  const firstHost = new OperationLeaseService(model, 120_000);
  const secondHost = new OperationLeaseService(model, 120_000);
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const firstOperation = firstHost.run('file-id-1', async () => waiting);

  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => secondHost.run('file-id-1', async () => undefined),
    (error) => error.getStatus() === 503,
  );

  release();
  await firstOperation;
  await assert.doesNotReject(() => secondHost.run('file-id-1', async () => undefined));
});

test('an operation cannot continue after its lease has been replaced', async () => {
  const model = createLeaseModel();
  const service = new OperationLeaseService(model, 120_000);
  await assert.rejects(
    () => service.run('file-id-1', async (assertLease) => {
      const record = model.records.get('file-id-1');
      record.ownerToken = 'another-host';
      await assertLease();
    }),
    (error) => error.getStatus() === 503,
  );
});

test('lease loss aborts the operation signal', async () => {
  const model = createLeaseModel();
  const service = new OperationLeaseService(model, 3000);
  let observedAbort = false;

  await service.run('file-id-1', async (_assertLease, signal) => {
    const record = model.records.get('file-id-1');
    record.ownerToken = 'another-host';
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    observedAbort = signal.aborted;
  });

  assert.equal(observedAbort, true);
});
