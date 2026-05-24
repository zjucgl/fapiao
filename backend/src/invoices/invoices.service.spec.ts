import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InvoiceStatus, InvoiceType, PaymentMethod, Role } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { OssService } from '../oss/oss.service';

function mockPrisma() {
  return {
    invoice: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    invoiceImage: { create: jest.fn(), findUnique: jest.fn() },
    paymentProofImage: { create: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn({
      invoice: { create: jest.fn().mockResolvedValue({ id: 100n, teamId: 1n, operatorId: 7n, paymentMethod: PaymentMethod.cash, status: InvoiceStatus.unprocessed, createdAt: new Date(), updatedAt: new Date(), remark: 'lunch' }) },
      invoiceImage: { create: jest.fn().mockImplementation(({data}) => Promise.resolve({ id: BigInt(Math.floor(Math.random() * 1e9)), ...data })) },
      paymentProofImage: { create: jest.fn().mockImplementation(({data}) => Promise.resolve({ id: BigInt(Math.floor(Math.random() * 1e9)), ...data })) },
    })),
  };
}

const ossStub = {
  getPrefix: () => 'fapiao/',
  putObject: jest.fn(),
  signedUrl: jest.fn(),
  deleteObject: jest.fn(),
  getStream: jest.fn(),
} as unknown as OssService;

describe('InvoicesService.createByOperator', () => {
  let svc: InvoicesService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    prisma = mockPrisma();
    (ossStub.putObject as jest.Mock).mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: OssService, useValue: ossStub },
      ],
    }).compile();
    svc = moduleRef.get(InvoicesService);
  });

  it('creates an invoice, uploads N invoice + M proof images, returns ids', async () => {
    (ossStub.putObject as jest.Mock).mockResolvedValue(undefined);
    const out = await svc.createByOperator(
      { teamId: 1n, operatorId: 7n },
      {
        paymentMethod: PaymentMethod.cash,
        remark: 'lunch',
        invoiceImages: [
          { originalname: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('x'), size: 1 },
          { originalname: 'b.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('y'), size: 1 },
        ],
        proofImages: [
          { originalname: 'm.png', mimetype: 'image/png', buffer: Buffer.from('z'), size: 1 },
        ],
      },
    );
    expect(out.id).toBe('100');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(ossStub.putObject).toHaveBeenCalledTimes(3);
  });

  it('rejects when invoice images empty', async () => {
    await expect(
      svc.createByOperator(
        { teamId: 1n, operatorId: 7n },
        { paymentMethod: PaymentMethod.online, invoiceImages: [], proofImages: [{ originalname: 'm.png', mimetype: 'image/png', buffer: Buffer.from('z'), size: 1 }] },
      ),
    ).rejects.toThrow(/at least one invoice image/i);
  });

  it('rejects when proof images empty for online payment', async () => {
    await expect(
      svc.createByOperator(
        { teamId: 1n, operatorId: 7n },
        { paymentMethod: PaymentMethod.online, invoiceImages: [{ originalname: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('x'), size: 1 }], proofImages: [] },
      ),
    ).rejects.toThrow(/at least one payment proof/i);
  });

  it('allows empty proof images for cash payment', async () => {
    (ossStub.putObject as jest.Mock).mockResolvedValue(undefined);
    const out = await svc.createByOperator(
      { teamId: 1n, operatorId: 7n },
      {
        paymentMethod: PaymentMethod.cash,
        invoiceImages: [{ originalname: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('x'), size: 1 }],
        proofImages: [],
      },
    );
    expect(out.id).toBe('100');
    expect(ossStub.putObject).toHaveBeenCalledTimes(1);
  });

  it('rejects disallowed mime type', async () => {
    await expect(
      svc.createByOperator(
        { teamId: 1n, operatorId: 7n },
        {
          paymentMethod: PaymentMethod.online,
          invoiceImages: [{ originalname: 'a.exe', mimetype: 'application/x-msdownload', buffer: Buffer.from('x'), size: 1 }],
          proofImages: [{ originalname: 'm.png', mimetype: 'image/png', buffer: Buffer.from('z'), size: 1 }],
        },
      ),
    ).rejects.toThrow(/mime/i);
  });
});

