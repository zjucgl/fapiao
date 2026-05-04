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

  it('rejects when proof images empty', async () => {
    await expect(
      svc.createByOperator(
        { teamId: 1n, operatorId: 7n },
        { paymentMethod: PaymentMethod.online, invoiceImages: [{ originalname: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('x'), size: 1 }], proofImages: [] },
      ),
    ).rejects.toThrow(/at least one payment proof/i);
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
});
