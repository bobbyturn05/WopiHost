import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableShutdownHooks();

  let activeUploads = 0;
  const maxConcurrentUploads = config.get<number>('wopi.maxConcurrentUploads', 4);

  app.use((request: Request, response: Response, next: NextFunction) => {
    const isWopiContentsPost =
      request.method === 'POST' &&
      request.path.startsWith('/wopi/files/') &&
      request.path.endsWith('/contents');

    if (!isWopiContentsPost) {
      next();
      return;
    }

    if (activeUploads >= maxConcurrentUploads) {
      response.setHeader('Retry-After', '5');
      response.status(503).send('WOPI upload capacity is temporarily exhausted');
      return;
    }

    activeUploads += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeUploads -= 1;
    };
    response.once('finish', release);
    response.once('close', release);
    next();
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith('/wopi/files/')) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-WOPI-ServerVersion', config.get<string>('wopi.serverVersion', '1.0.0'));
      response.setHeader('X-WOPI-MachineName', config.get<string>('wopi.machineName', 'wopi-host'));
    }
    next();
  });

  app.use('/wopi/files', express.raw({
    type: (request: Request) =>
      request.method === 'POST' &&
      request.path.endsWith('/contents') &&
      Boolean(request.is('application/octet-stream')),
    limit: config.get<number>('wopi.maxFileSizeBytes', 52428800),
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
    const status = (error as { status?: number })?.status;
    if (request.originalUrl.split('?', 1)[0].startsWith('/wopi/files/') && status === 413) {
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
  const server = app.getHttpServer();
  server.headersTimeout = 15_000;
  server.requestTimeout = 300_000;
  server.keepAliveTimeout = 5_000;
}

bootstrap();
