import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { generateToken, hashToken } from '../common/crypto/token.util';
import { Token, TokenDocument } from './schemas/token.schema';

export interface CreateTokenInput {
  kind: 'launch' | 'access';
  bucket: string;
  key: string;
  userId: string;
  mode: 'view' | 'edit';
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

  async findAccessToken(rawToken: string): Promise<TokenDocument> {
    this.assertTokenFormat(rawToken);
    const token = await this.tokenModel.findOne({
      kind: 'access',
      tokenHash: hashToken(rawToken),
      expiresAt: { $gt: new Date() },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid or expired WOPI token');
    }

    return token;
  }

  async findLaunchToken(rawToken: string): Promise<TokenDocument> {
    this.assertTokenFormat(rawToken);
    const token = await this.tokenModel.findOne({
      kind: 'launch',
      tokenHash: hashToken(rawToken),
      expiresAt: { $gt: new Date() },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid or expired launch token');
    }

    return token;
  }

  async consumeLaunchToken(rawToken: string): Promise<TokenDocument> {
    this.assertTokenFormat(rawToken);
    const token = await this.tokenModel.findOneAndDelete({
      kind: 'launch',
      tokenHash: hashToken(rawToken),
      expiresAt: { $gt: new Date() },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid or already-used launch token');
    }

    return token;
  }

  async revokeAccessToken(rawToken: string): Promise<void> {
    await this.tokenModel.deleteOne({
      kind: 'access',
      tokenHash: hashToken(rawToken),
    });
  }

  private assertTokenFormat(rawToken: string): void {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
      throw new UnauthorizedException('Invalid or expired WOPI token');
    }
  }

  async revokeSessions(bucket: string, key: string, userId?: string): Promise<number> {
    const result = await this.tokenModel.deleteMany({
      kind: { $in: ['launch', 'access'] },
      bucket,
      key,
      ...(userId ? { userId } : {}),
    });

    return result.deletedCount;
  }
}
