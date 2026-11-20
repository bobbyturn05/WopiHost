const test = require('node:test');
const assert = require('node:assert/strict');
const { PresignService } = require('../dist/presign/presign.service');

const dto = {
  bucket: 'documents',
  key: 'slides/test.pptx',
  userId: 'user-1',
  mode: 'edit',
};

function createService({ size = 100, allowedBuckets = ['documents'] } = {}) {
  const calls = [];
  const minio = {
    async checkBucket(bucket) { calls.push(['checkBucket', bucket]); },
    async statObject(bucket, key) {
      calls.push(['statObject', bucket, key]);
      return { size };
    },
  };
  const tokens = {
    async create(value) {
      calls.push(['createToken', value]);
      return 'launch-token';
    },
  };
  const config = {
    getOrThrow(name) {
      return {
        'minio.allowedBuckets': allowedBuckets,
        'wopi.maxFileSizeBytes': 1000,
        'tokens.launchTtlSeconds': 120,
        'app.publicWopiOrigin': 'https://wopi.example.test',
      }[name];
    },
  };
  return { service: new PresignService(minio, tokens, config), calls };
}

test('presign validates bucket access and versioning before creating a launch token', async () => {
  const { service, calls } = createService();
  const result = await service.create(dto);

  assert.equal(result.launchUrl, 'https://wopi.example.test/launch/launch-token');
  assert.deepEqual(calls.slice(0, 2), [
    ['checkBucket', 'documents'],
    ['statObject', 'documents', 'slides/test.pptx'],
  ]);
  assert.equal(calls[2][0], 'createToken');
  assert.equal(calls[2][1].kind, 'launch');
  assert.equal(calls[2][1].mode, 'edit');
});

test('presign rejects buckets outside the configured allow-list', async () => {
  const { service, calls } = createService({ allowedBuckets: ['other'] });
  await assert.rejects(() => service.create(dto), (error) => error.getStatus() === 403);
  assert.deepEqual(calls, []);
});

test('presign rejects objects larger than the WOPI limit before creating a token', async () => {
  const { service, calls } = createService({ size: 1001 });
  await assert.rejects(() => service.create(dto), (error) => error.getStatus() === 413);
  assert.equal(calls.some(([name]) => name === 'createToken'), false);
});
