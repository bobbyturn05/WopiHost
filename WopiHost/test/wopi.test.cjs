const test = require('node:test');
const assert = require('node:assert/strict');
const { WopiService } = require('../dist/wopi/wopi.service');

const access = {
  fileId: 'c'.repeat(64),
  bucket: 'documents',
  key: 'slides/test.pptx',
  userId: 'user-1',
  mode: 'view',
};

function createService(size, maxSize = 10) {
  return new WopiService(
    {
      async statObject() {
        return {
          filename: 'test.pptx',
          size,
          contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          etag: '"etag"',
          metadata: {},
          headers: {},
        };
      },
    },
    {},
    { getOrThrow: () => maxSize },
  );
}

test('CheckFileInfo refuses objects that exceed the configured size limit', async () => {
  await assert.rejects(
    () => createService(11).checkFileInfo(access),
    (error) => error.getStatus() === 413,
  );
});

test('GetFile refuses objects that exceed the configured size limit', async () => {
  await assert.rejects(
    () => createService(11).getFile(access, 100),
    (error) => error.getStatus() === 413,
  );
});

test('PutFile uses the active lock, current ETag, preserved tags, and operation cancellation signal', async () => {
  const currentMetadata = {
    filename: 'test.pptx',
    size: 100,
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    etag: '"current-etag"',
    versionId: 'version-1',
    metadata: { ownerid: 'owner-1', custom: 'value' },
    headers: { cacheControl: 'private' },
  };
  const operationController = new AbortController();
  let lockArguments;
  let tagArguments;
  let writeArguments;
  let leaseAssertions = 0;
  const minio = {
    async statObject() { return currentMetadata; },
    async getObjectTags(...args) { tagArguments = args; return { category: 'presentation' }; },
    async putObject(...args) { writeArguments = args; return { versionId: 'version-2' }; },
  };
  const locks = {
    async withDocumentOperation(fileId, operation) {
      return operation(async () => { leaseAssertions += 1; }, operationController.signal);
    },
    async assertPutFileLock(...args) { lockArguments = args; },
  };
  const config = { getOrThrow: (key) => key === 'wopi.maxFileSizeBytes' ? 1000 : 1800 };
  const service = new WopiService(minio, locks, config);
  const content = Buffer.from('updated presentation');

  const result = await service.putFile({ ...access, mode: 'edit' }, content, 'active-lock');

  assert.equal(result.Version, 'version-2');
  assert.deepEqual(lockArguments, ['c'.repeat(64), 'documents', 'slides/test.pptx', 'active-lock', 100]);
  assert.deepEqual(tagArguments, ['documents', 'slides/test.pptx', 'version-1']);
  assert.equal(writeArguments[2], content);
  assert.equal(writeArguments[4].ownerid, 'owner-1');
  assert.equal(writeArguments[4].custom, 'value');
  assert.ok(writeArguments[4]['wopi-revision']);
  assert.deepEqual(writeArguments[6], { category: 'presentation' });
  assert.equal(writeArguments[7], '"current-etag"');
  assert.equal(writeArguments[8], operationController.signal);
  assert.equal(leaseAssertions, 4);
});

test('CheckFileInfo keeps the supplied UserId and advertises only implemented capabilities', async () => {
  const service = createService(10, 10);
  const info = await service.checkFileInfo(access);

  assert.equal(info.UserId, 'user-1');
  assert.equal(info.UserCanWrite, false);
  assert.equal(info.ReadOnly, true);
  assert.equal(info.SupportsLocks, true);
  assert.equal(info.SupportsGetLock, true);
  assert.equal(info.SupportsExtendedLockLength, true);
  assert.equal(info.UserCanNotWriteRelative, true);
});

test('GetFile requests the exact MinIO version observed by CheckFileInfo', async () => {
  let getArguments;
  const metadata = {
    filename: 'test.pptx',
    size: 10,
    contentType: 'application/octet-stream',
    etag: '"etag"',
    versionId: 'version-7',
    metadata: {},
    headers: {},
  };
  const stream = {};
  const minio = {
    async statObject() { return metadata; },
    async getObject(...args) { getArguments = args; return stream; },
  };
  const service = new WopiService(minio, {}, { getOrThrow: () => 10 });

  const result = await service.getFile(access, 10);

  assert.deepEqual(getArguments, ['documents', 'slides/test.pptx', 'version-7', '"etag"']);
  assert.equal(result.stream, stream);
  assert.equal(result.size, 10);
});


test('PutFile reconciles an ambiguous MinIO response when the revision was committed', async () => {
  let revision;
  let statCalls = 0;
  const minio = {
    async statObject() {
      statCalls += 1;
      return {
        filename: 'test.pptx', size: 100, contentType: 'application/octet-stream', etag: 'etag-1',
        metadata: statCalls === 1 ? {} : { 'wopi-revision': revision },
        headers: {}, versionId: statCalls === 1 ? 'version-1' : 'version-committed',
      };
    },
    async getObjectTags() { return {}; },
    async putObject(_bucket, _key, _content, _type, metadata) {
      revision = metadata['wopi-revision'];
      throw new Error('connection reset after MinIO committed the write');
    },
  };
  const locks = {
    async withDocumentOperation(_fileId, operation) { return operation(async () => undefined, new AbortController().signal); },
    async assertPutFileLock() {},
    async getLock() { return 'active-lock'; },
  };
  const service = new WopiService(minio, locks, { getOrThrow: () => 1000 });
  const result = await service.putFile({ ...access, mode: 'edit' }, Buffer.from('saved'), 'active-lock');
  assert.equal(result.Version, 'version-committed');
  assert.equal(statCalls, 2);
});


test('PutFile treats a retried save with the already-committed content hash as successful without another write', async () => {
  const content = Buffer.from('same saved bytes');
  const contentHash = require('node:crypto').createHash('sha256').update(content).digest('hex');
  let writes = 0;
  const minio = {
    async statObject() {
      return {
        filename: 'test.pptx', size: content.length, contentType: 'application/octet-stream',
        etag: 'etag-after-save', versionId: 'version-already-saved',
        metadata: { 'wopi-content-sha256': contentHash }, headers: {},
      };
    },
    async getObjectTags() { return {}; },
    async putObject() { writes += 1; return { versionId: 'unexpected' }; },
  };
  const locks = {
    async withDocumentOperation(_fileId, operation) { return operation(async () => undefined, new AbortController().signal); },
    async assertPutFileLock() {},
  };
  const service = new WopiService(minio, locks, { getOrThrow: () => 1000 });
  const result = await service.putFile({ ...access, mode: 'edit' }, content, 'active-lock');
  assert.equal(result.Version, 'version-already-saved');
  assert.equal(writes, 0);
});
