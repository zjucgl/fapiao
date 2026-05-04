import {
  Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { ExportService } from './export/export.service';
import { ListInvoicesQueryDto } from './dto/list-invoices.dto';
import { RegisterInvoiceDto } from './dto/register-invoice.dto';
import { BatchProcessDto } from './dto/batch-process.dto';
import { ExportImageMode, ExportInvoicesDto } from './dto/export-invoices.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { TeamScopeGuard } from '../common/guards/team-scope.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/env.config';

@Controller('admin/invoices')
export class AdminInvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly exporter: ExportService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Roles(Role.team_admin)
  @UseGuards(TeamScopeGuard)
  list(@CurrentUser() me: JwtPayload, @Query() q: ListInvoicesQueryDto) {
    return this.invoices.listForTeam({ teamId: BigInt(me.teamId!) }, q);
  }

  @Get(':id')
  @Roles(Role.team_admin)
  @UseGuards(TeamScopeGuard)
  detail(@CurrentUser() me: JwtPayload, @Param('id') id: string) {
    return this.invoices.getForTeam({ teamId: BigInt(me.teamId!) }, BigInt(id));
  }

  @Patch(':id')
  @Roles(Role.team_admin)
  @UseGuards(TeamScopeGuard)
  register(@CurrentUser() me: JwtPayload, @Param('id') id: string, @Body() dto: RegisterInvoiceDto) {
    return this.invoices.register(
      { teamId: BigInt(me.teamId!), adminId: BigInt(me.sub) },
      BigInt(id),
      dto,
    );
  }

  @HttpCode(200)
  @Post('batch-process')
  @Roles(Role.team_admin)
  @UseGuards(TeamScopeGuard)
  batchProcess(@CurrentUser() me: JwtPayload, @Body() dto: BatchProcessDto) {
    return this.invoices.batchProcess(
      { teamId: BigInt(me.teamId!), adminId: BigInt(me.sub) },
      dto.ids.map((s) => BigInt(s)),
    );
  }

  @HttpCode(200)
  @Post('export')
  @Roles(Role.team_admin)
  @UseGuards(TeamScopeGuard)
  async export(@CurrentUser() me: JwtPayload, @Body() dto: ExportInvoicesDto) {
    if (dto.alsoMarkProcessed) {
      await this.invoices.batchProcess(
        { teamId: BigInt(me.teamId!), adminId: BigInt(me.sub) },
        dto.ids.map((s) => BigInt(s)),
      );
    }
    const secret = this.config.get<AppConfig>('app')!.jwt.accessSecret;
    const teamId = BigInt(me.teamId!);
    const ids = dto.ids;
    const baseToken = (part: 'xlsx' | 'invoice-zip' | 'proof-zip') =>
      this.invoices.buildExportToken({ teamId: teamId.toString(), ids, part }, 300, secret);

    const parts: { kind: 'xlsx' | 'invoice-zip' | 'proof-zip'; href: string; filename: string }[] = [];
    parts.push({ kind: 'xlsx', href: `/api/admin/invoices/export-download/${baseToken('xlsx')}`, filename: this.fname('xlsx') });
    if (dto.mode === ExportImageMode.invoice_only || dto.mode === ExportImageMode.both) {
      parts.push({ kind: 'invoice-zip', href: `/api/admin/invoices/export-download/${baseToken('invoice-zip')}`, filename: this.fname('invoice-zip') });
    }
    if (dto.mode === ExportImageMode.proof_only || dto.mode === ExportImageMode.both) {
      parts.push({ kind: 'proof-zip', href: `/api/admin/invoices/export-download/${baseToken('proof-zip')}`, filename: this.fname('proof-zip') });
    }
    return { parts, expiresInSec: 300 };
  }

  @Public()
  @Get('export-download/:token')
  async download(@Param('token') token: string, @Res() res: Response) {
    const secret = this.config.get<AppConfig>('app')!.jwt.accessSecret;
    const payload = this.invoices.parseExportToken<{ teamId: string; ids: string[]; part: string }>(token, secret);
    if (!payload) {
      res.status(401).json({ message: 'invalid or expired export token' });
      return;
    }
    const teamId = BigInt(payload.teamId);
    const ids = payload.ids.map((s) => BigInt(s));
    const invoices = await this.prisma.invoice.findMany({
      where: { teamId, id: { in: ids }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { invoiceImages: true, proofImages: true, operator: { select: { username: true } } },
    });

    if (payload.part === 'xlsx') {
      const buf = await this.exporter.buildXlsxBuffer(invoices as any);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${this.fname('xlsx')}"`);
      res.end(buf);
      return;
    }
    if (payload.part === 'invoice-zip' || payload.part === 'proof-zip') {
      const kind = payload.part === 'invoice-zip' ? 'invoice' : 'proof';
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${this.fname(payload.part as any)}"`);
      await this.exporter.streamImagesZip(invoices as any, kind, res);
      return;
    }
    res.status(400).json({ message: 'unknown part' });
  }

  private fname(part: 'xlsx' | 'invoice-zip' | 'proof-zip') {
    const stamp = new Date().toISOString().slice(0, 10);
    if (part === 'xlsx') return `fapiao_${stamp}.xlsx`;
    if (part === 'invoice-zip') return `fapiao_invoices_${stamp}.zip`;
    return `fapiao_proofs_${stamp}.zip`;
  }
}