describe('InvoicesService operator read paths', () => {
  let svc: InvoicesService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    prisma = mockPrisma();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: OssService, useValue: ossStub },
      ],
    }).compile();
    svc = moduleRef.get(InvoicesService);
  });

  it('listMine filters to deletedAt null and operatorId', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.invoice.count.mockResolvedValue(0);
    await svc.listMine({ teamId: 1n, operatorId: 7n }, {} as any);
    const args = prisma.invoice.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ teamId: 1n, operatorId: 7n, deletedAt: null });
  });

  it('getMine throws NotFoundException when other operator', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);
    await expect(svc.getMine({ teamId: 1n, operatorId: 7n }, 99n)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateMine forbids editing once processed', async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 1n, teamId: 1n, operatorId: 7n, status: InvoiceStatus.processed, deletedAt: null, paymentMethod: PaymentMethod.cash, remark: 'r',
    });
    await expect(
      svc.updateMine({ teamId: 1n, operatorId: 7n }, 1n, { paymentMethod: PaymentMethod.cash }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateMine succeeds while unprocessed', async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 1n, teamId: 1n, operatorId: 7n, status: InvoiceStatus.unprocessed, deletedAt: null, paymentMethod: PaymentMethod.online, remark: 'r',
    });
    prisma.invoice.update.mockResolvedValue({ id: 1n, paymentMethod: PaymentMethod.cash });
    const out = await svc.updateMine({ teamId: 1n, operatorId: 7n }, 1n, { paymentMethod: PaymentMethod.cash });
    expect((out as any).id).toBe(1n);
  });

  it('softDeleteMine forbids when processed', async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 1n, teamId: 1n, operatorId: 7n, status: InvoiceStatus.processed, deletedAt: null,
    });
    await expect(svc.softDeleteMine({ teamId: 1n, operatorId: 7n }, 1n)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('softDeleteMine sets deletedAt when unprocessed', async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 1n, teamId: 1n, operatorId: 7n, status: InvoiceStatus.unprocessed, deletedAt: null,
    });
    prisma.invoice.update.mockResolvedValue({});
    await svc.softDeleteMine({ teamId: 1n, operatorId: 7n }, 1n);
    const args = prisma.invoice.update.mock.calls[0][0];
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it('listMine attaches rowNumber based on page and pageSize', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: 10n, teamId: 1n, operatorId: 7n, paymentMethod: PaymentMethod.cash, status: InvoiceStatus.unprocessed, amount: null, createdAt: new Date(), updatedAt: new Date(), processedAt: null, processedBy: null, remark: null, invoiceImages: [], proofImages: [], operator: { username: 'op_a' } },
      { id: 11n, teamId: 1n, operatorId: 7n, paymentMethod: PaymentMethod.cash, status: InvoiceStatus.unprocessed, amount: null, createdAt: new Date(), updatedAt: new Date(), processedAt: null, processedBy: null, remark: null, invoiceImages: [], proofImages: [], operator: { username: 'op_a' } },
    ]);
    prisma.invoice.count.mockResolvedValue(50);
    const res = await svc.listMine({ teamId: 1n, operatorId: 7n }, { page: 2, pageSize: 20 } as any);
    expect(res.items[0].rowNumber).toBe(21);
    expect(res.items[1].rowNumber).toBe(22);
  });
});

