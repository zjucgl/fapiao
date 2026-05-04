import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, InvoiceType, PaymentMethod, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { buildOssKey } from '../oss/key-naming';
import { ListInvoicesQueryDto } from './dto/list-invoices.dto';
import { UpdateInvoiceByOperatorDto } from './dto/update-invoice-by-operator.dto';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_KIND = 10;

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface OperatorScope {
  teamId: bigint;
  operatorId: bigint;
}

export interface TeamScope {
  teamId: bigint;
}

export interface CreateInvoiceInput {
  paymentMethod: PaymentMethod;
  remark?: string;
  invoiceImages: UploadedFile[];
  proofImages: UploadedFile[];
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssService,
  ) {}

  // ---------- Operator scope ----------

  async createByOperator(scope: OperatorScope, input: CreateInvoiceInput) {
    if (!input.invoiceImages?.length) throw new BadRequestException('at least one invoice image required');
    if (!input.proofImages?.length) throw new BadRequestException('at least one payment proof image required');
    if (input.invoiceImages.length > MAX_FILES_PER_KIND || input.proofImages.length > MAX_FILES_PER_KIND) {
      throw new BadRequestException(`max ${MAX_FILES_PER_KIND} files per kind`);
    }
    for (const f of [...input.invoiceImages, ...input.proofImages]) {
      if (!ALLOWED_MIME.has(f.mimetype)) throw new BadRequestException(`disallowed mime: ${f.mimetype}`);
      if (f.size > MAX_BYTES) throw new BadRequestException(`file too large: ${f.originalname}`);
    }

    const result: any = await this.prisma.$transaction(async (tx: any) => {
      const invoice = await tx.invoice.create({
        data: {
          teamId: scope.teamId,
          operatorId: scope.operatorId,
          paymentMethod: input.paymentMethod,
          remark: input.remark ?? null,
        },
      });

      const invoiceImageRows: { id: bigint; ossKey: string }[] = [];
      for (const f of input.invoiceImages) {
        const key = buildOssKey({ prefix: this.oss.getPrefix(), teamId: scope.teamId, invoiceId: invoice.id, kind: 'invoice', originalFilename: f.originalname });
        const row = await tx.invoiceImage.create({
          data: { invoiceId: invoice.id, ossKey: key, originalFilename: f.originalname, sizeBytes: f.size },
        });
        invoiceImageRows.push({ id: row.id as bigint, ossKey: key });
      }
      const proofImageRows: { id: bigint; ossKey: string }[] = [];
      for (const f of input.proofImages) {
        const key = buildOssKey({ prefix: this.oss.getPrefix(), teamId: scope.teamId, invoiceId: invoice.id, kind: 'proof', originalFilename: f.originalname });
        const row = await tx.paymentProofImage.create({
          data: { invoiceId: invoice.id, ossKey: key, originalFilename: f.originalname, sizeBytes: f.size },
        });
        proofImageRows.push({ id: row.id as bigint, ossKey: key });
      }
      return { invoice, invoiceImageRows, proofImageRows };
    });

    try {
      for (let i = 0; i < input.invoiceImages.length; i++) {
        const f = input.invoiceImages[i];
        await this.oss.putObject(result.invoiceImageRows[i].ossKey, f.buffer, f.mimetype);
      }
      for (let i = 0; i < input.proofImages.length; i++) {
        const f = input.proofImages[i];
        await this.oss.putObject(result.proofImageRows[i].ossKey, f.buffer, f.mimetype);
      }
    } catch (e) {
      await this.prisma.invoice.update({ where: { id: result.invoice.id }, data: { deletedAt: new Date() } });
      throw e;
    }

    return this.shapeInvoiceMinimal(result.invoice, result.invoiceImageRows.length, result.proofImageRows.length);
  }

  async listMine(scope: OperatorScope, q: ListInvoicesQueryDto) {
    const where = this.buildWhere({ teamId: scope.teamId, operatorId: scope.operatorId }, q);
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.pageSize ?? 50,
        skip: ((q.page ?? 1) - 1) * (q.pageSize ?? 50),
        include: { invoiceImages: true, proofImages: true, operator: { select: { username: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items: items.map((it: any) => this.shapeInvoiceFull(it)), total, page: q.page ?? 1, pageSize: q.pageSize ?? 50 };
  }

  async getMine(scope: OperatorScope, invoiceId: bigint) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, teamId: scope.teamId, operatorId: scope.operatorId, deletedAt: null },
      include: { invoiceImages: true, proofImages: true, operator: { select: { username: true } } },
    });
    if (!inv) throw new NotFoundException(`invoice ${invoiceId} not found`);
    return this.shapeInvoiceFull(inv as any);
  }

  async updateMine(scope: OperatorScope, invoiceId: bigint, dto: UpdateInvoiceByOperatorDto) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, teamId: scope.teamId, operatorId: scope.operatorId, deletedAt: null },
    });
    if (!inv) throw new NotFoundException(`invoice ${invoiceId} not found`);
    if (inv.status === InvoiceStatus.processed) throw new ForbiddenException('cannot edit processed invoice');
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        paymentMethod: dto.paymentMethod ?? inv.paymentMethod,
        remark: dto.remark === undefined ? inv.remark : dto.remark,
      },
    });
  }

  async softDeleteMine(scope: OperatorScope, invoiceId: bigint) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, teamId: scope.teamId, operatorId: scope.operatorId, deletedAt: null },
    });
    if (!inv) throw new NotFoundException(`invoice ${invoiceId} not found`);
    if (inv.status === InvoiceStatus.processed) throw new ForbiddenException('cannot delete processed invoice');
    await this.prisma.invoice.update({ where: { id: invoiceId }, data: { deletedAt: new Date() } });
  }

  // ---------- Shared helpers ----------

  protected buildWhere(base: { teamId: bigint; operatorId?: bigint }, q: ListInvoicesQueryDto) {
    const where: any = { ...base, deletedAt: null };
    if (q.status) where.status = q.status;
    if (q.invoiceType) where.invoiceType = q.invoiceType;
    if (q.paymentMethod) where.paymentMethod = q.paymentMethod;
    if (q.operatorId) where.operatorId = BigInt(q.operatorId);
    if (q.fromDate || q.toDate) {
      where.createdAt = {};
      if (q.fromDate) where.createdAt.gte = new Date(`${q.fromDate}T00:00:00Z`);
      if (q.toDate) where.createdAt.lt = new Date(`${q.toDate}T00:00:00Z`);
    }
    if (q.amountRegistered === 'true') where.amount = { not: null };
    if (q.amountRegistered === 'false') where.amount = null;
    return where;
  }

  protected shapeInvoiceMinimal(inv: any, invoiceImageCount: number, proofImageCount: number) {
    return {
      id: inv.id.toString(),
      teamId: inv.teamId.toString(),
      operatorId: inv.operatorId.toString(),
      paymentMethod: inv.paymentMethod,
      status: inv.status,
      remark: inv.remark,
      createdAt: inv.createdAt,
      updatedAt: inv.updatedAt,
      invoiceImageCount,
      proofImageCount,
    };
  }

  protected shapeInvoiceFull(inv: any) {
    return {
      id: inv.id.toString(),
      teamId: inv.teamId.toString(),
      operatorId: inv.operatorId.toString(),
      operatorUsername: inv.operator?.username ?? null,
      amount: inv.amount ? Number(inv.amount.toString()) : null,
      invoiceType: inv.invoiceType ?? null,
      paymentMethod: inv.paymentMethod,
      status: inv.status,
      remark: inv.remark,
      createdAt: inv.createdAt,
      updatedAt: inv.updatedAt,
      processedAt: inv.processedAt,
      processedBy: inv.processedBy?.toString() ?? null,
      invoiceImages: (inv.invoiceImages ?? []).map((img: any) => ({
        id: img.id.toString(),
        originalFilename: img.originalFilename,
        sizeBytes: img.sizeBytes,
        uploadedAt: img.uploadedAt,
      })),
      proofImages: (inv.proofImages ?? []).map((img: any) => ({
        id: img.id.toString(),
        originalFilename: img.originalFilename,
        sizeBytes: img.sizeBytes,
        uploadedAt: img.uploadedAt,
      })),
    };
  }
}
