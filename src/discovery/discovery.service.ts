import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
  ServiceUnavailableException
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
export class DiscoveryService implements OnModuleInit {
  private readonly discoveryUrl: string;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false
  });

  private actions: OfficeAction[] = [];
  private proofKey?: OfficeProofKey;
  private oldProofKey?: OfficeProofKey;

  constructor(
    private readonly http: HttpService,
    config: ConfigService
  ) {
    this.discoveryUrl = config.getOrThrow<string>('office.discoveryUrl');
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<string>(this.discoveryUrl, {
          timeout: 15000,
          responseType: 'text'
        })
      );

      this.parseDiscovery(response.data);
    } catch {
      throw new ServiceUnavailableException(
        'Unable to retrieve Office discovery information'
      );
    }
  }

  getActionUrl(extension: string, mode: 'view' | 'edit'): string {
    const normalizedExtension = extension.replace(/^\./, '').toLowerCase();

    const preferredNames =
      mode === 'view'
        ? ['embedview', 'view']
        : ['edit'];

    const action = this.actions.find(
      (candidate) =>
        candidate.extension.toLowerCase() === normalizedExtension &&
        preferredNames.includes(candidate.name.toLowerCase())
    );

    if (!action) {
      throw new InternalServerErrorException(
        `Office discovery has no ${mode} action for .${normalizedExtension}`
      );
    }

    return action.url;
  }

  getProofKeys(): {
    current?: OfficeProofKey;
    old?: OfficeProofKey;
  } {
    return {
      current: this.proofKey,
      old: this.oldProofKey
    };
  }

  private parseDiscovery(xml: string): void {
    const root = this.parser.parse(xml);
    const discovery = root?.['wopi-discovery'] ?? root;
    const netZones = this.toArray(discovery?.['net-zone']);

    const actions = netZones.flatMap((zone) => {
      const apps = this.toArray(zone?.app);

      return apps.flatMap((app) => {
        const appActions = this.toArray(app?.action);

        return appActions
          .filter(
            (action) =>
              typeof action?.ext === 'string' &&
              typeof action?.name === 'string' &&
              typeof action?.urlsrc === 'string'
          )
          .map((action) => ({
            name: String(action.name),
            extension: String(action.ext),
            url: String(action.urlsrc)
          }));
      });
    });

    const proofKey = discovery?.['proof-key'];

    if (actions.length === 0 || !proofKey?.modulus || !proofKey?.exponent) {
      throw new InternalServerErrorException(
        'Office discovery document is missing actions or proof keys'
      );
    }

    this.actions = actions;
    this.proofKey = {
      modulus: String(proofKey.modulus),
      exponent: String(proofKey.exponent)
    };

    const oldProofKey = discovery?.['old-proof-key'];

    this.oldProofKey =
      oldProofKey?.modulus && oldProofKey?.exponent
        ? {
            modulus: String(oldProofKey.modulus),
            exponent: String(oldProofKey.exponent)
          }
        : undefined;
  }

  private toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined || value === null) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }
}