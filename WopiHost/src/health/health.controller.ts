import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService } from '../discovery/discovery.service';
import { MinioService } from '../storage/minio.service';

@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly minio: MinioService,
    private readonly discovery: DiscoveryService,
    private readonly config: ConfigService,
  ) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    let databaseReady = false;
    if (this.connection.readyState === 1 && this.connection.db) {
      try {
        const result = await this.connection.db.command({ ping: 1 }, { maxTimeMS: 2000 });
        databaseReady = result.ok === 1;
      } catch {
        databaseReady = false;
      }
    }
    const indexesReady = databaseReady ? await this.hasRequiredIndexes() : false;
    const discoveryReady = this.discovery.isReady;
    const buckets = this.config.get<string[]>('minio.allowedBuckets', []);
    let storageReady = buckets.length > 0;
    if (storageReady) {
      const checks = await Promise.allSettled(buckets.map((bucket) => this.minio.checkBucket(bucket)));
      storageReady = checks.every((result) => result.status === 'fulfilled');
    }

    if (!databaseReady || !indexesReady || !discoveryReady || !storageReady) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        dependencies: {
          database: databaseReady ? 'ok' : 'unavailable',
          indexes: indexesReady ? 'ok' : 'missing_or_invalid',
          discovery: discoveryReady ? 'ok' : 'unavailable',
          storage: storageReady ? 'ok' : 'unavailable',
        },
      });
    }

    return { status: 'ok' };
  }

  private async hasRequiredIndexes(): Promise<boolean> {
    const db = this.connection.db;
    if (!db) return false;

    try {
      const [tokenIndexes, lockIndexes, leaseIndexes, identityIndexes] = await Promise.all([
        db.collection('wopi_tokens').listIndexes().toArray(),
        db.collection('wopi_locks').listIndexes().toArray(),
        db.collection('wopi_operation_leases').listIndexes().toArray(),
        db.collection('wopi_file_identities').listIndexes().toArray(),
      ]);

      const tokenHash = tokenIndexes.find((index) => index.name === 'tokenHash_1');
      const tokenExpiry = tokenIndexes.find((index) => index.name === 'expiresAt_1');
      const sessionRevocation = tokenIndexes.find((index) => index.name === 'file_session_revocation_1');
      const lockIdentity = lockIndexes.find((index) => index.name === 'fileId_1');
      const lockExpiry = lockIndexes.find((index) => index.name === 'expiresAt_1');
      const leaseIdentity = leaseIndexes.find((index) => index.name === 'fileId_1');
      const leaseExpiry = leaseIndexes.find((index) => index.name === 'expiresAt_1');
      const identityId = identityIndexes.find((index) => index.name === 'fileId_1');
      const identityLocation = identityIndexes.find((index) => index.name === 'bucket_1_key_1');
      const previousLocationLookup = identityIndexes.find((index) => index.name === 'previous_location_lookup_1');

      return tokenHash?.unique === true && tokenHash.key?.tokenHash === 1 &&
        tokenExpiry?.expireAfterSeconds === 0 && tokenExpiry.key?.expiresAt === 1 &&
        sessionRevocation?.key?.fileId === 1 && sessionRevocation.key?.kind === 1 && sessionRevocation.key?.userId === 1 &&
        lockIdentity?.unique === true && lockIdentity.key?.fileId === 1 &&
        lockExpiry?.expireAfterSeconds === 0 && lockExpiry.key?.expiresAt === 1 &&
        leaseIdentity?.unique === true && leaseIdentity.key?.fileId === 1 &&
        leaseExpiry?.expireAfterSeconds === 0 && leaseExpiry.key?.expiresAt === 1 &&
        identityId?.unique === true && identityId.key?.fileId === 1 &&
        identityLocation?.unique === true && identityLocation.key?.bucket === 1 && identityLocation.key?.key === 1 &&
        previousLocationLookup?.key?.['previousLocations.bucket'] === 1 && previousLocationLookup.key?.['previousLocations.key'] === 1;
    } catch {
      return false;
    }
  }
}
