import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { AppController } from './app.controller';
import { loadEnvConfig } from './config/env.config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '..', '.env'), join(process.cwd(), '.env')],
      load: [() => ({ app: loadEnvConfig(process.env) })],
    }),
    PrismaModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
