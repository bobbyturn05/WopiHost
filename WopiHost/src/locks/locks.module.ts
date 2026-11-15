import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { WopiLock, WopiLockSchema } from './schemas/lock.schema';
import { WopiOperationLease, WopiOperationLeaseSchema } from './schemas/operation-lease.schema';
import { LocksService } from './locks.service';
import { OperationLeaseService } from './operation-lease.service';
import { WOPI_LOCK_TTL_MS, WOPI_OPERATION_LEASE_TTL_MS } from './consts';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WopiLock.name, schema: WopiLockSchema },
      { name: WopiOperationLease.name, schema: WopiOperationLeaseSchema },
    ]),
  ],
  providers: [
    {
      provide: WOPI_LOCK_TTL_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow<number>('wopi.lockTtlSeconds') * 1000,
    },
    {
      provide: WOPI_OPERATION_LEASE_TTL_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow<number>('wopi.operationLeaseTtlSeconds') * 1000,
    },
    OperationLeaseService,
    LocksService,
  ],
  exports: [LocksService],
})
export class LocksModule {}
