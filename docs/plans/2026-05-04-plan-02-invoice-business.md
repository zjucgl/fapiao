# Plan 02 — Invoice Business (M2–M4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full invoice lifecycle on top of M1: operator uploads invoice + payment proof images to OSS; team_admin lists/registers amount+type, batch-marks processed, and batch-exports Excel + image ZIP(s).

**Architecture:** New `OssModule` wraps the `ali-oss` SDK and exposes `putObject` / `signedUrl` / `deleteObject`. New `InvoicesModule` owns all invoice business logic with two HTTP controllers — `OperatorInvoicesController` (own-invoice scope) and `AdminInvoicesController` (team scope). Image access goes through a dedicated `ImagesController` that emits short-lived signed URLs after permission check. Export is a sibling service inside `InvoicesModule` that streams Excel + ZIP through `archiver` + `exceljs`.

**Tech Stack additions:**
- `ali-oss` (Aliyun OSS SDK)
- `@nestjs/platform-express` + `multer` (multipart in-memory upload — already there from scaffold)
- `exceljs` (Excel generation)
- `archiver` (streaming ZIP)
- `mime-types` (extension lookup)

---

## File-by-file responsibilities (locked-in decomposition)

| File | Responsibility |
|---|---|
| `backend/src/oss/oss.module.ts` | Provides `OssService`. Global. |
| `backend/src/oss/oss.service.ts` | Wraps `ali-oss`. Methods: `putObject(key, buffer, mime)`, `signedUrl(key, ttlSec?)`, `deleteObject(key)`, `streamObject(key)` (returns Node Readable for export ZIP). Reads bucket/region/keys from `AppConfig.oss`. |
| `backend/src/oss/oss.service.spec.ts` | Unit tests with mocked `ali-oss` client. |
| `backend/src/oss/key-naming.ts` | Pure function `buildOssKey({ teamId, invoiceId, originalFilename, kind })` returning `fapiao/team_{teamId}/{yyyymm}/invoice_{invoiceId}/{kind}_{uuid}.{ext}`. `kind ∈ {invoice, proof}`. |
| `backend/src/oss/key-naming.spec.ts` | Unit tests for naming. |
| `backend/src/invoices/invoices.module.ts` | Wires service + 3 controllers + Multer in-memory storage. |
| `backend/src/invoices/invoices.service.ts` | Operator-scoped + admin-scoped business logic. |
| `backend/src/invoices/invoices.service.spec.ts` | Unit tests with mocked Prisma + OSS. |
| `backend/src/invoices/operator-invoices.controller.ts` | `/api/op/invoices` — create (multipart), list mine, get detail, update remark+payment, soft-delete (only when unprocessed). |
| `backend/src/invoices/admin-invoices.controller.ts` | `/api/admin/invoices` — list with filters, get detail, register amount+type, batch mark processed, export. |
| `backend/src/invoices/images.controller.ts` | `/api/invoices/:invoiceId/images/:imageId/url` and `/api/invoices/:invoiceId/proofs/:imageId/url` — return short-lived signed URL after permission check. |
| `backend/src/invoices/dto/*` | One file per DTO (CreateInvoiceFormDto, UpdateInvoiceByOperatorDto, ListInvoicesQueryDto, RegisterInvoiceDto, BatchProcessDto, ExportInvoicesDto). |
| `backend/src/invoices/export/export.service.ts` | `buildXlsxBuffer(invoices)` returns Buffer; `streamImagesZip(invoices, kind, res)` writes ZIP. |
| `backend/src/invoices/export/export.service.spec.ts` | Unit tests with mocked OSS streamObject. |
| `backend/test/invoice.e2e-spec.ts` | Real-DB e2e: operator uploads, admin lists/registers/exports. |

---

## Conventions

- **TDD**: write failing test → run → see fail → implement → run → pass → commit.
- **Path**: every command runs in `/data/github/fapiao/backend/` unless otherwise noted.
- **Branch**: feature branch `feat/m2-m4-invoices`. Don't push to `main` directly.
- **OSS**: tests **never** make real network calls. Mock the `ali-oss` client.
- **MIME whitelist**: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.
- **Max file size**: 10 MB per file.
- **Max files per invoice**: 10 invoice images + 10 proof images.

---

## Task 1: Install deps + OSS module scaffold

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/oss/oss.module.ts`, `backend/src/oss/oss.service.ts`, `backend/src/oss/key-naming.ts`, `backend/src/oss/key-naming.spec.ts`

- [ ] **Step 1: Install deps**

```bash
cd /data/github/fapiao/backend
npm install ali-oss exceljs archiver mime-types
npm install --save-dev @types/archiver @types/mime-types
```

`ali-oss` v6 ships with bundled types so we don't need `@types/ali-oss`.

- [ ] **Step 2: Key-naming pure function (TDD)**

Create `backend/src/oss/key-naming.spec.ts`:

```ts
import { buildOssKey } from './key-naming';

