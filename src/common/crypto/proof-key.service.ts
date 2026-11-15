import {
  createPublicKey,
  JsonWebKey,
  verify
} from 'crypto';
import {
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

import { DiscoveryService, OfficeProofKey } from '../../discovery/discovery.service';

@Injectable()
export class ProofKeyService {
  private readonly publicOrigin: string;

  constructor(
    private readonly discovery: DiscoveryService,
    config: ConfigService
  ) {
    this.publicOrigin = config
      .getOrThrow<string>('app.publicWopiOrigin')
      .replace(/\/+$/, '');
  }

  verifyRequest(request: Request, accessToken: string): void {
    const proof = this.header(request, 'x-wopi-proof');
    const proofOld = this.header(request, 'x-wopi-proofold');
    const timestampHeader = this.header(request, 'x-wopi-timestamp');

    if (!proof || !timestampHeader) {
      throw new UnauthorizedException('Missing WOPI proof headers');
    }

    const timestamp = this.parseTimestamp(timestampHeader);
    const payload = this.createPayload(request, accessToken, timestamp);
    const keys = this.discovery.getProofKeys();

    const currentValid =
      !!keys.current && this.verifySignature(proof, payload, keys.current);

    const oldValid =
      !!proofOld &&
      !!keys.old &&
      this.verifySignature(proofOld, payload, keys.old);

    if (!currentValid && !oldValid) {
      throw new UnauthorizedException('WOPI proof validation failed');
    }
  }

  private createPayload(
    request: Request,
    accessToken: string,
    timestamp: bigint
  ): Buffer {
    const url = new URL(
      `${this.publicOrigin}${request.originalUrl}`,
      this.publicOrigin
    );

    url.searchParams.delete('access_token');

    const canonicalUrl = Buffer.from(url.toString().toLowerCase(), 'utf8');
    const tokenBuffer = Buffer.from(accessToken, 'utf8');
    const timestampBuffer = Buffer.alloc(8);

    timestampBuffer.writeBigUInt64LE(timestamp);

    return Buffer.concat([
      this.withLength(tokenBuffer),
      this.withLength(canonicalUrl),
      this.withLength(timestampBuffer)
    ]);
  }

  private withLength(value: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(value.length);

    return Buffer.concat([length, value]);
  }

  private verifySignature(
    signature: string,
    payload: Buffer,
    key: OfficeProofKey
  ): boolean {
    try {
      const jwk: JsonWebKey = {
        kty: 'RSA',
        n: key.modulus,
        e: key.exponent
      };

      const publicKey = createPublicKey({
        key: jwk,
        format: 'jwk'
      });

      return verify(
        'RSA-SHA256',
        payload,
        publicKey,
        Buffer.from(signature, 'base64')
      );
    } catch {
      return false;
    }
  }

  private parseTimestamp(value: string): bigint {
    if (!/^\d+$/.test(value)) {
      throw new UnauthorizedException('Invalid WOPI timestamp');
    }

    const timestamp = BigInt(value);
    const now = BigInt(Date.now());
    const allowedDifference = 20n * 60n * 1000n;

    if (
      timestamp > now + allowedDifference ||
      timestamp < now - allowedDifference
    ) {
      throw new UnauthorizedException('WOPI proof timestamp is outside the allowed window');
    }

    return timestamp;
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];

    if (Array.isArray(value)) {
      return value[0];
    }

    return value;
  }
}