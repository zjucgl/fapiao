import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { SuperUsersController } from './super-users.controller';
import { OperatorsController } from './operators.controller';
import { PasswordService } from '../common/crypto/password.service';

@Module({
  controllers: [SuperUsersController, OperatorsController],
  providers: [UsersService, PasswordService],
  exports: [UsersService],
})
export class UsersModule {}
