import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TokenDocument = HydratedDocument<Token>;

@Schema({ timestamps: true, collection: 'wopi_tokens' })
export class Token {
  @Prop({ required: true, enum: ['launch', 'access'] })
  kind: 'launch' | 'access';

  @Prop({ required: true, unique: true, index: true })
  tokenHash: string;

  @Prop({ required: true, index: true })
  bucket: string;

  @Prop({ required: true, index: true })
  key: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, enum: ['view', 'edit'] })
  mode: 'view' | 'edit';

  @Prop({ required: true })
  fileId: string;

  @Prop({ required: true })
  filename: string;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;

  @Prop()
  etag?: string;

  @Prop()
  lastModified?: Date;

  @Prop()
  usedAt?: Date;

  @Prop({ required: true, index: { expires: 0 } })
  expiresAt: Date;
}

export const TokenSchema = SchemaFactory.createForClass(Token);