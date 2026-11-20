import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'wopi_file_identities', timestamps: true })
export class WopiFileIdentity {
  @Prop({ required: true })
  fileId: string;

  @Prop({ required: true })
  bucket: string;

  @Prop({ required: true })
  key: string;

  @Prop({ type: [{ bucket: String, key: String }], default: [] })
  previousLocations: Array<{ bucket: string; key: string }>;
}

export const WopiFileIdentitySchema = SchemaFactory.createForClass(WopiFileIdentity);
WopiFileIdentitySchema.index({ fileId: 1 }, { unique: true });
WopiFileIdentitySchema.index({ bucket: 1, key: 1 }, { unique: true });
WopiFileIdentitySchema.index(
  { 'previousLocations.bucket': 1, 'previousLocations.key': 1 },
  { name: 'previous_location_lookup_1' },
);
