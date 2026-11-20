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
  private readonly discoveryZone: string;
  private readonly allowedOrigins: Set<string>;
  private refreshTimer?: NodeJS.Timeout;
  private refreshPromise?: Promise<void>;
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
    this.discoveryZone = config.getOrThrow<string>('office.discoveryZone');
    this.allowedOrigins = new Set(
      config.getOrThrow<string[]>('office.allowedOrigins').map((origin) => new URL(origin).origin),
    );
  }

  async onModuleInit(): Promise<void> {
    let refreshed = false;
    try {
      await this.refresh();
      refreshed = true;
    } catch {
      this.logger.warn('Initial Office discovery failed; the service will retry in one minute');
    }

    this.scheduleRefresh(refreshed ? 12 * 60 * 60 * 1000 : 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  private scheduleRefresh(delay: number): void {
    this.refreshTimer = setTimeout(async () => {
      let refreshed = false;
      try {
        await this.refresh();
        refreshed = true;
      } catch {
        this.logger.warn('Office discovery refresh failed; keeping the last valid discovery data');
      }

      this.scheduleRefresh(refreshed ? 12 * 60 * 60 * 1000 : 5 * 60 * 1000);
    }, delay);
    this.refreshTimer.unref();
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.fetchDiscovery();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async fetchDiscovery(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<string>(this.discoveryUrl, {
          timeout: 15000,
          responseType: 'text',
          maxContentLength: 5 * 1024 * 1024,
          maxBodyLength: 5 * 1024 * 1024,
          maxRedirects: 0,
        }),
      );
      this.parseDiscovery(response.data);
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw new ServiceUnavailableException('Unable to retrieve Office discovery information');
    }
  }

  get isReady(): boolean {
    return this.actions.length > 0 && Boolean(this.proofKey);
  }

  getActionUrl(extension: string, mode: 'view' | 'edit'): string {
    const normalizedExtension = extension.replace(/^\./, '').toLowerCase();
    const preferredNames = mode === 'view' ? ['embedview', 'view'] : ['edit'];
    const action = preferredNames
      .map((name) =>
        this.actions.find(
          (candidate) =>
            candidate.extension.toLowerCase() === normalizedExtension &&
            candidate.name.toLowerCase() === name,
        ),
      )
      .find((candidate) => candidate !== undefined);

    if (!action) {
      throw new InternalServerErrorException(
        `Office discovery has no ${mode} action for .${normalizedExtension}`,
      );
    }

    let parsedAction: URL;
    try {
      parsedAction = new URL(action.url);
    } catch {
      throw new InternalServerErrorException('Office discovery returned an invalid action URL');
    }

    if (
      parsedAction.protocol !== 'https:' ||
      parsedAction.username ||
      parsedAction.password ||
      !this.allowedOrigins.has(parsedAction.origin)
    ) {
      throw new InternalServerErrorException('Office discovery returned an untrusted action URL');
    }

    return parsedAction.toString();
  }

  getProofKeys(): { current?: OfficeProofKey; old?: OfficeProofKey } {
    return { current: this.proofKey, old: this.oldProofKey };
  }

  private parseDiscovery(xml: string): void {
    const root = this.parser.parse(xml);
    const discovery = root?.['wopi-discovery'] ?? root;
    const netZones = this.toArray(discovery?.['net-zone']);
    const selectedZone = netZones.find(
      (zone) => String(zone?.name ?? '').toLowerCase() === this.discoveryZone.toLowerCase(),
    );

    if (!selectedZone) {
      throw new InternalServerErrorException(
        `Office discovery document does not contain the configured network zone: ${this.discoveryZone}`,
      );
    }

    const actions = [selectedZone].flatMap((zone) =>
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
