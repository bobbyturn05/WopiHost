const test = require('node:test');
const assert = require('node:assert/strict');
const { FileIdentitiesService } = require('../dist/file-identities/file-identities.service');

function createService() {
  const records = new Map();
  const model = {
    findOne(filter) {
      const record = [...records.values()].find((item) => {
        if (filter.fileId) return item.fileId === filter.fileId;
        if (filter.$or) return filter.$or.some((condition) => condition.bucket
          ? item.bucket === condition.bucket && item.key === condition.key
          : item.previousLocations?.some((location) => location.bucket === condition.previousLocations.$elemMatch.bucket && location.key === condition.previousLocations.$elemMatch.key));
        if (filter.previousLocations) return item.previousLocations?.some((location) => location.bucket === filter.previousLocations.$elemMatch.bucket && location.key === filter.previousLocations.$elemMatch.key);
        return item.bucket === filter.bucket && item.key === filter.key;
      });
      return { lean: async () => record ?? null };
    },
    async updateMany(filter, update) {
      for (const record of records.values()) {
        if (filter.previousLocations && update.$pull?.previousLocations) {
          record.previousLocations = record.previousLocations.filter((location) =>
            location.bucket !== update.$pull.previousLocations.bucket || location.key !== update.$pull.previousLocations.key);
        }
      }
      return { modifiedCount: 1 };
    },
    async create(value) {
      if ([...records.values()].some((item) => item.bucket === value.bucket && item.key === value.key)) {
        const error = new Error('duplicate'); error.code = 11000; throw error;
      }
      const record = { ...value, previousLocations: [], _id: value.fileId };
      records.set(value.fileId, record);
      return record;
    },
    async updateOne(filter, update) {
      const record = records.get(filter.fileId);
      if (!record || record.bucket !== filter.bucket || record.key !== filter.key) return { modifiedCount: 0 };
      if ([...records.values()].some((item) => item.fileId !== record.fileId && item.bucket === update.$set.bucket && item.key === update.$set.key)) {
        const error = new Error('duplicate'); error.code = 11000; throw error;
      }
      Object.assign(record, update.$set);
      if (update.$addToSet?.previousLocations && !record.previousLocations.some((item) => item.bucket === update.$addToSet.previousLocations.bucket && item.key === update.$addToSet.previousLocations.key)) record.previousLocations.push(update.$addToSet.previousLocations);
      return { modifiedCount: 1 };
    },
  };
  const minio = { async checkBucket() {}, async statObject() { return { size: 10, etag: 'same', contentType: 'application/octet-stream', metadata: {}, headers: {} }; }, async getObjectTags() { return {}; } };
  return { service: new FileIdentitiesService(model, minio), records };
}

test('file identity is persistent and reused for the same object location', async () => {
  const { service } = createService();
  const first = await service.getOrCreate('documents', 'a.pptx');
  const second = await service.getOrCreate('documents', 'a.pptx');
  assert.equal(first.fileId, second.fileId);
  assert.match(first.fileId, /^[a-f0-9]{64}$/);
});

test('moving an object changes its location without changing its file ID', async () => {
  const { service } = createService();
  const before = await service.getOrCreate('documents', 'a.pptx');
  await service.move('documents', 'a.pptx', 'archive', 'a.pptx');
  const after = await service.findByFileId(before.fileId);
  assert.equal(after.fileId, before.fileId);
  assert.equal(after.bucket, 'archive');
  assert.equal(after.key, 'a.pptx');
  await service.move('documents', 'a.pptx', 'archive', 'a.pptx');
  assert.equal((await service.findByLocation('documents', 'a.pptx')).fileId, before.fileId);
});

test('a replacement object at an old location receives a new file ID', async () => {
  const { service } = createService();
  const original = await service.getOrCreate('documents', 'a.pptx');
  await service.move('documents', 'a.pptx', 'archive', 'a.pptx');
  const replacement = await service.getOrCreate('documents', 'a.pptx');
  assert.notEqual(replacement.fileId, original.fileId);
  assert.equal((await service.findByLocation('documents', 'a.pptx')).fileId, replacement.fileId);
  assert.equal((await service.findByFileId(original.fileId)).previousLocations.length, 0);
});
