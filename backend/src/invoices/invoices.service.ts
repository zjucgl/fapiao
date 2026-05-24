import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, InvoiceType, PaymentMethod, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { buildOssKey } from '../oss/key-naming';
import { ListInvoicesQueryDto } from './dto/list-invoices.dto';
import { UpdateInvoiceByOperatorDto } from './dto/update-invoice-by-operator.dto';

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif',
  'image/tiff', 'image/bmp',
  'application/pdf',
  'application/octet-stream', // 部分浏览器对 HEIC 报这个，靠扩展名兜底
]);
const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.pdf',
]);
const MAX_BYTES = 20 * 1024 * 1024;  // iPhone HEIC 可能稍大，给到 20MB
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
    if (input.paymentMethod === PaymentMethod.online && !input.proofImages?.length) {
      throw new BadRequestException('at least one payment proof image required');
    }
    if (input.invoiceImages.length > MAX_FILES_PER_KIND || (input.proofImages?.length ?? 0) > MAX_FILES_PER_KIND) {
      throw new BadRequestException(`max ${MAX_FILES_PER_KIND} files per kind`);
    }
    for (const f of [...input.invoiceImages, ...input.proofImages]) {
      const ext = (f.originalname.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
      const mimeOk = ALLOWED_MIME.has(f.mimetype);
      const extOk = ALLOWED_EXT.has(ext);
      // 接受条件：MIME 在白名单 OR 扩展名在白名单（HEIC/HEIF 在某些浏览器里 mime 是 application/octet-stream）
      if (!mimeOk && !extOk) {
        throw new BadRequestException(`disallowed file: ${f.originalname} (mime=${f.mimetype})`);
      }
      if (f.size > MAX_BYTES) {
        throw new BadRequestException(`file too large (>${MAX_BYTES / 1024 / 1024}MB): ${f.originalname}`);
      }
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
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    return {
      items: items.map((it: any, idx: number) => ({ ...this.shapeInvoiceFull(it), rowNumber: (page - 1) * pageSize + idx + 1 })),
      total, page, pageSize,
    };
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

  async signImageUrl(
    actor: { role: Role; teamId: bigint | null; userId: bigint },
    kind: 'invoice' | 'proof',
    invoiceId: bigint,
    imageId: bigint,
  ): Promise<{ url: string; expiresInSec: number }> {
    const row: any = kind === 'invoice'
      ? await this.prisma.invoiceImage.findUnique({
          where: { id: imageId },
          include: { invoice: { select: { id: true, teamId: true, operatorId: true, deletedAt: true } } },
        })
      : await this.prisma.paymentProofImage.findUnique({
          where: { id: imageId },
          include: { invoice: { select: { id: true, teamId: true, operatorId: true, deletedAt: true } } },
        });
    if (!row || !row.invoice || row.invoice.id !== invoiceId || row.invoice.deletedAt) {
      throw new NotFoundException('image not found');
    }
    const inv = row.invoice;
    if (actor.role === Role.super_admin) throw new NotFoundException('image not found');
    if (actor.role === Role.team_admin) {
      if (actor.teamId === null || inv.teamId !== actor.teamId) throw new NotFoundException('image not found');
    } else if (actor.role === Role.operator) {
      if (inv.teamId !== actor.teamId || inv.operatorId !== actor.userId) throw new NotFoundException('image not found');
    }
    const url = this.oss.signedUrl(row.ossKey);
    return { url, expiresInSec: 300 };
  }

  // ---------- Admin scope ----------

  async listForTeam(scope: TeamScope, q: ListInvoicesQueryDto) {
    const where = this.buildWhere({ teamId: scope.teamId }, q);
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
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    return {
      items: items.map((it: any, idx: number) => ({ ...this.shapeInvoiceFull(it), rowNumber: (page - 1) * pageSize + idx + 1 })),
      total, page, pageSize,
    };
  }

  async getForTeam(scope: TeamScope, invoiceId: bigint) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, teamId: scope.teamId, deletedAt: null },
      include: { invoiceImages: true, proofImages: true, operator: { select: { username: true } } },
    });
    if (!inv) throw new NotFoundException(`invoice ${invoiceId} not found`);
    return this.shapeInvoiceFull(inv as any);
  }

  async register(actor: { teamId: bigint; adminId: bigint }, invoiceId: bigint, dto: { amount?: number; invoiceType?: InvoiceType }) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, teamId: actor.teamId, deletedAt: null },
    });
    if (!inv) throw new NotFoundException(`invoice ${invoiceId} not found`);
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        amount: dto.amount === undefined ? inv.amount : new Prisma.Decimal(dto.amount),
        invoiceType: dto.invoiceType === undefined ? inv.invoiceType : dto.invoiceType,
      },
    });
  }

  async batchProcess(actor: { teamId: bigint; adminId: bigint }, ids: bigint[]) {
    const result = await this.prisma.invoice.updateMany({
      where: { teamId: actor.teamId, id: { in: ids }, deletedAt: null },
      data: { status: InvoiceStatus.processed, processedAt: new Date(), processedBy: actor.adminId },
    });
    return { count: result.count };
  }

  buildExportToken(payload: object, ttlSec: number, secret: string): string {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
    const sig = require('crypto').createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  parseExportToken<T = any>(token: string, secret: string): T | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = require('crypto').createHmac('sha256', secret).update(body).digest('base64url');
    if (expected !== sig) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed as T;
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
