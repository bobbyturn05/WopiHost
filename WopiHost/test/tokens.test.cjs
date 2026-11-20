const test = require('node:test');
const assert = require('node:assert/strict');
const { TokensService } = require('../dist/tokens/tokens.service');
const { hashToken } = require('../dist/common/crypto/token.util');

function createService() {
  const records = [];
  const matches = (record, query) => Object.entries(query).every(([key, value]) => {
    if (key === 'expiresAt') return record.expiresAt > value.$gt;
    if (key === 'kind' && value && value.$in) return value.$in.includes(record.kind);
    return record[key] === value;
  });
  const model = {
    async create(record) {
      records.push({ ...record });
      return record;
    },
    async findOne(query) {
      return records.find((record) => matches(record, query)) ?? null;
    },
    async findOneAndDelete(query) {
      const index = records.findIndex((record) => matches(record, query));
      if (index < 0) return null;
      return records.splice(index, 1)[0];
    },
    async deleteOne(query) {
      const index = records.findIndex((record) => matches(record, query));
      if (index < 0) return { deletedCount: 0 };
      records.splice(index, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query) {
      const matchesQuery = records.filter((record) => matches(record, query));
      for (const record of matchesQuery) records.splice(records.indexOf(record), 1);
      return { deletedCount: matchesQuery.length };
    },
  };
  return { service: new TokensService(model), records };
}

test('launch tokens are stored hashed and can only be consumed once', async () => {
  const { service, records } = createService();
  const rawToken = await service.create({
    kind: 'launch', bucket: 'documents', key: 'a.pptx', userId: 'u1', mode: 'view',
    expiresAt: new Date(Date.now() + 60_000),
  });

  assert.notEqual(records[0].tokenHash, rawToken);
  assert.equal(records[0].tokenHash, hashToken(rawToken));
  assert.equal((await service.consumeLaunchToken(rawToken)).key, 'a.pptx');
  await assert.rejects(() => service.consumeLaunchToken(rawToken), (error) => error.getStatus() === 401);
});

test('expired access tokens cannot be used', async () => {
  const { service } = createService();
  const rawToken = await service.create({
    kind: 'access', bucket: 'documents', key: 'a.pptx', userId: 'u1', mode: 'edit',
    expiresAt: new Date(Date.now() - 1000),
  });

  await assert.rejects(() => service.findAccessToken(rawToken), (error) => error.getStatus() === 401);
});

test('session revocation can target one user or every user on a document', async () => {
  const { service } = createService();
  const expiresAt = new Date(Date.now() + 60_000);
  await service.create({ kind: 'access', bucket: 'documents', key: 'a.pptx', userId: 'u1', mode: 'view', expiresAt });
  await service.create({ kind: 'launch', bucket: 'documents', key: 'a.pptx', userId: 'u2', mode: 'edit', expiresAt });
  await service.create({ kind: 'access', bucket: 'documents', key: 'b.pptx', userId: 'u1', mode: 'view', expiresAt });

  assert.equal(await service.revokeSessions('documents', 'a.pptx', 'u1'), 1);
  assert.equal(await service.revokeSessions('documents', 'a.pptx'), 1);
  assert.equal(await service.revokeSessions('documents', 'b.pptx'), 1);
});

test('malformed bearer tokens are rejected before database lookup', async () => {
  const { service } = createService();
  await assert.rejects(() => service.findAccessToken('not-a-valid-token'), (error) => error.getStatus() === 401);
  await assert.rejects(() => service.findLaunchToken('x'.repeat(10000)), (error) => error.getStatus() === 401);
});
