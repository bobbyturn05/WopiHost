import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LaunchService } from './launch.service';

@Controller('launch')
export class LaunchController {
  constructor(private readonly launchService: LaunchService) {}

  @Get(':token')
  async launch(@Param('token') token: string, @Res() response: Response) {
    const launch = await this.launchService.createOfficeLaunch(token);

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    return response.send(launch.html);
  }
}
