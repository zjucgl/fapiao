import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateTeamAdminDto } from './dto/create-team-admin.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('super/teams/:teamId/admins')
@Roles(Role.super_admin)
export class SuperUsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Param('teamId') teamId: string, @Body() dto: CreateTeamAdminDto) {
    return this.users.createTeamAdmin(BigInt(teamId), dto.username, dto.initialPassword);
  }

  @Get()
  list(@Param('teamId') teamId: string) {
    return this.users.listByTeamAndRole(BigInt(teamId), Role.team_admin);
  }

  @Patch(':userId/password')
  reset(@Param('userId') userId: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(BigInt(userId), dto.newPassword);
  }

  @Patch(':userId/status')
  setStatus(@Param('userId') userId: string, @Body() dto: UpdateUserStatusDto) {
    return this.users.setStatus(BigInt(userId), dto.status);
  }
}
