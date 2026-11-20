const test = require('node:test');
const assert = require('node:assert/strict');
const { MinioService } = require('../dist/storage/minio.service');

function createService(versioningStatus = 'Enabled') {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command.constructor.name);
      if (command.constructor.name === 'GetBucketVersioningCommand') {
        return { Status: versioningStatus };
      }
      return {};
    },
    destroy() {},
  };
  return { service: new MinioService(client), commands };
}

test('bucket readiness requires versioning to be enabled', async () => {
  const { service, commands } = createService();
  await service.checkBucket('documents');
  assert.deepEqual(commands, ['HeadBucketCommand', 'GetBucketVersioningCommand']);
});

test('bucket readiness rejects suspended or unconfigured versioning', async () => {
  const { service } = createService('Suspended');
  await assert.rejects(() => service.checkBucket('documents'), /versioning enabled/);
});

test('PutObject uses the current ETag as a conditional-write guard', async () => {
  let command;
  let sendOptions;
  const client = {
    async send(value, options) {
      if (value.constructor.name === 'GetBucketVersioningCommand') return { Status: 'Enabled' };
      if (value.constructor.name === 'HeadBucketCommand') return {};
      command = value;
      sendOptions = options;
      return { VersionId: 'version-2', ETag: '"new-etag"' };
    },
    destroy() {},
  };
  const service = new MinioService(client);

  const operationController = new AbortController();
  const result = await service.putObject(
    'documents',
    'slides/test.pptx',
    Buffer.from('new document'),
    'application/octet-stream',
    {},
    {},
    {},
    '"old-etag"',
    operationController.signal,
  );

  assert.equal(sendOptions.abortSignal.aborted, false);
  assert.equal(command.input.IfMatch, '"old-etag"');
  assert.equal(command.input.ContentMD5, require('node:crypto').createHash('md5').update(Buffer.from('new document')).digest('base64'));
  assert.equal(result.versionId, 'version-2');
});

test('PutObject fails safely when a conditional write detects a concurrent update', async () => {
  const client = {
    async send(command) {
      if (command.constructor.name === 'GetBucketVersioningCommand') return { Status: 'Enabled' };
      if (command.constructor.name === 'HeadBucketCommand') return {};
      const error = new Error('Precondition failed');
      error.name = 'PreconditionFailed';
      error.$metadata = { httpStatusCode: 412 };
      throw error;
    },
    destroy() {},
  };
  const service = new MinioService(client);

  await assert.rejects(
    () => service.putObject('documents', 'slides/test.pptx', Buffer.from('x'), 'application/octet-stream', {}, {}, {}, '"etag"'),
    (error) => error.getStatus() === 409,
  );
});


test('MinIO network timeouts are reported as retryable service-unavailable errors', async () => {
  const client = {
    async send() { const error = new Error('socket timed out'); error.code = 'ETIMEDOUT'; throw error; },
    destroy() {},
  };
  const service = new MinioService(client);
  await assert.rejects(
    () => service.statObject('documents', 'slides/test.pptx'),
    (error) => error.getStatus() === 503,
  );
});
