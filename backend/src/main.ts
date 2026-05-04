import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { AppModule } from './app.module';
import { AppConfig } from './config/env.config';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Idempotent super_admin seed on boot
  const config = app.get(ConfigService);
  const prisma = app.get(PrismaService);
  const sa = config.get<AppConfig>('app')!.superAdmin;
  const existing = await prisma.user.findUnique({ where: { username: sa.username } });
  if (!existing) {
    await prisma.user.create({
      data: {
        username: sa.username,
        passwordHash: await bcrypt.hash(sa.initialPassword, 10),
        role: 'super_admin',
        mustChangePassword: true,
      },
    });
    console.log(`bootstrapped super_admin "${sa.username}"`);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`fapiao backend listening on :${port}`);
}
bootstrap();