describe('buildOssKey', () => {
  beforeAll(() => { jest.useFakeTimers().setSystemTime(new Date('2026-05-15T10:00:00Z')); });
  afterAll(() => { jest.useRealTimers(); });

  it('builds invoice key under correct prefix', () => {
    const k = buildOssKey({
      prefix: 'fapiao/',
      teamId: 3n,
      invoiceId: 128n,
      kind: 'invoice',
      originalFilename: 'IMG_001.JPG',
    });
    expect(k).toMatch(/^fapiao\/team_3\/202605\/invoice_128\/invoice_[0-9a-f-]+\.jpg$/);
  });

  it('builds proof key with png extension', () => {
    const k = buildOssKey({
      prefix: 'fapiao/',
      teamId: 9n,
      invoiceId: 1n,
      kind: 'proof',
      originalFilename: 'screenshot.png',
    });
    expect(k).toMatch(/^fapiao\/team_9\/202605\/invoice_1\/proof_[0-9a-f-]+\.png$/);
  });

  it('falls back to bin when extension is unknown', () => {
    const k = buildOssKey({
      prefix: 'fapiao/',
      teamId: 1n,
      invoiceId: 1n,
      kind: 'invoice',
      originalFilename: 'noext',
    });
    expect(k).toMatch(/\.bin$/);
  });
});
```

Run: `npm test -- key-naming` — expect FAIL.

Create `backend/src/oss/key-naming.ts`:

```ts
import { randomUUID } from 'crypto';
import * as path from 'path';

export type OssKind = 'invoice' | 'proof';

export interface BuildOssKeyArgs {
  prefix: string;        // e.g. "fapiao/"
  teamId: bigint;
  invoiceId: bigint;
  kind: OssKind;
  originalFilename: string;
}

export function buildOssKey(args: BuildOssKeyArgs): string {
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const ext = (path.extname(args.originalFilename) || '.bin').toLowerCase();
  return `${args.prefix}team_${args.teamId}/${yyyymm}/invoice_${args.invoiceId}/${args.kind}_${randomUUID()}${ext}`;
}
```

Run: `npm test -- key-naming` — expect 3 passed.

- [ ] **Step 3: OssService skeleton (no real network — interface only)**

Create `backend/src/oss/oss.service.ts`:

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as OSS from 'ali-oss';
import { Readable } from 'stream';
import { AppConfig } from '../config/env.config';

@Injectable()
export class OssService implements OnModuleInit {
  private client!: OSS;
  private prefix!: string;
  private signedUrlTtl!: number;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const cfg = this.config.get<AppConfig>('app')!.oss;
    this.client = new OSS({
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      bucket: cfg.bucket,
      secure: true,
    });
    this.prefix = cfg.keyPrefix;
    this.signedUrlTtl = cfg.signedUrlExpiresSec;
  }

  getPrefix(): string {
    return this.prefix;
  }

  async putObject(key: string, body: Buffer, mime: string): Promise<void> {
    await this.client.put(key, body, { mime });
  }

  signedUrl(key: string, ttlSec: number = this.signedUrlTtl): string {
    return this.client.signatureUrl(key, { expires: ttlSec });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.delete(key);
  }

  async getStream(key: string): Promise<Readable> {
    const result = await this.client.getStream(key);
    return result.stream as Readable;
  }
}
```

Create `backend/src/oss/oss.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { OssService } from './oss.service';

@Global()
@Module({
  providers: [OssService],
  exports: [OssService],
})
export class OssModule {}
```

Add `OssModule` to `backend/src/app.module.ts` `imports` (alongside existing modules).

- [ ] **Step 4: Build to verify TS compiles**

```bash
npm run build
```

Expect clean.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): OSS module + key naming (M2 prep)"
```

---

## Task 2: OssService unit tests with mocked ali-oss

**Files:**
- Create: `backend/src/oss/oss.service.spec.ts`

- [ ] **Step 1: Write spec**

Create `backend/src/oss/oss.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OssService } from './oss.service';

const putMock = jest.fn();
const signatureUrlMock = jest.fn();
const deleteMock = jest.fn();
const getStreamMock = jest.fn();

jest.mock('ali-oss', () => {
  return jest.fn().mockImplementation(() => ({
    put: putMock,
    signatureUrl: signatureUrlMock,
    delete: deleteMock,
    getStream: getStreamMock,
  }));
});

