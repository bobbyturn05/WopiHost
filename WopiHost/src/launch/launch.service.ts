import { randomBytes } from 'crypto';
import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import { createWopiFileId } from '../common/crypto/file-id.util';
import { DiscoveryService } from '../discovery/discovery.service';
import { MinioService } from '../storage/minio.service';
import { TokensService } from '../tokens/tokens.service';

@Injectable()
export class LaunchService {
  constructor(
    private readonly tokensService: TokensService,
    private readonly discoveryService: DiscoveryService,
    private readonly minioService: MinioService,
    private readonly config: ConfigService,
  ) {}

  async createOfficeLaunch(launchToken: string) {
    const launch = await this.tokensService.findLaunchToken(launchToken);
    const metadata = await this.minioService.statObject(launch.bucket, launch.key);
    const maxFileSize = this.config.getOrThrow<number>('wopi.maxFileSizeBytes');
    if (metadata.size > maxFileSize) {
      throw new PayloadTooLargeException('Document exceeds the configured WOPI file-size limit');
    }
    const fileId = createWopiFileId(
      launch.bucket,
      launch.key,
      this.config.getOrThrow<string>('wopi.fileIdSecret'),
    );
    const extension = extname(metadata.filename).replace(/^\./, '');
    const actionUrl = this.discoveryService.getActionUrl(extension, launch.mode);
    const accessTokenExpiresAt = new Date(
      Date.now() + this.config.getOrThrow<number>('tokens.accessTtlSeconds') * 1000,
    );
    const accessToken = await this.tokensService.create({
      kind: 'access',
      bucket: launch.bucket,
      key: launch.key,
      userId: launch.userId,
      mode: launch.mode,
      expiresAt: accessTokenExpiresAt,
    });

    try {
      await this.tokensService.consumeLaunchToken(launchToken);
    } catch (error) {
      await this.tokensService.revokeAccessToken(accessToken).catch(() => undefined);
      throw error;
    }

    const publicOrigin = this.config.getOrThrow<string>('app.publicWopiOrigin').replace(/\/+$/, '');
    const wopiSrc = `${publicOrigin}/wopi/files/${encodeURIComponent(fileId)}`;
    const formFields = {
      WOPISrc: wopiSrc,
      access_token: accessToken,
      access_token_ttl: String(accessTokenExpiresAt.getTime()),
    };
    const nonce = randomBytes(18).toString('base64url');
    const actionOrigin = new URL(actionUrl).origin;
    const inputs = Object.entries(formFields)
      .map(([name, value]) =>
        `<input type="hidden" name="${this.escapeHtml(name)}" value="${this.escapeHtml(value)}">`,
      )
      .join('\n');

    return {
      contentSecurityPolicy: `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${actionOrigin}; base-uri 'none'`,
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <title>Opening document</title>
</head>
<body>
  <form id="office-launch" action="${this.escapeHtml(actionUrl)}" method="post">
    ${inputs}
    <noscript><button type="submit">Open document</button></noscript>
  </form>
  <script nonce="${nonce}">document.getElementById('office-launch').submit();</script>
</body>
</html>`,
    };
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&#39;');
  }
}
