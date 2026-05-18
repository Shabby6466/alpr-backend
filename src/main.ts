import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger, ClassSerializerInterceptor } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }),
  );

  const prefix = process.env.API_PREFIX || 'api';
  app.setGlobalPrefix(prefix);
  app.enableCors();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ALPR API')
    .setDescription('Automatic License Plate Recognition API powered by ROC SDK')
    .setVersion('2.0')
    .addTag('ALPR')
    .addTag('Events')
    .addTag('Persons')
    .addTag('Watchlist')
    .addTag('Alerts')
    .addTag('Cameras')
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = parseInt(process.env.PORT ?? '3006', 10);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);

  logger.log(`Server running on http://${host}:${port}`);
  logger.log(`Swagger docs at http://${host}:${port}/docs`);
  logger.log(`DYLD_LIBRARY_PATH: ${process.env.DYLD_LIBRARY_PATH}`);
}

bootstrap();