describe('OssService', () => {
  let svc: OssService;

  beforeEach(async () => {
    putMock.mockReset();
    signatureUrlMock.mockReset();
    deleteMock.mockReset();
    getStreamMock.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        OssService,
        {
          provide: ConfigService,
          useValue: {
            get: () => ({
              oss: {
                region: 'oss-cn-hangzhou',
                bucket: 'b',
                accessKeyId: 'k',
                accessKeySecret: 's',
                keyPrefix: 'fapiao/',
                signedUrlExpiresSec: 300,
              },
            }),
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(OssService);
    svc.onModuleInit();
  });

  it('exposes the configured prefix', () => {
    expect(svc.getPrefix()).toBe('fapiao/');
  });

  it('putObject calls client.put with mime', async () => {
    putMock.mockResolvedValue({});
    await svc.putObject('fapiao/x.jpg', Buffer.from('hi'), 'image/jpeg');
    expect(putMock).toHaveBeenCalledWith('fapiao/x.jpg', Buffer.from('hi'), { mime: 'image/jpeg' });
  });

  it('signedUrl uses default TTL when none provided', () => {
    signatureUrlMock.mockReturnValue('https://signed/');
    expect(svc.signedUrl('fapiao/x.jpg')).toBe('https://signed/');
    expect(signatureUrlMock).toHaveBeenCalledWith('fapiao/x.jpg', { expires: 300 });
  });

  it('signedUrl honours overridden TTL', () => {
    signatureUrlMock.mockReturnValue('https://signed/');
    svc.signedUrl('fapiao/x.jpg', 60);
    expect(signatureUrlMock).toHaveBeenCalledWith('fapiao/x.jpg', { expires: 60 });
  });

  it('deleteObject delegates to client.delete', async () => {
    deleteMock.mockResolvedValue({});
    await svc.deleteObject('fapiao/x.jpg');
    expect(deleteMock).toHaveBeenCalledWith('fapiao/x.jpg');
  });

  it('getStream unwraps the stream property', async () => {
    const fake = { stream: 'STREAM' };
    getStreamMock.mockResolvedValue(fake);
    const out = await svc.getStream('fapiao/x.jpg');
    expect(out).toBe('STREAM');
  });
});
```

Run: `npm test -- oss.service` — expect 6 passed.

- [ ] **Step 2: Commit**

```bash
git add backend
git commit -m "test(backend): OssService unit tests (mocked ali-oss)"
```

---

## Task 3: Invoice DTOs

**Files:**
- Create:
  - `backend/src/invoices/dto/update-invoice-by-operator.dto.ts`
  - `backend/src/invoices/dto/list-invoices.dto.ts`
  - `backend/src/invoices/dto/register-invoice.dto.ts`
  - `backend/src/invoices/dto/batch-process.dto.ts`
  - `backend/src/invoices/dto/export-invoices.dto.ts`

> The "create invoice" form is multipart and is parsed inline in the controller; no DTO class for it (we use `class-validator` on form fields with `@Body()`).

- [ ] **Step 1: Update DTO (operator)**

Create `backend/src/invoices/dto/update-invoice-by-operator.dto.ts`:

```ts
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class UpdateInvoiceByOperatorDto {
  @IsOptional() @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional() @IsString() @MaxLength(200)
  remark?: string | null;
}
```

- [ ] **Step 2: List query DTO**

Create `backend/src/invoices/dto/list-invoices.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsBooleanString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { InvoiceStatus, InvoiceType, PaymentMethod } from '@prisma/client';

export class ListInvoicesQueryDto {
  @IsOptional() @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional() @IsEnum(InvoiceType)
  invoiceType?: InvoiceType;

  @IsOptional() @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional() @IsString()
  operatorId?: string;     // bigint as string

  @IsOptional() @IsString()
  fromDate?: string;       // YYYY-MM-DD inclusive

  @IsOptional() @IsString()
  toDate?: string;         // YYYY-MM-DD exclusive (next-day boundary)

  @IsOptional() @IsBooleanString()
  amountRegistered?: string;  // "true" or "false"

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number = 50;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;
}
```

- [ ] **Step 3: Register (admin)**

Create `backend/src/invoices/dto/register-invoice.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { InvoiceType } from '@prisma/client';

export class RegisterInvoiceDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  amount?: number;

  @IsOptional() @IsEnum(InvoiceType)
  invoiceType?: InvoiceType;
}
```

- [ ] **Step 4: Batch process**

Create `backend/src/invoices/dto/batch-process.dto.ts`:

```ts
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class BatchProcessDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];   // bigints as strings
}
```

- [ ] **Step 5: Export**

Create `backend/src/invoices/dto/export-invoices.dto.ts`:

```ts
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export enum ExportImageMode {
  invoice_only = 'invoice_only',
  proof_only = 'proof_only',
  both = 'both',
}

export class ExportInvoicesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000)
  @IsString({ each: true })
  ids!: string[];

  @IsEnum(ExportImageMode)
  mode!: ExportImageMode;

  @IsOptional() @IsBoolean()
  alsoMarkProcessed?: boolean = false;
}
```

- [ ] **Step 6: Build to verify**

```bash
npm run build
```

Expect clean.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): invoice DTOs"
```

---

## Task 4: InvoicesService — operator-side logic (TDD)

**Files:**
- Create: `backend/src/invoices/invoices.service.ts`, `backend/src/invoices/invoices.service.spec.ts`

> The service is constructor-injected with `PrismaService` and `OssService`. We mock both in unit tests.

- [ ] **Step 1: Write tests for operator-create**

Create `backend/src/invoices/invoices.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
      invoice: { create: jest.fn().mockResolvedValue({ id: 100n, teamId: 1n, operatorId: 7n, paymentMethod: PaymentMethod.cash, status: InvoiceStatus.unprocessed, createdAt: new Date(), updatedAt: new Date() }) },
      invoiceImage: { create: jest.fn() },
      paymentProofImage: { create: jest.fn() },
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
        {
          paymentMethod: PaymentMethod.online,
          invoiceImages: [],
          proofImages: [{ originalname: 'm.png', mimetype: 'image/png', buffer: Buffer.from('z'), size: 1 }],
        },
      ),
    ).rejects.toThrow(/at least one invoice image/i);
  });

  it('rejects when proof images empty', async () => {
    await expect(
      svc.createByOperator(
        { teamId: 1n, operatorId: 7n },
        {
          paymentMethod: PaymentMethod.online,
          invoiceImages: [{ originalname: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('x'), size: 1 }],
          proofImages: [],
        },
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
      id: 1n, teamId: 1n, operatorId: 7n, status: InvoiceStatus.processed, deletedAt: null,
    });
    await expect(
      svc.updateMine({ teamId: 1n, operatorId: 7n }, 1n, { paymentMethod: PaymentMethod.cash }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateMine succeeds while unprocessed', async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 1n, teamId: 1n, operatorId: 7n, status: InvoiceStatus.unprocessed, deletedAt: null,
    });
    prisma.invoice.update.mockResolvedValue({ id: 1n, paymentMethod: PaymentMethod.cash });
    const out = await svc.updateMine({ teamId: 1n, operatorId: 7n }, 1n, { paymentMethod: PaymentMethod.cash });
    expect(out.id).toBe(1n);
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
```