describe('InvoicesService.signImageUrl', () => {
  let svc: InvoicesService;
  let prisma: ReturnType<typeof mockPrisma>;
  const oss = {
    getPrefix: () => 'fapiao/',
    putObject: jest.fn(),
    signedUrl: jest.fn(),
    deleteObject: jest.fn(),
    getStream: jest.fn(),
  } as unknown as OssService;

  beforeEach(async () => {
    prisma = mockPrisma();
    (oss.signedUrl as jest.Mock).mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: OssService, useValue: oss },
      ],
    }).compile();
    svc = moduleRef.get(InvoicesService);
  });

  it('signs invoice image url for owning operator', async () => {
    prisma.invoiceImage.findUnique.mockResolvedValue({
      id: 5n, ossKey: 'fapiao/team_1/202605/invoice_10/invoice_x.jpg',
      invoice: { id: 10n, teamId: 1n, operatorId: 7n, deletedAt: null },
    });
    (oss.signedUrl as jest.Mock).mockReturnValue('https://signed/');
    const out = await svc.signImageUrl(
      { role: Role.operator, teamId: 1n, userId: 7n },
      'invoice', 10n, 5n,
    );
    expect(out.url).toBe('https://signed/');
  });

  it('rejects operator viewing other operator image', async () => {
    prisma.invoiceImage.findUnique.mockResolvedValue({
      id: 5n, ossKey: 'fapiao/x.jpg',
      invoice: { id: 10n, teamId: 1n, operatorId: 99n, deletedAt: null },
    });
    await expect(
      svc.signImageUrl({ role: Role.operator, teamId: 1n, userId: 7n }, 'invoice', 10n, 5n),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows team_admin within team', async () => {
    prisma.invoiceImage.findUnique.mockResolvedValue({
      id: 5n, ossKey: 'fapiao/x.jpg',
      invoice: { id: 10n, teamId: 1n, operatorId: 99n, deletedAt: null },
    });
    (oss.signedUrl as jest.Mock).mockReturnValue('https://signed/');
    const out = await svc.signImageUrl({ role: Role.team_admin, teamId: 1n, userId: 1n }, 'invoice', 10n, 5n);
    expect(out.url).toBe('https://signed/');
  });

  it('blocks team_admin cross-team', async () => {
    prisma.invoiceImage.findUnique.mockResolvedValue({
      id: 5n, ossKey: 'fapiao/x.jpg',
      invoice: { id: 10n, teamId: 2n, operatorId: 99n, deletedAt: null },
    });
    await expect(
      svc.signImageUrl({ role: Role.team_admin, teamId: 1n, userId: 1n }, 'invoice', 10n, 5n),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks super_admin', async () => {
    prisma.invoiceImage.findUnique.mockResolvedValue({
      id: 5n, ossKey: 'fapiao/x.jpg',
      invoice: { id: 10n, teamId: 1n, operatorId: 99n, deletedAt: null },
    });
    await expect(
      svc.signImageUrl({ role: Role.super_admin, teamId: null, userId: 1n }, 'invoice', 10n, 5n),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when invoice is soft-deleted', async () => {
    prisma.invoiceImage.findUnique.mockResolvedValue({
      id: 5n, ossKey: 'fapiao/x.jpg',
      invoice: { id: 10n, teamId: 1n, operatorId: 7n, deletedAt: new Date() },
    });
    await expect(
      svc.signImageUrl({ role: Role.operator, teamId: 1n, userId: 7n }, 'invoice', 10n, 5n),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('handles proof images via paymentProofImage table', async () => {
    prisma.paymentProofImage.findUnique.mockResolvedValue({
      id: 9n, ossKey: 'fapiao/proof.png',
      invoice: { id: 10n, teamId: 1n, operatorId: 7n, deletedAt: null },
    });
    (oss.signedUrl as jest.Mock).mockReturnValue('https://signed-proof/');
    const out = await svc.signImageUrl(
      { role: Role.operator, teamId: 1n, userId: 7n },
      'proof', 10n, 9n,
    );
    expect(out.url).toBe('https://signed-proof/');
  });
});

describe('InvoicesService admin scope', () => {
  let svc: InvoicesService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    prisma = mockPrisma();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: OssService, useValue: ossStub },
      ],
    }).compile();
    svc = moduleRef.get(InvoicesService);
  });

  it('listForTeam scopes by teamId only (no operatorId from caller)', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.invoice.count.mockResolvedValue(0);
    await svc.listForTeam({ teamId: 1n }, {} as any);
    const args = prisma.invoice.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ teamId: 1n, deletedAt: null });
    expect(args.where.operatorId).toBeUndefined();
  });

  it('getForTeam returns invoice when in team', async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 1n, teamId: 1n, operatorId: 7n,
      paymentMethod: PaymentMethod.cash, status: InvoiceStatus.unprocessed,
      createdAt: new Date(), updatedAt: new Date(),
      invoiceImages: [], proofImages: [], operator: { username: 'op_a' },
    });
    const out = await svc.getForTeam({ teamId: 1n }, 1n);
    expect(out.id).toBe('1');
  });

  it('getForTeam throws NotFound for cross-team', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);
    await expect(svc.getForTeam({ teamId: 1n }, 99n)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('register sets amount + invoiceType', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ id: 1n, teamId: 1n, deletedAt: null, amount: null, invoiceType: null });
    prisma.invoice.update.mockResolvedValue({ id: 1n });
    await svc.register({ teamId: 1n, adminId: 2n }, 1n, { amount: 99.5, invoiceType: InvoiceType.catering });
    const args = prisma.invoice.update.mock.calls[0][0];
    expect(args.data.amount?.toString()).toBe('99.5');
    expect(args.data.invoiceType).toBe(InvoiceType.catering);
  });

  it('register preserves unspecified fields', async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 1n, teamId: 1n, deletedAt: null,
      amount: { toString: () => '50.00' }, invoiceType: InvoiceType.fuel,
    });
    prisma.invoice.update.mockResolvedValue({ id: 1n });
    await svc.register({ teamId: 1n, adminId: 2n }, 1n, { amount: 75 });
    const args = prisma.invoice.update.mock.calls[0][0];
    expect(args.data.amount?.toString()).toBe('75');
    expect(args.data.invoiceType).toBe(InvoiceType.fuel);
  });

  it('register throws NotFound when cross-team', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);
    await expect(
      svc.register({ teamId: 1n, adminId: 2n }, 99n, { amount: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('batchProcess marks all matching ids in one query', async () => {
    prisma.invoice.updateMany.mockResolvedValue({ count: 3 });
    const r = await svc.batchProcess({ teamId: 1n, adminId: 2n }, [1n, 2n, 3n]);
    expect(r.count).toBe(3);
    const args = prisma.invoice.updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ teamId: 1n, id: { in: [1n, 2n, 3n] }, deletedAt: null });
    expect(args.data.status).toBe(InvoiceStatus.processed);
    expect(args.data.processedBy).toBe(2n);
    expect(args.data.processedAt).toBeInstanceOf(Date);
  });

  it('listForTeam attaches rowNumber based on page and pageSize', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: 20n, teamId: 1n, operatorId: 7n, paymentMethod: PaymentMethod.cash, status: InvoiceStatus.unprocessed, amount: null, createdAt: new Date(), updatedAt: new Date(), processedAt: null, processedBy: null, remark: null, invoiceImages: [], proofImages: [], operator: { username: 'op_a' } },
    ]);
    prisma.invoice.count.mockResolvedValue(100);
    const res = await svc.listForTeam({ teamId: 1n }, { page: 3, pageSize: 30 } as any);
    expect(res.items[0].rowNumber).toBe(61);
  });
});

