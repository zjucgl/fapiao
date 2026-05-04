import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { join } from 'path';
import { AppController } from './app.controller';
import { loadEnvConfig } from './config/env.config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TeamsModule } from './teams/teams.module';
import { UsersModule } from './users/users.module';
import { OssModule } from './oss/oss.module';
import { InvoicesModule } from './invoices/invoices.module';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

// Serialize BigInt as string in JSON responses (must run before any controller sends a response)
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '..', '.env'), join(process.cwd(), '.env')],
      load: [() => ({ app: loadEnvConfig(process.env) })],
    }),
    JwtModule.register({}),
    PrismaModule,
    AuthModule,
    TeamsModule,
    UsersModule,
    OssModule,
    InvoicesModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
