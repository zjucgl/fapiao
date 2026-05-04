import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('super/teams')
@Roles(Role.super_admin)
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  create(@Body() dto: CreateTeamDto) {
    return this.teams.create(dto.name);
  }

  @Get()
  list() {
    return this.teams.list();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.teams.update(BigInt(id), dto);
  }
}
