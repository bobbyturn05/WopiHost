import {
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

    if (!Number.isInteger(maxExpectedSize) || maxExpectedSize < 0 || maxExpectedSize > 0xffffffff) {
      response.sendStatus(400);
      return;
    }

    const file = await this.wopiService.getFile(access, maxExpectedSize);

    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', String(file.size));
    response.setHeader('X-WOPI-ItemVersion', file.version);
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
    if (!Buffer.isBuffer(request.body)) return response.status(400).send('Expected binary document body');

    const result = await this.wopiService.putFile(access, request.body, lockId);
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
  ) {
    const access = await this.authService.authorize(request, fileId);
    const operation = override?.toUpperCase();

    if (operation === 'GET_LOCK') {
      response.setHeader('X-WOPI-Lock', (await this.wopiService.getLock(access)) ?? '');
      return response.status(200).end();
    }

    const operations: Record<string, () => Promise<void>> = {
      LOCK: () => oldLockId !== undefined
        ? this.wopiService.unlockAndRelock(access, oldLockId, lockId ?? '')
        : this.wopiService.lock(access, lockId ?? ''),
      REFRESH_LOCK: () => this.wopiService.refreshLock(access, lockId ?? ''),
      UNLOCK: () => this.wopiService.unlock(access, lockId ?? ''),
    };
    const execute = operation ? operations[operation] : undefined;

    if (!execute) return response.status(501).send('Unsupported WOPI override');
    await execute();
    return response.status(200).end();
  }
}