Run: `npm test -- invoices.service` — expect FAIL.

- [ ] **Step 2: Implement InvoicesService**

Create `backend/src/invoices/invoices.service.ts`:

```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, InvoiceType, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { buildOssKey } from '../oss/key-naming';
import { ListInvoicesQueryDto } from './dto/list-invoices.dto';
import { UpdateInvoiceByOperatorDto } from './dto/update-invoice-by-operator.dto';
import { RegisterInvoiceDto } from './dto/register-invoice.dto';

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

    // Two-phase: open a tx that creates the invoice (and child rows) so we get the invoiceId,
    // then upload to OSS outside the tx (uploads are slow). If any upload fails, mark the invoice
    // soft-deleted so it never surfaces.
    type InvoiceShape = { id: bigint; teamId: bigint; operatorId: bigint; paymentMethod: PaymentMethod; status: InvoiceStatus; remark: string | null; createdAt: Date; updatedAt: Date };

    const result: { invoice: InvoiceShape; invoiceImageRows: { id: bigint; ossKey: string }[]; proofImageRows: { id: bigint; ossKey: string }[] } = await this.prisma.$transaction(async (tx) => {
      const invoice = (await tx.invoice.create({
        data: {
          teamId: scope.teamId,
          operatorId: scope.operatorId,
          paymentMethod: input.paymentMethod,
          remark: input.remark ?? null,
        },
      })) as InvoiceShape;

      const invoiceImageRows: { id: bigint; ossKey: string }[] = [];
      for (const f of input.invoiceImages) {
        const key = buildOssKey({
          prefix: this.oss.getPrefix(),
          teamId: scope.teamId,
          invoiceId: invoice.id,
          kind: 'invoice',
          originalFilename: f.originalname,
        });
        const row = await tx.invoiceImage.create({
          data: { invoiceId: invoice.id, ossKey: key, originalFilename: f.originalname, sizeBytes: f.size },
        });
        invoiceImageRows.push({ id: row.id as bigint, ossKey: key });
      }
      const proofImageRows: { id: bigint; ossKey: string }[] = [];
      for (const f of input.proofImages) {
        const key = buildOssKey({
          prefix: this.oss.getPrefix(),
          teamId: scope.teamId,
          invoiceId: invoice.id,
          kind: 'proof',
          originalFilename: f.originalname,
        });
        const row = await tx.paymentProofImage.create({
          data: { invoiceId: invoice.id, ossKey: key, originalFilename: f.originalname, sizeBytes: f.size },
        });
        proofImageRows.push({ id: row.id as bigint, ossKey: key });
      }
      return { invoice, invoiceImageRows, proofImageRows };
    });

    // Upload outside the tx
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
      await this.prisma.invoice.update({
        where: { id: result.invoice.id },
        data: { deletedAt: new Date() },
      });
      throw e;
    }

    return this.shapeInvoice(result.invoice, result.invoiceImageRows.length, result.proofImageRows.length);
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
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { deletedAt: new Date() },
    });
  }

  // ---------- Admin scope (placeholders implemented in Task 7) ----------

  // ---------- Helpers ----------

  private buildWhere(base: { teamId: bigint; operatorId?: bigint }, q: ListInvoicesQueryDto) {
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

  private shapeInvoice(inv: any, invoiceImageCount: number, proofImageCount: number) {
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

  private shapeInvoiceFull(inv: any) {
    return {
      id: inv.id.toString(),
      teamId: inv.teamId.toString(),
      operatorId: inv.operatorId.toString(),
      operatorUsername: inv.operator?.username ?? null,
      amount: inv.amount ? Number(inv.amount) : null,
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
```

Run: `npm test -- invoices.service` — expect all created tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend
git commit -m "feat(backend): InvoicesService — operator-side (TDD)"
```

---

## Task 5: OperatorInvoicesController + multipart upload

**Files:**
- Create: `backend/src/invoices/operator-invoices.controller.ts`, `backend/src/invoices/invoices.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: InvoicesModule with Multer**

Create `backend/src/invoices/invoices.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InvoicesService } from './invoices.service';
import { OperatorInvoicesController } from './operator-invoices.controller';

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 25 },
    }),
  ],
  controllers: [OperatorInvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
```

Add `InvoicesModule` to `app.module.ts` `imports`.

- [ ] **Step 2: OperatorInvoicesController**

Create `backend/src/invoices/operator-invoices.controller.ts`:

```ts
import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param,
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
```

- [ ] **Step 3: Build + tests**

```bash
npm run build
npm test
```

Both should be clean.

- [ ] **Step 4: Commit**

```bash
git add backend
git commit -m "feat(backend): operator invoices controller (multipart upload)"
```

---

## Task 6: Image signed-URL endpoint

**Files:**
- Create: `backend/src/invoices/images.controller.ts`
- Modify: `backend/src/invoices/invoices.module.ts`, `backend/src/invoices/invoices.service.ts`, `backend/src/invoices/invoices.service.spec.ts`

> Goal: `GET /api/invoices/:invoiceId/images/:imageId/url` and `…/proofs/:imageId/url`. Returns `{ url: "...", expiresInSec: 300 }`. Permission: super_admin denied; team_admin allowed for own team; operator allowed only for own invoices.

- [ ] **Step 1: Add service methods (TDD)**

Append to `backend/src/invoices/invoices.service.spec.ts`:

```ts
describe('InvoicesService.signImage', () => {
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
});
```

