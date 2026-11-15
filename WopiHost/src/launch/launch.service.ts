import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import { DiscoveryService } from '../discovery/discovery.service';
import { TokensService } from '../tokens/tokens.service';

@Injectable()
export class LaunchService {
  constructor(
    private readonly tokensService: TokensService,
    private readonly discoveryService: DiscoveryService,
    private readonly config: ConfigService,
  ) {}

  async createOfficeLaunch(launchToken: string) {
    const pendingLaunch = await this.tokensService.findLaunchToken(launchToken);
    const extension = extname(pendingLaunch.filename).replace(/^\./, '');
    const actionUrl = this.discoveryService.getActionUrl(extension, pendingLaunch.mode);
    const accessTokenExpiresAt = new Date(
      Date.now() + this.config.getOrThrow<number>('tokens.accessTtlSeconds') * 1000,
    );
    const accessToken = await this.tokensService.create({
      kind: 'access',
      bucket: pendingLaunch.bucket,
      key: pendingLaunch.key,
      userId: pendingLaunch.userId,
      mode: pendingLaunch.mode,
      fileId: pendingLaunch.fileId,
      filename: pendingLaunch.filename,
      contentType: pendingLaunch.contentType,
      size: pendingLaunch.size,
      etag: pendingLaunch.etag,
      lastModified: pendingLaunch.lastModified,
      expiresAt: accessTokenExpiresAt,
    });
    try {
      await this.tokensService.consumeLaunchToken(launchToken);
    } catch (error) {
      await this.tokensService.revokeAccessToken(accessToken, pendingLaunch.fileId);
      throw error;
    }
    const publicOrigin = this.config.getOrThrow<string>('app.publicWopiOrigin').replace(/\/+$/, '');
    const wopiSrc = `${publicOrigin}/wopi/files/${encodeURIComponent(pendingLaunch.fileId)}`;
    const formFields = {
      WOPISrc: wopiSrc,
      access_token: accessToken,
      access_token_ttl: String(accessTokenExpiresAt.getTime()),
    };
    const inputs = Object.entries(formFields)
      .map(([name, value]) =>
        `<input type="hidden" name="${this.escapeHtml(name)}" value="${this.escapeHtml(value)}">`,
      )
      .join('\n');

    return {
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
  <script>document.getElementById('office-launch').submit();</script>
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
