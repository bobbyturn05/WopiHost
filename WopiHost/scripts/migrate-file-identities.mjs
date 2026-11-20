import { createHmac } from 'node:crypto';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');
const legacySecret = process.env.WOPI_FILE_ID_SECRET;
if (!legacySecret || legacySecret.length < 32) throw new Error('WOPI_FILE_ID_SECRET (the previous runtime value) is required for migration');

const connection = await mongoose.createConnection(uri).asPromise();

const getIdentity = async (db, bucket, key) => {
  let identity = await db.collection('wopi_file_identities').findOne({ bucket, key });
  if (identity) return identity.fileId;

  const fileId = createHmac('sha256', legacySecret).update(bucket, 'utf8').update('\0', 'utf8').update(key, 'utf8').digest('hex');
  try {
    await db.collection('wopi_file_identities').insertOne({ fileId, bucket, key, createdAt: new Date(), updatedAt: new Date() });
    return fileId;
  } catch (error) {
    if (error.code !== 11000) throw error;
    identity = await db.collection('wopi_file_identities').findOne({ bucket, key });
    if (!identity) throw error;
    return identity.fileId;
  }
};

try {
  const db = connection.db;
  if (!db) throw new Error('MongoDB connection has no database handle');
  const identities = db.collection('wopi_file_identities');
  await identities.createIndex({ fileId: 1 }, { unique: true, name: 'fileId_1' });
  await identities.createIndex({ bucket: 1, key: 1 }, { unique: true, name: 'bucket_1_key_1' });
  await identities.createIndex(
    { 'previousLocations.bucket': 1, 'previousLocations.key': 1 },
    { name: 'previous_location_lookup_1' },
  );

  for (const collectionName of ['wopi_tokens', 'wopi_locks', 'wopi_operation_leases']) {
    const collection = db.collection(collectionName);
    const locations = await collection.aggregate([
      { $match: { bucket: { $type: 'string' }, key: { $type: 'string' } } },
      { $group: { _id: { bucket: '$bucket', key: '$key' } } },
    ]).toArray();

    for (const location of locations) {
      const { bucket, key } = location._id;
      const fileId = await getIdentity(db, bucket, key);
      await collection.updateMany(
        { bucket, key },
        { $set: { fileId } },
      );
    }
  }

  const tokenIndexes = await db.collection('wopi_tokens').listIndexes().toArray();
  for (const index of tokenIndexes) {
    if (index.name === 'session_revocation_1' || (index.key?.bucket === 1 && index.key?.key === 1)) {
      await db.collection('wopi_tokens').dropIndex(index.name);
    }
  }
  const lockIndexes = await db.collection('wopi_locks').listIndexes().toArray();
  for (const index of lockIndexes) {
    if (index.name === 'bucket_1_key_1') await db.collection('wopi_locks').dropIndex(index.name);
  }
  const leaseIndexes = await db.collection('wopi_operation_leases').listIndexes().toArray();
  for (const index of leaseIndexes) {
    if (index.name === 'bucket_1_key_1') await db.collection('wopi_operation_leases').dropIndex(index.name);
  }

  for (const collectionName of ['wopi_tokens', 'wopi_locks', 'wopi_operation_leases']) {
    await db.collection(collectionName).updateMany(
      { fileId: { $exists: true } },
      { $unset: { bucket: '', key: '' } },
    );
  }

  await db.collection('wopi_tokens').createIndex({ fileId: 1, kind: 1, userId: 1 }, { name: 'file_session_revocation_1' });
  await db.collection('wopi_locks').createIndex({ fileId: 1 }, { unique: true, name: 'fileId_1' });
  await db.collection('wopi_operation_leases').createIndex({ fileId: 1 }, { unique: true, name: 'fileId_1' });
  process.stdout.write('WOPI file identities migrated. Review the deployment notes before starting the new version.\n');
} finally {
  await connection.close();
}
