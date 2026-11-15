import { createPublicKey, verify, type JsonWebKey } from 'crypto';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { DiscoveryService } from '../../discovery/discovery.service';
import type { OfficeProofKey } from '../../discovery/discovery.service';

const DOTNET_UNIX_EPOCH_TICKS = 621355968000000000n;
const TICKS_PER_MILLISECOND = 10000n;
const MAX_CLOCK_SKEW_TICKS = 20n * 60n * 1000n * TICKS_PER_MILLISECOND;

@Injectable()
export class ProofKeyService {
  private readonly publicOrigin: string;
  private discoveryRefresh?: Promise<void>;

  constructor(
    private readonly discovery: DiscoveryService,
    config: ConfigService,
  ) {
    this.publicOrigin = config.getOrThrow<string>('app.publicWopiOrigin').replace(/\/+$/, '');
  }

  verifyRequest(request: Request, accessToken: string): void {
    const proof = this.header(request, 'x-wopi-proof');
    const proofOld = this.header(request, 'x-wopi-proofold');
    const timestampHeader = this.header(request, 'x-wopi-timestamp');

    if (!proof || !timestampHeader) {
      throw new InternalServerErrorException('Missing WOPI proof headers');
    }

    const timestamp = this.parseTimestamp(timestampHeader);
    this.assertRequestToken(request.originalUrl, accessToken);
    const payload = this.createPayload(request, accessToken, timestamp);
    const keys = this.discovery.getProofKeys();

    const proofWithCurrentKey = !!keys.current && this.verifySignature(proof, payload, keys.current);
    const oldProofWithCurrentKey = !!keys.current && !!proofOld && this.verifySignature(proofOld, payload, keys.current);
    const proofWithOldKey = !!keys.old && this.verifySignature(proof, payload, keys.old);

    if (!proofWithCurrentKey && !oldProofWithCurrentKey && !proofWithOldKey) {
      throw new InternalServerErrorException('WOPI proof validation failed');
    }

    // Microsoft recommends refreshing discovery when a request verifies with the old key.
    if (proofWithOldKey || oldProofWithCurrentKey) {
      void this.refreshDiscovery();
    }
  }

  private refreshDiscovery(): Promise<void> {
    if (!this.discoveryRefresh) {
      this.discoveryRefresh = this.discovery.refresh().finally(() => {
        this.discoveryRefresh = undefined;
      });
    }

    return this.discoveryRefresh.catch(() => undefined);
  }

  private createPayload(request: Request, accessToken: string, timestamp: bigint): Buffer {
    // Use the externally visible origin because TLS may terminate before Express.
    // originalUrl preserves the complete incoming path and query string, including access_token.
    const requestUrl = Buffer.from(`${this.publicOrigin}${request.originalUrl}`.toUpperCase(), 'utf8');
    const token = Buffer.from(accessToken, 'utf8');
    const timestampBytes = Buffer.alloc(8);
    timestampBytes.writeBigUInt64BE(timestamp);

    return Buffer.concat([
      this.withLength(token),
      token,
      this.withLength(requestUrl),
      requestUrl,
      this.withLength(timestampBytes),
      timestampBytes,
    ]);
  }

  private withLength(value: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    return length;
  }

  private verifySignature(signature: string, payload: Buffer, key: OfficeProofKey): boolean {
    try {
      const jwk: JsonWebKey = {
        kty: 'RSA',
        n: Buffer.from(key.modulus, 'base64').toString('base64url'),
        e: Buffer.from(key.exponent, 'base64').toString('base64url'),
      };
      const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
      const signatureBytes = Buffer.from(signature, 'base64');

      return verify('sha256', payload, publicKey, signatureBytes);
    } catch {
      return false;
    }
  }


  private assertRequestToken(originalUrl: string, accessToken: string): void {
    const query = originalUrl.split('?', 2)[1] ?? '';
    const tokens = new URLSearchParams(query).getAll('access_token');

    if (tokens.length !== 1 || tokens[0] !== accessToken) {
      throw new InternalServerErrorException('WOPI URL access_token does not match the authenticated token');
    }
  }

  private parseTimestamp(value: string): bigint {
    if (!/^\d+$/.test(value)) {
      throw new InternalServerErrorException('Invalid WOPI timestamp');
    }

    const timestamp = BigInt(value);
    const now = DOTNET_UNIX_EPOCH_TICKS + BigInt(Date.now()) * TICKS_PER_MILLISECOND;
    const difference = timestamp >= now ? timestamp - now : now - timestamp;
    if (difference > MAX_CLOCK_SKEW_TICKS || timestamp > 0x7fffffffffffffffn) {
      throw new InternalServerErrorException('WOPI timestamp is outside the allowed window');
    }

    return timestamp;
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
