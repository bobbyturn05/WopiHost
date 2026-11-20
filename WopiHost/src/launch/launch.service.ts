import { randomBytes } from 'crypto';
import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import { FileIdentitiesService } from '../file-identities/file-identities.service';
import { DiscoveryService } from '../discovery/discovery.service';
import { MinioService } from '../storage/minio.service';
import { TokensService } from '../tokens/tokens.service';

@Injectable()
export class LaunchService {
  constructor(
    private readonly tokensService: TokensService,
    private readonly discoveryService: DiscoveryService,
    private readonly minioService: MinioService,
    private readonly identities: FileIdentitiesService,
    private readonly config: ConfigService,
  ) {}

  async createOfficeLaunch(launchToken: string, query: Record<string, unknown> = {}) {
    const launch = await this.tokensService.findLaunchToken(launchToken);
    const identity = await this.identities.findByFileId(launch.fileId);
    const metadata = await this.minioService.statObject(identity.bucket, identity.key);
    const maxFileSize = this.config.getOrThrow<number>('wopi.maxFileSizeBytes');
    if (metadata.size > maxFileSize) {
      throw new PayloadTooLargeException('Document exceeds the configured WOPI file-size limit');
    }
    const fileId = launch.fileId;
    const extension = extname(metadata.filename).replace(/^\./, '');
    const actionUrl = new URL(this.discoveryService.getActionUrl(extension, launch.mode));
    const forwardedWdParameters = Object.entries(query)
      .filter(([name, value]) => /^wd[A-Za-z0-9_]*$/i.test(name) && (typeof value === 'string' || Array.isArray(value)))
      .flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string').map((item) => [name, item] as const));
    forwardedWdParameters.forEach(([name, value]) => actionUrl.searchParams.append(name, value));
    const accessTokenExpiresAt = new Date(
      Date.now() + this.config.getOrThrow<number>('tokens.accessTtlSeconds') * 1000,
    );
    const accessToken = await this.tokensService.create({
      kind: 'access',
      fileId: launch.fileId,
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
    const actionOrigin = actionUrl.origin;
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
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opening document</title>
</head>
<body>
  <form id="office-launch" action="${this.escapeHtml(actionUrl.toString())}" method="post">
    ${inputs}
    <noscript><button type="submit">Open document</button></noscript>
  </form>
  <script nonce="${nonce}">
    const url = new URL(window.location.href);
    url.searchParams.delete('wdPreviousSession');
    url.searchParams.delete('wdPreviousCorrelation');
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    document.getElementById('office-launch').submit();
  </script>
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
