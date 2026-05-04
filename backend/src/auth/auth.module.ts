import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PasswordService } from '../common/crypto/password.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService, PasswordService],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
