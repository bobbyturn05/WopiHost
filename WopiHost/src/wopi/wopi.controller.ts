import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { WopiExceptionFilter } from '../common/filters/wopi-exception.filter';
import { WopiAuthService } from './wopi-auth.service';
import { WopiService } from './wopi.service';

@Controller('wopi/files/:fileId')
@UseFilters(WopiExceptionFilter)
export class WopiController {
  constructor(
    private readonly authService: WopiAuthService,
    private readonly wopiService: WopiService,
  ) {}

  @Get()
  async checkFileInfo(@Param('fileId') fileId: string, @Req() request: Request) {
    const access = await this.authService.authorize(request, fileId);
    return this.wopiService.checkFileInfo(access);
  }

  @Get('contents')
  async getFile(
    @Param('fileId') fileId: string,
    @Req() request: Request,
    @Res() response: Response,
    @Headers('x-wopi-maxexpectedsize') maxExpectedSizeHeader?: string,
  ): Promise<void> {
    const access = await this.authService.authorize(request, fileId);
    const maxExpectedSize = maxExpectedSizeHeader ? Number(maxExpectedSizeHeader) : 0xffffffff;

    if ((maxExpectedSizeHeader !== undefined && !/^\d+$/.test(maxExpectedSizeHeader)) || !Number.isInteger(maxExpectedSize) || maxExpectedSize < 0 || maxExpectedSize > 0xffffffff) {
      response.sendStatus(400);
      return;
    }

    const file = await this.wopiService.getFile(access, maxExpectedSize);

    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', String(file.size));
    response.setHeader('X-WOPI-ItemVersion', file.version);
    response.once('close', () => {
      if (!response.writableEnded) file.stream.destroy();
    });
    file.stream.on('error', () => {
      if (!response.headersSent) {
        response.removeHeader('Content-Length');
        response.setHeader('X-WOPI-ServerError', 'Unable to retrieve document content');
        response.status(500).end();
      } else {
        response.destroy();
      }
    });
    file.stream.pipe(response);
  }

  @Post('contents')
  async putFile(
    @Param('fileId') fileId: string,
    @Req() request: Request,
    @Res() response: Response,
    @Headers('x-wopi-override') override?: string,
    @Headers('x-wopi-lock') lockId?: string,
  ) {
    const access = await this.authService.authorize(request, fileId);
    if (override?.toUpperCase() !== 'PUT') return response.sendStatus(501);

    const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    const content = Buffer.isBuffer(request.body)
      ? request.body
      : request.headers['content-length'] === '0' && contentType === 'application/octet-stream'
        ? Buffer.alloc(0)
        : undefined;
    if (!content) return response.status(400).send('Expected binary document body');

    const result = await this.wopiService.putFile(access, content, lockId);
    response.setHeader('X-WOPI-ItemVersion', result.Version);
    return response.status(200).end();
  }

  @Post()
  async handleOverride(
    @Param('fileId') fileId: string,
    @Req() request: Request,
    @Res() response: Response,
    @Headers('x-wopi-override') override?: string,
    @Headers('x-wopi-lock') lockId?: string,
    @Headers('x-wopi-oldlock') oldLockId?: string,
    @Headers('x-wopi-lockexpirationtimeout') lockExpirationTimeoutHeader?: string,
  ) {
    const access = await this.authService.authorize(request, fileId);
    const operation = override?.toUpperCase();
    const lockExpirationTimeout = operation === 'LOCK' || operation === 'REFRESH_LOCK'
      ? this.parseLockExpirationTimeout(lockExpirationTimeoutHeader)
      : undefined;

    if (operation === 'GET_LOCK') {
      response.setHeader('X-WOPI-Lock', (await this.wopiService.getLock(access)) ?? '');
      return response.status(200).end();
    }

    const operations: Record<string, () => Promise<void>> = {
      LOCK: () => oldLockId !== undefined
        ? this.wopiService.unlockAndRelock(access, oldLockId, lockId ?? '', lockExpirationTimeout)
        : this.wopiService.lock(access, lockId ?? '', lockExpirationTimeout),
      REFRESH_LOCK: () => this.wopiService.refreshLock(access, lockId ?? '', lockExpirationTimeout),
      UNLOCK: () => this.wopiService.unlock(access, lockId ?? ''),
    };
    const execute = operation ? operations[operation] : undefined;

    if (!execute) return response.status(501).send('Unsupported WOPI override');
    await execute();
    return response.status(200).end();
  }

  private parseLockExpirationTimeout(value?: string): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException('Invalid X-WOPI-LockExpirationTimeout');
    }
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 3600) {
      throw new BadRequestException('X-WOPI-LockExpirationTimeout must be between 60 and 3600 seconds');
    }
    return seconds;
  }
}
