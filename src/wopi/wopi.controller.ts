import {
  ConflictException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WopiAuthService } from './wopi-auth.service';
import { WopiService } from './wopi.service';

@Controller('wopi/files/:fileId')
export class WopiController {
  constructor(
    private readonly authService: WopiAuthService,
    private readonly wopiService: WopiService,
  ) {}

  @Get()
  async checkFileInfo(
    @Param('fileId') fileId: string,
    @Req() request: Request,
  ) {
    const access = await this.authService.authorize(request, fileId);
    return this.wopiService.checkFileInfo(access);
  }

  @Get('contents')
  async getFile(
    @Param('fileId') fileId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const access = await this.authService.authorize(request, fileId);
    const stream = await this.wopiService.getFile(access);

    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', 'attachment');

    stream.on('error', () => {
      if (!response.headersSent) {
        response.sendStatus(500);
      } else {
        response.destroy();
      }
    });

    stream.pipe(response);
  }

  @Post('contents')
  async putFile(
    @Param('fileId') fileId: string,
    @Req() request: Request,
    @Res() response: Response,
    @Headers('x-wopi-lock') lockId?: string,
  ) {
    const access = await this.authService.authorize(request, fileId);

    if (!Buffer.isBuffer(request.body)) {
      return response.status(400).send('Expected binary document body');
    }

    const result = await this.wopiService.putFile(
      access,
      request.body,
      lockId,
    );

    response.setHeader('X-WOPI-ItemVersion', result.Version);
    return response.sendStatus(200);
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

    try {
      switch (override?.toUpperCase()) {
        case 'LOCK':
          await this.wopiService.lock(access, lockId ?? '');
          return response.sendStatus(200);

        case 'REFRESH_LOCK':
          await this.wopiService.refreshLock(access, lockId ?? '');
          return response.sendStatus(200);

        case 'UNLOCK':
          await this.wopiService.unlock(access, lockId ?? '');
          return response.sendStatus(200);

        case 'GET_LOCK': {
          const currentLock = await this.wopiService.getLock(access);

          if (currentLock) {
            response.setHeader('X-WOPI-Lock', currentLock);
          }

          return response.sendStatus(200);
        }

        case 'UNLOCK_AND_RELOCK':
          await this.wopiService.unlockAndRelock(
            access,
            oldLockId ?? '',
            lockId ?? '',
          );
          return response.sendStatus(200);

        default:
          return response.status(501).send('Unsupported WOPI override');
      }
    } catch (error) {
      if (error instanceof ConflictException) {
        const currentLock = await this.wopiService.getLock(access);

        if (currentLock) {
          response.setHeader('X-WOPI-Lock', currentLock);
        }

        return response.sendStatus(409);
      }

      throw error;
    }
  }
}