Append to `invoices.service.ts` inside the class:

```ts
  async signImageUrl(
    actor: { role: Role; teamId: bigint | null; userId: bigint },
    kind: 'invoice' | 'proof',
    invoiceId: bigint,
    imageId: bigint,
  ): Promise<{ url: string; expiresInSec: number }> {
    const table = kind === 'invoice' ? this.prisma.invoiceImage : this.prisma.paymentProofImage;
    const row: any = await (table as any).findUnique({
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
```

Add `Role` to the import line at the top (already imported `InvoiceStatus`, `InvoiceType`, `PaymentMethod`, `Prisma`).

Run: `npm test -- invoices.service` — expect new tests pass alongside existing ones.

- [ ] **Step 2: ImagesController**

Create `backend/src/invoices/images.controller.ts`:

```ts
import { Controller, Get, Param } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { InvoicesService } from './invoices.service';

@Controller('invoices/:invoiceId')
export class ImagesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('images/:imageId/url')
  invoiceImageUrl(
    @CurrentUser() me: JwtPayload,
    @Param('invoiceId') invoiceId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.invoices.signImageUrl(
      { role: me.role as Role, teamId: me.teamId ? BigInt(me.teamId) : null, userId: BigInt(me.sub) },
      'invoice',
      BigInt(invoiceId),
      BigInt(imageId),
    );
  }

  @Get('proofs/:imageId/url')
  proofImageUrl(
    @CurrentUser() me: JwtPayload,
    @Param('invoiceId') invoiceId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.invoices.signImageUrl(
      { role: me.role as Role, teamId: me.teamId ? BigInt(me.teamId) : null, userId: BigInt(me.sub) },
      'proof',
      BigInt(invoiceId),
      BigInt(imageId),
    );
  }
}
```

- [ ] **Step 3: Register controller**

Edit `backend/src/invoices/invoices.module.ts` to add `ImagesController`:

```ts
controllers: [OperatorInvoicesController, ImagesController],
```

- [ ] **Step 4: Build + run all tests**

```bash
npm run build
npm test
```

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): image signed-URL endpoint with permission check"
```

---

## Task 7: InvoicesService — admin scope (TDD)

**Files:**
- Modify: `backend/src/invoices/invoices.service.ts`, `backend/src/invoices/invoices.service.spec.ts`

- [ ] **Step 1: Tests**

Append to `backend/src/invoices/invoices.service.spec.ts`:

```ts
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

  it('listForTeam ignores operatorId filter from caller scope', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.invoice.count.mockResolvedValue(0);
    await svc.listForTeam({ teamId: 1n }, {} as any);
    const args = prisma.invoice.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ teamId: 1n, deletedAt: null });
    expect(args.where.operatorId).toBeUndefined();
  });

  it('register sets amount + invoiceType', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ id: 1n, teamId: 1n, deletedAt: null });
    prisma.invoice.update.mockResolvedValue({ id: 1n });
    await svc.register({ teamId: 1n, adminId: 2n }, 1n, { amount: 99.5, invoiceType: InvoiceType.catering });
    const args = prisma.invoice.update.mock.calls[0][0];
    expect(args.data.amount).toBe(99.5);
    expect(args.data.invoiceType).toBe(InvoiceType.catering);
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
});
```

- [ ] **Step 2: Implement**

Append to `invoices.service.ts` inside the class:

```ts
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
    return { items: items.map((it: any) => this.shapeInvoiceFull(it)), total, page: q.page ?? 1, pageSize: q.pageSize ?? 50 };
  }

  async getForTeam(scope: TeamScope, invoiceId: bigint) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, teamId: scope.teamId, deletedAt: null },
      include: { invoiceImages: true, proofImages: true, operator: { select: { username: true } } },
    });
    if (!inv) throw new NotFoundException(`invoice ${invoiceId} not found`);
    return this.shapeInvoiceFull(inv as any);
  }

  async register(actor: { teamId: bigint; adminId: bigint }, invoiceId: bigint, dto: RegisterInvoiceDto) {
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
```

> Note: the test mocks the `Prisma.Decimal` constructor by passing through any value. In production it works because Prisma's runtime accepts numbers, strings, and Decimal. For the unit test mock, we pass a plain number expectation; adjust the test to use `expect(args.data.amount).toBeDefined()` if Decimal-wrapping breaks the assertion. Actually the cleaner path: the test sends `amount: 99.5` and expects `args.data.amount` to be a `Decimal` whose value equals `99.5` — match more loosely:

If the assertion `expect(args.data.amount).toBe(99.5)` fails because we wrap in Decimal, replace it in the test with:

```ts
expect(args.data.amount?.toString()).toBe('99.5');
```

Make this fix proactively.

Run: `npm test -- invoices.service` — expect all green.

- [ ] **Step 3: Commit**

```bash
git add backend
git commit -m "feat(backend): InvoicesService — admin scope (TDD)"
```

---

## Task 8: AdminInvoicesController

**Files:**
- Create: `backend/src/invoices/admin-invoices.controller.ts`
- Modify: `backend/src/invoices/invoices.module.ts`

- [ ] **Step 1: Controller**

Create `backend/src/invoices/admin-invoices.controller.ts`:

```ts
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
```

- [ ] **Step 2: Wire**

Edit `invoices.module.ts` to add `AdminInvoicesController`:

```ts
controllers: [OperatorInvoicesController, ImagesController, AdminInvoicesController],
```

- [ ] **Step 3: Build + tests**

```bash
npm run build
npm test
```

- [ ] **Step 4: Commit**

```bash
git add backend
git commit -m "feat(backend): admin invoices controller"
```

---

## Task 9: ExportService — Excel + ZIP generation (TDD)

**Files:**
- Create: `backend/src/invoices/export/export.service.ts`, `backend/src/invoices/export/export.service.spec.ts`
- Modify: `backend/src/invoices/invoices.module.ts`

- [ ] **Step 1: Tests**

Create `backend/src/invoices/export/export.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { Readable } from 'stream';
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

  it('produces a non-empty xlsx buffer with one row per invoice', async () => {
    const buf = await svc.buildXlsxBuffer([fakeInvoice(1), fakeInvoice(2)] as any);
    expect(buf.length).toBeGreaterThan(2000);
    // xlsx files are zip archives starting with "PK"
    expect(buf.slice(0, 2).toString()).toBe('PK');
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
    const sink = new (require('stream').Writable)({
      write(chunk: Buffer, _enc: any, cb: any) { chunks.push(chunk); cb(); },
    });
    await svc.streamImagesZip([fakeInvoice(1)] as any, 'invoice', sink);
    const out = Buffer.concat(chunks);
    expect(out.length).toBeGreaterThan(80);
    expect(out.slice(0, 2).toString()).toBe('PK');
  });
});
```

Run: `npm test -- export.service` — expect FAIL.

- [ ] **Step 2: Implement**

Create `backend/src/invoices/export/export.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as archiver from 'archiver';
import * as path from 'path';
import { Writable } from 'stream';
import { OssService } from '../../oss/oss.service';

