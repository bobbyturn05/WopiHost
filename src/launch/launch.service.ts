import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokensService } from '../tokens/tokens.service';
import { DiscoveryService } from '../discovery/discovery.service';

@Injectable()
export class LaunchService {
  constructor(
    private readonly tokensService: TokensService,
    private readonly discoveryService: DiscoveryService,
    private readonly config: ConfigService,
  ) { }

  async createOfficeLaunch(launchToken: string) {
    const launch = await this.tokensService.consumeLaunchToken(launchToken);

    const accessTokenExpiresAt = new Date(
      Date.now() +
      this.config.get<number>('ACCESS_TOKEN_TTL_SECONDS', 3600) * 1000,
    );

    const accessToken = await this.tokensService.create({
      kind: 'access',
      bucket: launch.bucket,
      key: launch.key,
      userId: launch.userId,
      mode: launch.mode,
      fileId: launch.fileId,
      filename: launch.filename,
      contentType: launch.contentType,
      size: launch.size,
      etag: launch.etag,
      lastModified: launch.lastModified,
      expiresAt: accessTokenExpiresAt,
    });

    const wopiSrc = new URL(
      `/wopi/files/${encodeURIComponent(launch.fileId)}`,
      this.config.getOrThrow<string>('PUBLIC_WOPI_ORIGIN'),
    ).toString();

    const actionUrl = this.discoveryService.getActionUrl(
      launch.filename,
      launch.mode,
    );

    if (!actionUrl) {
      throw new NotFoundException('No supported Office action found');
    }

    const action = new URL(actionUrl);

    const formFields = {
      WOPISrc: wopiSrc,
      access_token: accessToken,
      access_token_ttl: String(accessTokenExpiresAt.getTime()),
    };

    const inputs = Object.entries(formFields)
      .map(
        ([name, value]) =>
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
  <form id="office-launch" action="${this.escapeHtml(action.toString())}" method="post">
    ${inputs}
    <noscript>
      <button type="submit">Open document</button>
    </noscript>
  </form>
  <script>
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