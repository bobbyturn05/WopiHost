import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'wopi_operation_leases' })
export class WopiOperationLease {
  @Prop({ required: true })
  bucket: string;

  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  ownerToken: string;

  @Prop({ required: true })
  expiresAt: Date;
}

export const WopiOperationLeaseSchema = SchemaFactory.createForClass(WopiOperationLease);
WopiOperationLeaseSchema.index({ bucket: 1, key: 1 }, { unique: true });
WopiOperationLeaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