const STATUS_LABEL: Record<string, string> = {
  unprocessed: '未处理',
  processed: '已处理',
};
const PAY_LABEL: Record<string, string> = {
  cash: '现金',
  online: '线上',
};
const TYPE_LABEL: Record<string, string> = {
  catering: '餐饮',
  fuel: '油票',
  consumable: '耗材',
  printing: '打印',
  other: '其它',
};

interface ExportInvoice {
  id: bigint;
  amount: any | null;
  invoiceType: string | null;
  paymentMethod: string;
  status: string;
  remark: string | null;
  createdAt: Date;
  operator: { username: string };
  invoiceImages: { id: bigint; originalFilename: string; ossKey: string }[];
  proofImages: { id: bigint; originalFilename: string; ossKey: string }[];
}

@Injectable()
export class ExportService {
  constructor(private readonly oss: OssService) {}

  async buildXlsxBuffer(invoices: ExportInvoice[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('发票');
    ws.columns = [
      { header: '序号', key: 'idx', width: 6 },
      { header: '录入日期', key: 'createdAt', width: 18 },
      { header: '操作员', key: 'operator', width: 14 },
      { header: '金额', key: 'amount', width: 12 },
      { header: '发票类型', key: 'type', width: 10 },
      { header: '支付方式', key: 'pay', width: 10 },
      { header: '状态', key: 'status', width: 10 },
      { header: '备注', key: 'remark', width: 24 },
      { header: '发票图片文件名', key: 'invoiceImageNames', width: 40 },
      { header: '支付凭证文件名', key: 'proofImageNames', width: 40 },
    ];
    ws.getRow(1).font = { bold: true };

    invoices.forEach((inv, i) => {
      ws.addRow({
        idx: i + 1,
        createdAt: this.fmtBeijing(inv.createdAt),
        operator: inv.operator.username,
        amount: inv.amount ? Number(inv.amount.toString()) : '',
        type: inv.invoiceType ? TYPE_LABEL[inv.invoiceType] ?? inv.invoiceType : '',
        pay: PAY_LABEL[inv.paymentMethod] ?? inv.paymentMethod,
        status: STATUS_LABEL[inv.status] ?? inv.status,
        remark: inv.remark ?? '',
        invoiceImageNames: inv.invoiceImages.map((img, j) => this.zipName(inv.id, j + 1, 'invoice', img.ossKey)).join('; '),
        proofImageNames: inv.proofImages.map((img, j) => this.zipName(inv.id, j + 1, 'proof', img.ossKey)).join('; '),
      });
    });

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  async streamImagesZip(invoices: ExportInvoice[], kind: 'invoice' | 'proof', sink: Writable): Promise<void> {
    const archive = archiver('zip', { zlib: { level: 5 } });
    const done = new Promise<void>((resolve, reject) => {
      sink.on('close', resolve);
      sink.on('finish', resolve);
      sink.on('error', reject);
      archive.on('error', reject);
    });
    archive.pipe(sink);

    for (const inv of invoices) {
      const list = kind === 'invoice' ? inv.invoiceImages : inv.proofImages;
      for (let j = 0; j < list.length; j++) {
        const img = list[j];
        const stream = await this.oss.getStream(img.ossKey);
        archive.append(stream, { name: this.zipName(inv.id, j + 1, kind, img.ossKey) });
      }
    }
    await archive.finalize();
    await done;
  }

  private zipName(invoiceId: bigint, idx: number, kind: 'invoice' | 'proof', ossKey: string) {
    const ext = path.extname(ossKey).toLowerCase() || '.bin';
    return `invoice_${invoiceId}_${kind}_${idx}${ext}`;
  }

  private fmtBeijing(d: Date): string {
    const t = new Date(d.getTime() + 8 * 3600 * 1000);
    const Y = t.getUTCFullYear();
    const M = String(t.getUTCMonth() + 1).padStart(2, '0');
    const D = String(t.getUTCDate()).padStart(2, '0');
    const h = String(t.getUTCHours()).padStart(2, '0');
    const m = String(t.getUTCMinutes()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}`;
  }
}
```

Add `ExportService` to `invoices.module.ts` providers.

Run: `npm test -- export.service` — expect green.

- [ ] **Step 3: Commit**

```bash
git add backend
git commit -m "feat(backend): ExportService (Excel + image ZIP)"
```

---

## Task 10: Export endpoint

**Files:**
- Modify: `backend/src/invoices/admin-invoices.controller.ts`, `backend/src/invoices/invoices.service.ts`

> The export endpoint streams a multi-part response. Simpler interface for the frontend:
> - `POST /api/admin/invoices/export` returns a JSON manifest with **download tokens** (one for Excel, one or two for ZIPs).
> - `GET /api/admin/invoices/export/:token` streams the actual file.
>
> Reasoning: a single multipart response over POST is awkward for browsers; two-step gives a stable download URL for `<a href>` and supports the "click" UX. The token is a short-lived (5 min) HMAC over `(adminId, ids[], part, exp)` — no DB writes needed.

- [ ] **Step 1: Add token plumbing in InvoicesService**

Append to `invoices.service.ts`:

```ts
  // Build a JWT-style token via the existing JWT secret (reuse for simplicity).
  // This service does not have JwtService directly — we'll do HMAC with crypto using a stable env-derived key.
  // For minimal scope, use plain JSON + HMAC SHA-256.

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
```

- [ ] **Step 2: Wire export endpoints on admin controller**

Modify `admin-invoices.controller.ts` — add imports and endpoints:

```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, Prisma } from '@prisma/client';
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
@Roles(Role.team_admin)
@UseGuards(TeamScopeGuard)
export class AdminInvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly exporter: ExportService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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

  @HttpCode(200)
  @Post('export')
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
```

> The download endpoint is `@Public()` because the JWT-style token *is* the auth — short-lived, signed, scoped. This sidesteps the global AuthGuard while still being safe.

- [ ] **Step 3: Build + tests**

```bash
npm run build
npm test
```

- [ ] **Step 4: Commit**

```bash
git add backend
git commit -m "feat(backend): batch export endpoints (xlsx + image ZIPs)"
```

---

## Task 11: Full e2e for invoice flow

**Files:**
- Create: `backend/test/invoice.e2e-spec.ts`

> The e2e test exercises the realistic happy path against the real DB and a **real** OSS bucket using the configured creds. It uploads two tiny in-memory images, lists, registers, batch-processes, and exports — finally asserting the exported xlsx looks right and the zip token resolves.
>
> Note: this test will create real OSS objects under `fapiao/team_<id>/...`. It cleans up by calling `OssService.deleteObject` on the keys it created.

- [ ] **Step 1: Write spec**

Create `backend/test/invoice.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { OssService } from '../src/oss/oss.service';

describe('e2e: invoice flow (operator → admin → export)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let oss: OssService;
  const createdKeys: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    await prisma.paymentProofImage.deleteMany();
    await prisma.invoiceImage.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.user.deleteMany();
    await prisma.team.deleteMany();

    const username = process.env.SUPER_ADMIN_USERNAME!;
    const initial = process.env.SUPER_ADMIN_INITIAL_PASSWORD!;
    await prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(initial, 10),
        role: 'super_admin',
        mustChangePassword: true,
      },
    });

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    oss = app.get(OssService);
  }, 30000);

  afterAll(async () => {
    for (const k of createdKeys) {
      try { await oss.deleteObject(k); } catch (_) {}
    }
    await app.close();
    await prisma.$disconnect();
  }, 30000);

  let superTok = '';
  let adminTok = '';
  let opTok = '';
  let teamId = '';
  let invoiceId = '';

  it('seeds super_admin login + team + admin + operator', async () => {
    let res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: process.env.SUPER_ADMIN_USERNAME, password: process.env.SUPER_ADMIN_INITIAL_PASSWORD })
      .expect(200);
    superTok = res.body.accessToken;

    res = await request(app.getHttpServer())
      .post('/api/super/teams').set('Authorization', `Bearer ${superTok}`)
      .send({ name: 'TeamE2E' }).expect(201);
    teamId = res.body.id;

    await request(app.getHttpServer())
      .post(`/api/super/teams/${teamId}/admins`).set('Authorization', `Bearer ${superTok}`)
      .send({ username: 'adm_e2e', initialPassword: 'initpass1' }).expect(201);

    res = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'adm_e2e', password: 'initpass1' }).expect(200);
    adminTok = res.body.accessToken;

    await request(app.getHttpServer())
      .post('/api/admin/operators').set('Authorization', `Bearer ${adminTok}`)
      .send({ username: 'op_e2e', initialPassword: 'opinit12' }).expect(201);

    res = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'op_e2e', password: 'opinit12' }).expect(200);
    opTok = res.body.accessToken;
  });

  it('operator uploads an invoice with 1 invoice image + 1 proof image', async () => {
    const fakeJpg = Buffer.from('\xff\xd8\xff\xe0fake-jpeg-payload', 'binary');
    const res = await request(app.getHttpServer())
      .post('/api/op/invoices').set('Authorization', `Bearer ${opTok}`)
      .field('paymentMethod', 'cash').field('remark', 'lunch')
      .attach('invoiceImages', fakeJpg, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('proofImages', fakeJpg, { filename: 'menu.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(res.body.id).toBeTruthy();
    invoiceId = res.body.id;

    // Track keys for cleanup
    const detail = await request(app.getHttpServer())
      .get(`/api/op/invoices/${invoiceId}`).set('Authorization', `Bearer ${opTok}`).expect(200);
    for (const img of detail.body.invoiceImages) {
      const dbRow = await prisma.invoiceImage.findUnique({ where: { id: BigInt(img.id) } });
      if (dbRow) createdKeys.push(dbRow.ossKey);
    }
    for (const img of detail.body.proofImages) {
      const dbRow = await prisma.paymentProofImage.findUnique({ where: { id: BigInt(img.id) } });
      if (dbRow) createdKeys.push(dbRow.ossKey);
    }
  }, 30000);

  it('admin lists, registers, signs URL', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/admin/invoices').set('Authorization', `Bearer ${adminTok}`).expect(200);
    expect(list.body.total).toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/admin/invoices/${invoiceId}`).set('Authorization', `Bearer ${adminTok}`)
      .send({ amount: 99.5, invoiceType: 'catering' }).expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/api/admin/invoices/${invoiceId}`).set('Authorization', `Bearer ${adminTok}`).expect(200);
    expect(detail.body.amount).toBe(99.5);
    expect(detail.body.invoiceType).toBe('catering');

    const imageId = detail.body.invoiceImages[0].id;
    const sig = await request(app.getHttpServer())
      .get(`/api/invoices/${invoiceId}/images/${imageId}/url`).set('Authorization', `Bearer ${adminTok}`).expect(200);
    expect(sig.body.url).toMatch(/^https:\/\//);
  });

  it('admin batch-processes', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/admin/invoices/batch-process').set('Authorization', `Bearer ${adminTok}`)
      .send({ ids: [invoiceId] }).expect(200);
    expect(r.body.count).toBe(1);
  });

  it('admin exports both ZIPs and Excel, downloads via tokens', async () => {
    const ex = await request(app.getHttpServer())
      .post('/api/admin/invoices/export').set('Authorization', `Bearer ${adminTok}`)
      .send({ ids: [invoiceId], mode: 'both' }).expect(200);
    expect(ex.body.parts).toHaveLength(3);
    for (const p of ex.body.parts) {
      const dl = await request(app.getHttpServer()).get(p.href).expect(200);
      expect(dl.body.length || dl.text.length).toBeGreaterThan(80);
    }
  }, 30000);
});
```

- [ ] **Step 2: Run e2e**

```bash
cd /data/github/fapiao/backend
set -a; source ../.env; set +a
npm run test:e2e
```

Expect both `auth.e2e-spec.ts` and `invoice.e2e-spec.ts` green. The invoice e2e uploads real bytes to OSS but cleans up after.

- [ ] **Step 3: Commit**

```bash
git add backend
git commit -m "test(backend): full invoice flow e2e (real OSS, real DB)"
```

---

## Task 12: README update for M2–M4 endpoints

**Files:**
- Modify: `backend/README.md`

- [ ] **Step 1: Update endpoint table**

Edit `backend/README.md` — append rows for the new endpoints:

```markdown
## Endpoints (M2–M4)

| Method | Path | Role |
|---|---|---|
| POST | /api/op/invoices | operator (multipart: paymentMethod, remark, invoiceImages[], proofImages[]) |
| GET | /api/op/invoices | operator |
| GET | /api/op/invoices/:id | operator |
| PATCH | /api/op/invoices/:id | operator (only while unprocessed) |
| DELETE | /api/op/invoices/:id | operator (soft, only while unprocessed) |
| GET | /api/admin/invoices | team_admin (filters: status, invoiceType, paymentMethod, operatorId, fromDate, toDate, amountRegistered, page, pageSize) |
| GET | /api/admin/invoices/:id | team_admin |
| PATCH | /api/admin/invoices/:id | team_admin (register amount + invoiceType) |
| POST | /api/admin/invoices/batch-process | team_admin (`{ids: string[]}`) |
| POST | /api/admin/invoices/export | team_admin (`{ids, mode: invoice_only/proof_only/both, alsoMarkProcessed?}`) → returns parts manifest |
| GET | /api/admin/invoices/export-download/:token | public (token-authed; 5-min TTL) |
| GET | /api/invoices/:invoiceId/images/:imageId/url | operator (own) / team_admin (own team) |
| GET | /api/invoices/:invoiceId/proofs/:imageId/url | operator (own) / team_admin (own team) |

## Constraints

- Allowed image MIME: image/jpeg, image/png, image/webp, application/pdf
- Max file size: 10 MB
- Max files per kind per invoice: 10
```

- [ ] **Step 2: Commit**

```bash
git add backend
git commit -m "docs(backend): README endpoint table for M2–M4"
```

---

## Verification (run before declaring M2–M4 done)

- [ ] `cd backend && npm test` — all unit tests green
- [ ] `npm run test:e2e` — both auth + invoice e2e green
- [ ] `npm run build` — clean
- [ ] Manual sanity from local against prod RDS:
  ```bash
  set -a; source ../.env; set +a
  curl -X POST http://localhost:3000/api/auth/login -H 'content-type: application/json' \
    -d "{\"username\":\"$SUPER_ADMIN_USERNAME\",\"password\":\"$SUPER_ADMIN_INITIAL_PASSWORD\"}"
  # ... etc
  ```

---

## Out of scope (handled in plan-03 / plan-04)

- Frontend (any UI)
- Production deployment of M2–M4 (re-deploy is plan-04, but a re-rsync + pm2 reload is acceptable mid-flight)
- Payment-proof OCR
- Statistics / reports
