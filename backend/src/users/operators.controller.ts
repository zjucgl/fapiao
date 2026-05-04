import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateOperatorDto } from './dto/create-operator.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TeamScopeGuard } from '../common/guards/team-scope.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('admin/operators')
@Roles(Role.team_admin)
@UseGuards(TeamScopeGuard)
export class OperatorsController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@CurrentUser() me: JwtPayload, @Body() dto: CreateOperatorDto) {
    return this.users.createOperator(BigInt(me.teamId!), dto.username, dto.initialPassword);
  }

  @Get()
  list(@CurrentUser() me: JwtPayload) {
    return this.users.listByTeamAndRole(BigInt(me.teamId!), Role.operator);
  }

  @Patch(':userId/password')
  async reset(
    @CurrentUser() me: JwtPayload,
    @Param('userId') userId: string,
    @Body() dto: ResetPasswordDto,
  ) {
    await this.assertSameTeam(me, BigInt(userId));
    return this.users.resetPassword(BigInt(userId), dto.newPassword);
  }

  @Patch(':userId/status')
  async setStatus(
    @CurrentUser() me: JwtPayload,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    await this.assertSameTeam(me, BigInt(userId));
    return this.users.setStatus(BigInt(userId), dto.status);
  }

  private async assertSameTeam(me: JwtPayload, userId: bigint) {
    const target = await this.users.getById(userId);
    if (!target || target.teamId?.toString() !== me.teamId) {
      // 404 rather than 403 to avoid information leak
      throw new NotFoundException(`user ${userId} not found in your team`);
    }
  }
}
