import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XMLParser } from 'fast-xml-parser';
import { firstValueFrom } from 'rxjs';

export interface OfficeProofKey {
  exponent: string;
  modulus: string;
}

interface OfficeAction {
  name: string;
  extension: string;
  url: string;
}

@Injectable()
export class DiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly discoveryUrl: string;
  private refreshTimer?: NodeJS.Timeout;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
  });

  private actions: OfficeAction[] = [];
  private proofKey?: OfficeProofKey;
  private oldProofKey?: OfficeProofKey;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.discoveryUrl = config.getOrThrow<string>('office.discoveryUrl');
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch(() => this.logger.warn('Office discovery refresh failed; keeping the last valid discovery data'));
    }, 12 * 60 * 60 * 1000);
    this.refreshTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async refresh(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<string>(this.discoveryUrl, {
          timeout: 15000,
          responseType: 'text',
        }),
      );
      this.parseDiscovery(response.data);
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new ServiceUnavailableException('Unable to retrieve Office discovery information');
    }
  }

  getActionUrl(extension: string, mode: 'view' | 'edit'): string {
    const normalizedExtension = extension.replace(/^\./, '').toLowerCase();
    const preferredNames = mode === 'view' ? ['embedview', 'view'] : ['edit'];
    const action = this.actions.find(
      (candidate) =>
        candidate.extension.toLowerCase() === normalizedExtension &&
        preferredNames.includes(candidate.name.toLowerCase()),
    );

    if (!action) {
      throw new InternalServerErrorException(
        `Office discovery has no ${mode} action for .${normalizedExtension}`,
      );
    }

    return action.url;
  }

  getProofKeys(): { current?: OfficeProofKey; old?: OfficeProofKey } {
    return { current: this.proofKey, old: this.oldProofKey };
  }

  private parseDiscovery(xml: string): void {
    const root = this.parser.parse(xml);
    const discovery = root?.['wopi-discovery'] ?? root;
    const netZones = this.toArray(discovery?.['net-zone']);

    const actions = netZones.flatMap((zone) =>
      this.toArray(zone?.app).flatMap((app) =>
        this.toArray(app?.action)
          .filter(
            (action) =>
              typeof action?.ext === 'string' &&
              typeof action?.name === 'string' &&
              typeof action?.urlsrc === 'string',
          )
          .map((action) => ({
            name: String(action.name),
            extension: String(action.ext),
            url: String(action.urlsrc),
          })),
      ),
    );

    const proofKey = discovery?.['proof-key'];
    if (actions.length === 0 || !proofKey?.modulus || !proofKey?.exponent) {
      throw new InternalServerErrorException('Office discovery document is missing actions or proof keys');
    }

    this.actions = actions;
    this.proofKey = {
      modulus: String(proofKey.modulus),
      exponent: String(proofKey.exponent),
    };
    this.oldProofKey =
      proofKey.oldmodulus && proofKey.oldexponent
        ? {
            modulus: String(proofKey.oldmodulus),
            exponent: String(proofKey.oldexponent),
          }
        : undefined;
  }

  private toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  }
}
