const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { ProofKeyService } = require('../dist/common/crypto/proof-key.service');

const DOTNET_UNIX_EPOCH_TICKS = 621355968000000000n;
const TICKS_PER_MILLISECOND = 10000n;

function createKey() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  return {
    privateKey: pair.privateKey,
    publicKey: {
      modulus: Buffer.from(jwk.n, 'base64url').toString('base64'),
      exponent: Buffer.from(jwk.e, 'base64url').toString('base64'),
    },
  };
}

function createPayload(token, originalUrl, timestamp) {
  const tokenBytes = Buffer.from(token, 'utf8');
  const urlBytes = Buffer.from(`https://wopi.example.test${originalUrl}`.toUpperCase(), 'utf8');
  const timestampBytes = Buffer.alloc(8);
  timestampBytes.writeBigUInt64BE(timestamp);
  const length = (buffer) => {
    const result = Buffer.alloc(4);
    result.writeUInt32BE(buffer.length);
    return result;
  };
  return Buffer.concat([
    length(tokenBytes), tokenBytes,
    length(urlBytes), urlBytes,
    length(timestampBytes), timestampBytes,
  ]);
}

function createService(current, old) {
  const discovery = {
    getProofKeys: () => ({ current, old }),
    refresh: async () => undefined,
  };
  const config = { getOrThrow: () => 'https://wopi.example.test' };
  return new ProofKeyService(discovery, config);
}

function createRequest(token, timestamp, proof, proofOld) {
  return {
    originalUrl: `/wopi/files/file-id?access_token=${token}`,
    headers: {
      'x-wopi-timestamp': timestamp.toString(),
      'x-wopi-proof': proof,
      ...(proofOld ? { 'x-wopi-proofold': proofOld } : {}),
    },
  };
}

function signProof(privateKey, payload) {
  return sign('sha256', payload, privateKey).toString('base64');
}

test('accepts X-WOPI-Proof signed by the current key', () => {
  const current = createKey();
  const old = createKey();
  const service = createService(current.publicKey, old.publicKey);
  const token = 'test-access-token';
  const originalUrl = `/wopi/files/file-id?access_token=${token}`;
  const timestamp = DOTNET_UNIX_EPOCH_TICKS + BigInt(Date.now()) * TICKS_PER_MILLISECOND;
  const payload = createPayload(token, originalUrl, timestamp);

  assert.doesNotThrow(() => service.verifyRequest(
    createRequest(token, timestamp, signProof(current.privateKey, payload)),
    token,
  ));
});

test('accepts X-WOPI-ProofOld signed by the current key during rotation', () => {
  const current = createKey();
  const old = createKey();
  const service = createService(current.publicKey, old.publicKey);
  const token = 'test-access-token';
  const originalUrl = `/wopi/files/file-id?access_token=${token}`;
  const timestamp = DOTNET_UNIX_EPOCH_TICKS + BigInt(Date.now()) * TICKS_PER_MILLISECOND;
  const payload = createPayload(token, originalUrl, timestamp);

  assert.doesNotThrow(() => service.verifyRequest(
    createRequest(token, timestamp, 'invalid-proof', signProof(current.privateKey, payload)),
    token,
  ));
});

test('accepts X-WOPI-Proof signed by the old key during rotation', () => {
  const current = createKey();
  const old = createKey();
  const service = createService(current.publicKey, old.publicKey);
  const token = 'test-access-token';
  const originalUrl = `/wopi/files/file-id?access_token=${token}`;
  const timestamp = DOTNET_UNIX_EPOCH_TICKS + BigInt(Date.now()) * TICKS_PER_MILLISECOND;
  const payload = createPayload(token, originalUrl, timestamp);

  assert.doesNotThrow(() => service.verifyRequest(
    createRequest(token, timestamp, signProof(old.privateKey, payload)),
    token,
  ));
});

test('rejects X-WOPI-ProofOld signed only by the old key', () => {
  const current = createKey();
  const old = createKey();
  const service = createService(current.publicKey, old.publicKey);
  const token = 'test-access-token';
  const originalUrl = `/wopi/files/file-id?access_token=${token}`;
  const timestamp = DOTNET_UNIX_EPOCH_TICKS + BigInt(Date.now()) * TICKS_PER_MILLISECOND;
  const payload = createPayload(token, originalUrl, timestamp);

  assert.throws(() => service.verifyRequest(
    createRequest(token, timestamp, 'invalid-proof', signProof(old.privateKey, payload)),
    token,
  ), (error) => error.getStatus() === 500);
});

test('rejects a proof timestamp older than twenty minutes', () => {
  const current = createKey();
  const service = createService(current.publicKey, undefined);
  const token = 'test-access-token';
  const originalUrl = `/wopi/files/file-id?access_token=${token}`;
  const timestamp = DOTNET_UNIX_EPOCH_TICKS + BigInt(Date.now() - 21 * 60 * 1000) * TICKS_PER_MILLISECOND;
  const payload = createPayload(token, originalUrl, timestamp);

  assert.throws(() => service.verifyRequest(
    createRequest(token, timestamp, signProof(current.privateKey, payload)),
    token,
  ), (error) => error.getStatus() === 500);
});
