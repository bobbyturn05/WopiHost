const test = require('node:test');
const assert = require('node:assert/strict');
const { LaunchService } = require('../dist/launch/launch.service');

function createService({ consumeFails = false } = {}) {
  const calls = [];
  const tokens = {
    async findLaunchToken(token) {
      calls.push(['findLaunchToken', token]);
      return { fileId: 'a'.repeat(64), userId: 'user-1', mode: 'view' };
    },
    async create(value) {
      calls.push(['create', value]);
      return 'access-token';
    },
    async consumeLaunchToken(token) {
      calls.push(['consumeLaunchToken', token]);
      if (consumeFails) throw new Error('already consumed');
    },
    async revokeAccessToken(token) {
      calls.push(['revokeAccessToken', token]);
    },
  };
  const discovery = {
    getActionUrl(extension, mode) {
      calls.push(['getActionUrl', extension, mode]);
      return 'https://office.example.test/embed?one=1&two=2';
    },
  };
  const identities = { async findByFileId(fileId) { calls.push(['findByFileId', fileId]); return { bucket: 'documents', key: 'slides/test.pptx' }; } };
  const minio = {
    async statObject(bucket, key) {
      calls.push(['statObject', bucket, key]);
      return { filename: 'test.pptx', size: 100 };
    },
  };
  const config = {
    getOrThrow(name) {
      return {
        'wopi.maxFileSizeBytes': 1000,
        'tokens.accessTtlSeconds': 28800,
        'app.publicWopiOrigin': 'https://wopi.example.test',
      }[name];
    },
  };
  return { service: new LaunchService(tokens, discovery, minio, identities, config), calls };
}

test('launch creates an escaped Office form and consumes the launch token once', async () => {
  const { service, calls } = createService();
  const result = await service.createOfficeLaunch('launch-token', { wdFoo: 'bar', wdPreviousSession: 'old' });

  assert.match(result.contentSecurityPolicy, /form-action https:\/\/office\.example\.test/);
  assert.match(result.html, /action="https:\/\/office\.example\.test\/embed\?one=1&amp;two=2&amp;wdFoo=bar&amp;wdPreviousSession=old"/);
  assert.match(result.html, /name="access_token" value="access-token"/);
  assert.match(result.html, /wdFoo=bar/);
  assert.match(result.html, /wdPreviousSession/);
  assert.match(result.html, /url\.searchParams\.delete\('wdPreviousSession'\)/);
  assert.match(result.html, /url\.searchParams\.delete\('wdPreviousCorrelation'\)/);
  assert.match(result.html, /name="WOPISrc" value="https:\/\/wopi\.example\.test\/wopi\/files\/a{64}"/);
  assert.equal(calls.some(([name]) => name === 'consumeLaunchToken'), true);
});

test('launch revokes the new access token if single-use redemption fails', async () => {
  const { service, calls } = createService({ consumeFails: true });
  await assert.rejects(() => service.createOfficeLaunch('launch-token'));
  assert.deepEqual(calls.slice(-2), [
    ['consumeLaunchToken', 'launch-token'],
    ['revokeAccessToken', 'access-token'],
  ]);
});