describe('InvoicesService export tokens', () => {
  let svc: InvoicesService;
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: mockPrisma() },
        { provide: OssService, useValue: ossStub },
      ],
    }).compile();
    svc = moduleRef.get(InvoicesService);
  });

  it('round-trips a valid token', () => {
    const tok = svc.buildExportToken({ teamId: '1', ids: ['1', '2'], part: 'xlsx' }, 60, 'secret-x');
    const parsed = svc.parseExportToken<{ teamId: string; ids: string[]; part: string }>(tok, 'secret-x');
    expect(parsed?.teamId).toBe('1');
    expect(parsed?.ids).toEqual(['1', '2']);
    expect(parsed?.part).toBe('xlsx');
  });

  it('rejects with wrong secret', () => {
    const tok = svc.buildExportToken({ x: 1 }, 60, 'right');
    expect(svc.parseExportToken(tok, 'wrong')).toBeNull();
  });

  it('rejects expired token', () => {
    const tok = svc.buildExportToken({ x: 1 }, -1, 'secret-x');
    expect(svc.parseExportToken(tok, 'secret-x')).toBeNull();
  });

  it('rejects malformed token', () => {
    expect(svc.parseExportToken('not.a.token', 'secret-x')).toBeNull();
    expect(svc.parseExportToken('', 'secret-x')).toBeNull();
  });
});
