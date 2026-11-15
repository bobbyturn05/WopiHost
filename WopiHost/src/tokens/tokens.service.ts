import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { generateToken, hashToken } from '../common/crypto/token.util';
import { Model } from 'mongoose';
import { Token, TokenDocument } from './schemas/token.schema';

export interface CreateTokenInput {
  kind: 'launch' | 'access';
  bucket: string;
  key: string;
  userId: string;
  mode: 'view' | 'edit';
  fileId: string;
  filename: string;
  contentType: string;
  size: number;
  etag?: string;
  lastModified?: Date;
  expiresAt: Date;
}

@Injectable()
export class TokensService {
  constructor(
    @InjectModel(Token.name)
    private readonly tokenModel: Model<Token>,
  ) {}

  async create(input: CreateTokenInput): Promise<string> {
    const token = generateToken();

    await this.tokenModel.create({
      ...input,
      tokenHash: hashToken(token),
    });

    return token;
  }

  async findAccessToken(
    rawToken: string,
    fileId: string,
  ): Promise<TokenDocument> {
    const token = await this.tokenModel.findOne({
      kind: 'access',
      tokenHash: hashToken(rawToken),
      fileId,
      expiresAt: { $gt: new Date() },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid or expired WOPI token');
    }

    return token;
  }

  async findLaunchToken(rawToken: string): Promise<TokenDocument> {
    const token = await this.tokenModel.findOne({
      kind: 'launch',
      tokenHash: hashToken(rawToken),
      expiresAt: { $gt: new Date() },
      usedAt: null,
    });

    if (!token) {
      throw new UnauthorizedException('Invalid or already-used launch token');
    }

    return token;
  }

  async revokeAccessToken(rawToken: string, fileId: string): Promise<void> {
    await this.tokenModel.deleteOne({
      kind: 'access',
      tokenHash: hashToken(rawToken),
      fileId,
    });
  }

  async consumeLaunchToken(
    rawToken: string,
  ): Promise<TokenDocument> {
    const token = await this.tokenModel.findOneAndUpdate(
      {
        kind: 'launch',
        tokenHash: hashToken(rawToken),
        expiresAt: { $gt: new Date() },
        usedAt: null,
      },
      {
        $set: { usedAt: new Date() },
      },
      { new: true },
    );

    if (!token) {
      throw new UnauthorizedException('Invalid or already-used launch token');
    }

    return token;
  }

}