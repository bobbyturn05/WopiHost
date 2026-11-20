const test = require('node:test');
const assert = require('node:assert/strict');
const { HealthController } = require('../dist/health/health.controller');

function createHealthController({ databaseReady = true, databasePingFails = false, indexesMissing = false, discoveryReady = true, storageFails = false } = {}) {
  const calls = [];
  const indexDefinitions = {
    wopi_tokens: [
      { name: '_id_' },
      { name: 'tokenHash_1', unique: true, key: { tokenHash: 1 } },
      { name: 'expiresAt_1', expireAfterSeconds: 0, key: { expiresAt: 1 } },
      { name: 'file_session_revocation_1', key: { fileId: 1, kind: 1, userId: 1 } },
    ],
    wopi_locks: [
      { name: '_id_' },
      { name: 'fileId_1', unique: true, key: { fileId: 1 } },
      { name: 'expiresAt_1', expireAfterSeconds: 0, key: { expiresAt: 1 } },
    ],
    wopi_operation_leases: [
      { name: '_id_' },
      { name: 'fileId_1', unique: true, key: { fileId: 1 } },
      { name: 'expiresAt_1', expireAfterSeconds: 0, key: { expiresAt: 1 } },
    ],
    wopi_file_identities: [
      { name: '_id_' },
      { name: 'fileId_1', unique: true, key: { fileId: 1 } },
      { name: 'bucket_1_key_1', unique: true, key: { bucket: 1, key: 1 } },
      { name: 'previous_location_lookup_1', key: { 'previousLocations.bucket': 1, 'previousLocations.key': 1 } },
    ],
  };
  const controller = new HealthController(
    {
      readyState: databaseReady ? 1 : 0,
      db: databaseReady ? {
        command: async () => {
          if (databasePingFails) throw new Error('database unavailable');
          return { ok: 1 };
        },
        collection: (name) => ({
          listIndexes: () => ({
            toArray: async () => indexesMissing ? [] : indexDefinitions[name],
          }),
        }),
      } : undefined,
    },
    {
      async checkBucket(bucket) {
        calls.push(bucket);
        if (storageFails) throw new Error('storage unavailable');
      },
    },
    { isReady: discoveryReady },
    { get: () => ['documents', 'presentations'] },
  );
  return { controller, calls };
}

test('readiness succeeds when MongoDB, discovery, and MinIO are ready', async () => {
  const { controller, calls } = createHealthController();

  assert.deepEqual(await controller.ready(), { status: 'ok' });
  assert.deepEqual(calls, ['documents', 'presentations']);
});

test('readiness fails when a required dependency is unavailable', async () => {
  const { controller } = createHealthController({ storageFails: true });

  await assert.rejects(() => controller.ready(), (error) => error.getStatus() === 503);
});

test('liveness does not depend on external services', () => {
  const { controller } = createHealthController({ databaseReady: false, discoveryReady: false, storageFails: true });

  assert.deepEqual(controller.live(), { status: 'ok' });
});

test('readiness fails when the MongoDB connection is marked ready but ping fails', async () => {
  const { controller } = createHealthController({ databasePingFails: true });
  await assert.rejects(() => controller.ready(), (error) => error.getStatus() === 503);
});

test('readiness fails when required MongoDB indexes are missing', async () => {
  const { controller } = createHealthController({ indexesMissing: true });
  await assert.rejects(() => controller.ready(), (error) => error.getStatus() === 503);
});
