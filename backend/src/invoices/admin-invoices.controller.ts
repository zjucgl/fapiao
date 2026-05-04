import {
  Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { ListInvoicesQueryDto } from './dto/list-invoices.dto';
import { RegisterInvoiceDto } from './dto/register-invoice.dto';
import { BatchProcessDto } from './dto/batch-process.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { TeamScopeGuard } from '../common/guards/team-scope.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('admin/invoices')
@Roles(Role.team_admin)
@UseGuards(TeamScopeGuard)
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@CurrentUser() me: JwtPayload, @Query() q: ListInvoicesQueryDto) {
    return this.invoices.listForTeam({ teamId: BigInt(me.teamId!) }, q);
  }

  @Get(':id')
  detail(@CurrentUser() me: JwtPayload, @Param('id') id: string) {
    return this.invoices.getForTeam({ teamId: BigInt(me.teamId!) }, BigInt(id));
  }

  @Patch(':id')
  register(@CurrentUser() me: JwtPayload, @Param('id') id: string, @Body() dto: RegisterInvoiceDto) {
    return this.invoices.register(
      { teamId: BigInt(me.teamId!), adminId: BigInt(me.sub) },
      BigInt(id),
      dto,
    );
  }

  @HttpCode(200)
  @Post('batch-process')
  batchProcess(@CurrentUser() me: JwtPayload, @Body() dto: BatchProcessDto) {
    return this.invoices.batchProcess(
      { teamId: BigInt(me.teamId!), adminId: BigInt(me.sub) },
      dto.ids.map((s) => BigInt(s)),
    );
  }
}
