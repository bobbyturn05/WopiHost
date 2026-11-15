import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WopiLock, WopiLockSchema } from './schemas/lock.schema';
import { LocksService } from './locks.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WopiLock.name, schema: WopiLockSchema },
    ]),
  ],
  providers: [LocksService],
  exports: [LocksService],
})
export class LocksModule {}