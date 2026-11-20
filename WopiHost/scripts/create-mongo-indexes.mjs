import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');

const connection = await mongoose.createConnection(uri).asPromise();

try {
  const db = connection.db;
  if (!db) throw new Error('MongoDB connection has no database handle');

  await db.collection('wopi_tokens').createIndex(
    { tokenHash: 1 },
    { unique: true, name: 'tokenHash_1' },
  );
  await db.collection('wopi_tokens').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'expiresAt_1' },
  );
  await db.collection('wopi_tokens').createIndex(
    { bucket: 1, key: 1, kind: 1, userId: 1 },
    { name: 'session_revocation_1' },
  );
  await db.collection('wopi_locks').createIndex(
    { bucket: 1, key: 1 },
    { unique: true, name: 'bucket_1_key_1' },
  );
  await db.collection('wopi_locks').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'expiresAt_1' },
  );
  await db.collection('wopi_operation_leases').createIndex(
    { bucket: 1, key: 1 },
    { unique: true, name: 'bucket_1_key_1' },
  );
  await db.collection('wopi_operation_leases').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'expiresAt_1' },
  );

  process.stdout.write('WOPI MongoDB indexes are ready.\n');
} finally {
  await connection.close();
}
