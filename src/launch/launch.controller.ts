import { Controller, Get, Param, Res } from "@nestjs/common";
import { LaunchService } from "./launch.service";
import { Response } from 'express'

@Controller('launch')
export class LaunchController {
  constructor(
    private readonly launchService: LaunchService,
  ) {}

  @Get(':token')
  async launch(
    @Param('token') token: string,
    @Res() response: Response,
  ) {
    const launch = await this.launchService.createOfficeLaunch(token);

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');

    return response.send(launch.html);
  }
}