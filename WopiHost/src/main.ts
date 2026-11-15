import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  app.enableShutdownHooks();

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith('/wopi/files/')) {
      response.setHeader('X-WOPI-ServerVersion', config.get<string>('wopi.serverVersion', '1.0.0'));
      response.setHeader('X-WOPI-MachineName', config.get<string>('wopi.machineName', 'wopi-host'));
    }
    next();
  });

  app.use(express.raw({
    type: 'application/octet-stream',
    limit: config.get<number>('wopi.maxFileSizeBytes', 104857600),
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
    const status = (error as { status?: number })?.status;
    if (request.path.startsWith('/wopi/files/') && status === 413) {
      response.status(413).send('Document exceeds the configured WOPI file-size limit');
      return;
    }
    next(error);
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  await app.listen(config.getOrThrow<number>('app.port'));
}

bootstrap();
