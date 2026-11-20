const test = require('node:test');
const assert = require('node:assert/strict');
const { generateToken, hashToken } = require('../dist/common/crypto/token.util');
const { createWopiFileId } = require('../dist/common/crypto/file-id.util');

test('launch/access tokens are random URL-safe bearer values', () => {
  const first = generateToken();
  const second = generateToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test('token hashes are deterministic and do not equal the bearer token', () => {
  const token = generateToken();
  const hash = hashToken(token);

  assert.equal(hash, hashToken(token));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
});

test('WOPI file IDs are stable and bind both bucket and key', () => {
  const secret = 'test-secret-with-at-least-32-characters';
  const id = createWopiFileId('documents', 'slides/123.pptx', secret);

  assert.equal(id, createWopiFileId('documents', 'slides/123.pptx', secret));
  assert.notEqual(id, createWopiFileId('other', 'slides/123.pptx', secret));
  assert.notEqual(id, createWopiFileId('documents', 'slides/124.pptx', secret));
});
