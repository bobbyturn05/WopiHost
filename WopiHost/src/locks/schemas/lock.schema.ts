import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LockDocument = HydratedDocument<WopiLock>;

@Schema({ collection: 'wopi_locks' })
export class WopiLock {
  @Prop({ required: true })
  bucket: string;

  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  lockId: string;

  @Prop({ required: true })
  expiresAt: Date;
}

export const WopiLockSchema = SchemaFactory.createForClass(WopiLock);

WopiLockSchema.index(
  { bucket: 1, key: 1 },
  { unique: true },
);

WopiLockSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);