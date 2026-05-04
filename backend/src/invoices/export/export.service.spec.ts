import { Test } from '@nestjs/testing';
import { Readable, Writable } from 'stream';
import { ExportService } from './export.service';
import { OssService } from '../../oss/oss.service';

const ossStub = {
  getStream: jest.fn(),
} as unknown as OssService;

const fakeInvoice = (id: number) => ({
  id: BigInt(id),
  amount: { toString: () => '12.34' },
  invoiceType: 'catering',
  paymentMethod: 'cash',
  status: 'unprocessed',
  remark: 'r',
  createdAt: new Date('2026-05-04T10:00:00Z'),
  operator: { username: 'op_a' },
  invoiceImages: [
    { id: BigInt(id * 10 + 1), originalFilename: 'a.jpg', ossKey: `fapiao/team_1/202605/invoice_${id}/invoice_x.jpg` },
  ],
  proofImages: [
    { id: BigInt(id * 10 + 2), originalFilename: 'm.png', ossKey: `fapiao/team_1/202605/invoice_${id}/proof_x.png` },
  ],
});

describe('ExportService.buildXlsxBuffer', () => {
  let svc: ExportService;
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ExportService, { provide: OssService, useValue: ossStub }],
    }).compile();
    svc = moduleRef.get(ExportService);
  });

  it('produces a non-empty xlsx buffer with rows for each invoice', async () => {
    const buf = await svc.buildXlsxBuffer([fakeInvoice(1), fakeInvoice(2)] as any);
    expect(buf.length).toBeGreaterThan(2000);
    // xlsx files are zip archives starting with "PK"
    expect(buf.slice(0, 2).toString()).toBe('PK');
  });

  it('handles invoices with null amount and null invoiceType', async () => {
    const inv = fakeInvoice(1);
    inv.amount = null as any;
    inv.invoiceType = null as any;
    const buf = await svc.buildXlsxBuffer([inv] as any);
    expect(buf.length).toBeGreaterThan(2000);
  });
});

describe('ExportService.streamImagesZip', () => {
  let svc: ExportService;
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ExportService, { provide: OssService, useValue: ossStub }],
    }).compile();
    svc = moduleRef.get(ExportService);
    (ossStub.getStream as jest.Mock).mockReset();
  });

  it('streams a non-empty zip when given invoices and kind=invoice', async () => {
    (ossStub.getStream as jest.Mock).mockImplementation(async () => Readable.from(Buffer.from('payload')));
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc: any, cb: any) { chunks.push(chunk); cb(); },
    });
    await svc.streamImagesZip([fakeInvoice(1)] as any, 'invoice', sink);
    const out = Buffer.concat(chunks);
    expect(out.length).toBeGreaterThan(80);
    expect(out.slice(0, 2).toString()).toBe('PK');
  });

  it('streams proof images when kind=proof', async () => {
    (ossStub.getStream as jest.Mock).mockImplementation(async () => Readable.from(Buffer.from('proof-payload')));
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc: any, cb: any) { chunks.push(chunk); cb(); },
    });
    await svc.streamImagesZip([fakeInvoice(1)] as any, 'proof', sink);
    expect(Buffer.concat(chunks).length).toBeGreaterThan(80);
  });
});
