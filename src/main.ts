// Load .env before anything else so ROC_LIC is in process.env when roc_initialize runs
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger, ClassSerializerInterceptor } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  console.log(`DYLD_LIBRARY_PATH: ${process.env.DYLD_LIBRARY_PATH}`);

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  // API prefix
  const prefix = process.env.API_PREFIX || 'api';
  app.setGlobalPrefix(prefix);

  // CORS
  app.enableCors();

  // Swagger docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ALPR API')
    .setDescription('Automatic License Plate Recognition API powered by ROC SDK')
    .setVersion('1.0')
    .addTag('ALPR')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = 3006;
  await app.listen(port, '127.0.0.1');

  logger.log(`Server running on http://localhost:${port}`);
  logger.log(`Swagger docs at http://localhost:${port}/docs`);
  logger.log(`ROC server: ${process.env.ROC_SERVER_URL || 'http://localhost:9000'}`);
}

bootstrap();
