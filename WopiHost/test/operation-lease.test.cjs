const test = require('node:test');
const assert = require('node:assert/strict');
const { OperationLeaseService } = require('../dist/locks/operation-lease.service');

function createLeaseModel() {
  const records = new Map();
  const keyOf = (bucket, key) => `${bucket}\0${key}`;
  return {
    records,
    findOneAndUpdate(filter, update) {
      const key = keyOf(filter.bucket, filter.key);
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
      const record = records.get(keyOf(filter.bucket, filter.key));
      if (!record || record.ownerToken !== filter.ownerToken || record.expiresAt <= filter.expiresAt.$gt) {
        return { matchedCount: 0 };
      }
      record.expiresAt = update.$set.expiresAt;
      return { matchedCount: 1 };
    },
    async deleteOne(filter) {
      const key = keyOf(filter.bucket, filter.key);
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
  const firstOperation = firstHost.run('documents', 'a.pptx', async () => waiting);

  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => secondHost.run('documents', 'a.pptx', async () => undefined),
    (error) => error.getStatus() === 503,
  );

  release();
  await firstOperation;
  await assert.doesNotReject(() => secondHost.run('documents', 'a.pptx', async () => undefined));
});

test('an operation cannot continue after its lease has been replaced', async () => {
  const model = createLeaseModel();
  const service = new OperationLeaseService(model, 120_000);
  await assert.rejects(
    () => service.run('documents', 'a.pptx', async (assertLease) => {
      const record = model.records.get('documents\0a.pptx');
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

  await service.run('documents', 'a.pptx', async (_assertLease, signal) => {
    const record = model.records.get('documents\0a.pptx');
    record.ownerToken = 'another-host';
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    observedAbort = signal.aborted;
  });

  assert.equal(observedAbort, true);
});
