import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TokenDocument = HydratedDocument<Token>;

@Schema({ timestamps: true, collection: 'wopi_tokens' })
export class Token {
  @Prop({ required: true, enum: ['launch', 'access'] })
  kind: 'launch' | 'access';

  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ required: true })
  bucket: string;

  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, enum: ['view', 'edit'] })
  mode: 'view' | 'edit';

  @Prop({ required: true, index: { expires: 0 } })
  expiresAt: Date;
}

export const TokenSchema = SchemaFactory.createForClass(Token);
TokenSchema.index({ bucket: 1, key: 1, kind: 1, userId: 1 });
