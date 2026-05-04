import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param,
  Patch, Post, Query, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { PaymentMethod, Role } from '@prisma/client';
import { InvoicesService, UploadedFile } from './invoices.service';
import { ListInvoicesQueryDto } from './dto/list-invoices.dto';
import { UpdateInvoiceByOperatorDto } from './dto/update-invoice-by-operator.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TeamScopeGuard } from '../common/guards/team-scope.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('op/invoices')
@Roles(Role.operator)
@UseGuards(TeamScopeGuard)
export class OperatorInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'invoiceImages', maxCount: 10 },
      { name: 'proofImages', maxCount: 10 },
    ]),
  )
  async create(
    @CurrentUser() me: JwtPayload,
    @Body('paymentMethod') paymentMethod: PaymentMethod,
    @Body('remark') remark: string | undefined,
    @UploadedFiles()
    files: { invoiceImages?: Express.Multer.File[]; proofImages?: Express.Multer.File[] },
  ) {
    if (!paymentMethod || !Object.values(PaymentMethod).includes(paymentMethod)) {
      throw new BadRequestException('invalid paymentMethod');
    }
    return this.invoices.createByOperator(
      { teamId: BigInt(me.teamId!), operatorId: BigInt(me.sub) },
      {
        paymentMethod,
        remark,
        invoiceImages: (files.invoiceImages ?? []) as unknown as UploadedFile[],
        proofImages: (files.proofImages ?? []) as unknown as UploadedFile[],
      },
    );
  }

  @Get()
  list(@CurrentUser() me: JwtPayload, @Query() q: ListInvoicesQueryDto) {
    return this.invoices.listMine({ teamId: BigInt(me.teamId!), operatorId: BigInt(me.sub) }, q);
  }

  @Get(':id')
  detail(@CurrentUser() me: JwtPayload, @Param('id') id: string) {
    return this.invoices.getMine({ teamId: BigInt(me.teamId!), operatorId: BigInt(me.sub) }, BigInt(id));
  }

  @Patch(':id')
  update(
    @CurrentUser() me: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceByOperatorDto,
  ) {
    return this.invoices.updateMine({ teamId: BigInt(me.teamId!), operatorId: BigInt(me.sub) }, BigInt(id), dto);
  }

  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() me: JwtPayload, @Param('id') id: string) {
    return this.invoices.softDeleteMine({ teamId: BigInt(me.teamId!), operatorId: BigInt(me.sub) }, BigInt(id));
  }
}
