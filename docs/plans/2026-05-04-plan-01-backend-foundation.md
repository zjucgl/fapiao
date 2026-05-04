# Plan 01 — Backend Foundation (M1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a NestJS backend with MySQL schema, JWT auth, and CRUD for the three role types (super admin, team admin, operator), so that subsequent plans can layer invoice features on top.

**Architecture:** NestJS modular monolith with Prisma ORM against Aliyun RDS MySQL. Three guards in a chain — `AuthGuard` (validate JWT), `RolesGuard` (check role on route), `TeamScopeGuard` (inject `req.user.teamId` and force `where.team_id` on every query). Bcrypt password hashing. Seeded super admin on first boot. First-login forced password change enforced at controller layer.

**Tech Stack:**
- Node.js 20 LTS, TypeScript 5
- NestJS 10
- Prisma 5 + MySQL 8 (Aliyun RDS)
- @nestjs/jwt, bcrypt, class-validator, class-transformer
- Jest (unit) + Supertest (e2e)

**Repo layout produced by this plan:**
```
fapiao/
  backend/
    package.json
    tsconfig.json
    nest-cli.json
    .eslintrc.js
    .prettierrc
    .env                            # symlink or copy from project root .env
    prisma/
      schema.prisma
      migrations/
      seed.ts
    src/
      main.ts
      app.module.ts
      config/env.config.ts
      prisma/
        prisma.module.ts
        prisma.service.ts
      common/
        crypto/
          password.service.ts
          password.service.spec.ts
        guards/
          auth.guard.ts
          roles.guard.ts
          team-scope.guard.ts
        decorators/
          roles.decorator.ts
          current-user.decorator.ts
          public.decorator.ts
      auth/
        auth.module.ts
        auth.service.ts
        auth.service.spec.ts
        auth.controller.ts
        dto/{login.dto.ts,refresh.dto.ts,change-password.dto.ts}
        types/jwt-payload.type.ts
      users/
        users.module.ts
        users.service.ts
        users.service.spec.ts
        users.controller.ts          # /api/admin/operators
        super-users.controller.ts    # /api/super/teams/:id/admins
      teams/
        teams.module.ts
        teams.service.ts
        teams.service.spec.ts
        teams.controller.ts          # /api/super/teams
    test/
      auth.e2e-spec.ts
      super-admin.e2e-spec.ts
      team-admin.e2e-spec.ts
```

---

## File-by-file responsibilities (locked-in decomposition)

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | All 5 tables (`teams`, `users`, `invoices`, `invoice_images`, `payment_proof_images`). Even though M1 only uses `teams` + `users`, define all five up front to avoid migration churn. |
| `prisma/seed.ts` | Idempotent: create super admin from `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_INITIAL_PASSWORD` if absent. |
| `config/env.config.ts` | Single source of typed env access. Throws on missing required vars at boot. |
| `prisma/prisma.service.ts` | Wraps `PrismaClient`; lifecycle hooks for connect/disconnect. |
| `common/crypto/password.service.ts` | `hash(plain)` and `verify(plain, hash)` using bcrypt cost 10. |
| `common/guards/auth.guard.ts` | Reads `Authorization: Bearer …`, verifies access JWT, attaches user to `req.user`. Skips routes marked `@Public()`. |
| `common/guards/roles.guard.ts` | Reads `@Roles(...)` metadata, rejects mismatched role. |
| `common/guards/team-scope.guard.ts` | For team-scoped routes: reject super_admin, ensure `req.user.teamId` is set. |
| `auth/auth.service.ts` | `login`, `refresh`, `changePassword`. Issues access (30 min) + refresh (7 d) tokens. |
| `auth/auth.controller.ts` | POST `/api/auth/login`, `/api/auth/refresh`, `/api/auth/change-password`. |
| `users/users.service.ts` | Create / list / disable / reset-password operators within a team. No hard delete. |
| `users/users.controller.ts` | `/api/admin/operators` (team_admin only). |
| `users/super-users.controller.ts` | `/api/super/teams/:id/admins` (super_admin only). |
| `teams/teams.service.ts` | Create / list / disable team. Team name unique. |
| `teams/teams.controller.ts` | `/api/super/teams` (super_admin only). |

---

## Conventions every task follows

- **TDD**: write failing test → run → see fail → implement → run → see pass → commit.
- **Commits**: small (one task = 1–3 commits). Imperative subject in Chinese or English, doesn't matter.
- **Run tests**: `cd backend && npm test` for unit; `npm run test:e2e` for e2e.
- **Migrations**: `npx prisma migrate dev --name <name>` from `backend/`.
- **Path**: every command runs in `/data/github/fapiao/backend/` unless otherwise noted.

---

## Task 1: Bootstrap NestJS project

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/tsconfig.build.json`, `backend/nest-cli.json`, `backend/.eslintrc.js`, `backend/.prettierrc`, `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/src/app.controller.ts`, `backend/src/app.controller.spec.ts`

- [ ] **Step 1: Create the backend folder via Nest CLI**

```bash
cd /data/github/fapiao
npx --yes @nestjs/cli@10 new backend --package-manager npm --strict --skip-git
```

When prompted, choose `npm`.

- [ ] **Step 2: Verify scaffold runs and tests pass**

```bash
cd /data/github/fapiao/backend
npm test
```

Expected: `Tests: 1 passed, 1 total` (the default `app.controller.spec.ts`).

- [ ] **Step 3: Add a healthcheck route to confirm bootstrap**

Replace `backend/src/app.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('healthz')
  healthz() {
    return { ok: true };
  }
}
```

Replace `backend/src/app.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let controller: AppController;
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();
    controller = moduleRef.get(AppController);
  });

  it('GET /healthz returns ok', () => {
    expect(controller.healthz()).toEqual({ ok: true });
  });
});
```

Delete `backend/src/app.service.ts` and `backend/src/app.service.spec.ts` if present, and remove the import from `app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 4: Run tests to verify**

```bash
npm test
```

Expected: 1 passed.

- [ ] **Step 5: Make global API prefix and validation pipe in main.ts**

Replace `backend/src/main.ts`:

```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`fapiao backend listening on :${port}`);
}
bootstrap();
```

- [ ] **Step 6: Commit**

```bash
cd /data/github/fapiao
git add backend
git commit -m "feat(backend): bootstrap NestJS scaffold with healthcheck"
```

---

## Task 2: Wire env config

**Files:**
- Create: `backend/src/config/env.config.ts`, `backend/src/config/env.config.spec.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/package.json` (add `@nestjs/config`, `dotenv`)

- [ ] **Step 1: Install deps**

```bash
cd /data/github/fapiao/backend
npm install @nestjs/config
```

- [ ] **Step 2: Write the test for env config**

Create `backend/src/config/env.config.spec.ts`:

```ts
import { loadEnvConfig } from './env.config';

describe('loadEnvConfig', () => {
  it('returns typed config when all required vars present', () => {
    const cfg = loadEnvConfig({
      DATABASE_URL: 'mysql://u:p@h:3306/d',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      JWT_ACCESS_TTL: '30m',
      JWT_REFRESH_TTL: '7d',
      OSS_REGION: 'oss-cn-hangzhou',
      OSS_BUCKET: 'b',
      OSS_ACCESS_KEY_ID: 'k',
      OSS_ACCESS_KEY_SECRET: 's',
      OSS_KEY_PREFIX: 'fapiao/',
      OSS_SIGNED_URL_EXPIRES_SEC: '300',
      SUPER_ADMIN_USERNAME: 'admin',
      SUPER_ADMIN_INITIAL_PASSWORD: 'admin123',
    });
    expect(cfg.databaseUrl).toBe('mysql://u:p@h:3306/d');
    expect(cfg.oss.signedUrlExpiresSec).toBe(300);
  });

  it('throws on missing required var', () => {
    expect(() => loadEnvConfig({})).toThrow(/DATABASE_URL/);
  });
});
```

- [ ] **Step 3: Run test to confirm failure**

```bash
npm test -- env.config
```

Expected: FAIL — `loadEnvConfig` not defined.

- [ ] **Step 4: Implement env.config.ts**

Create `backend/src/config/env.config.ts`:

```ts
export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  oss: {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
    keyPrefix: string;
    signedUrlExpiresSec: number;
  };
  superAdmin: {
    username: string;
    initialPassword: string;
  };
}

const REQUIRED = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'OSS_REGION',
  'OSS_BUCKET',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'SUPER_ADMIN_USERNAME',
  'SUPER_ADMIN_INITIAL_PASSWORD',
] as const;

export function loadEnvConfig(env: NodeJS.ProcessEnv | Record<string, string>): AppConfig {
  for (const key of REQUIRED) {
    if (!env[key]) throw new Error(`Missing required env var: ${key}`);
  }
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL!,
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET!,
      refreshSecret: env.JWT_REFRESH_SECRET!,
      accessTtl: env.JWT_ACCESS_TTL ?? '30m',
      refreshTtl: env.JWT_REFRESH_TTL ?? '7d',
    },
    oss: {
      region: env.OSS_REGION!,
      bucket: env.OSS_BUCKET!,
      accessKeyId: env.OSS_ACCESS_KEY_ID!,
      accessKeySecret: env.OSS_ACCESS_KEY_SECRET!,
      keyPrefix: env.OSS_KEY_PREFIX ?? 'fapiao/',
      signedUrlExpiresSec: Number(env.OSS_SIGNED_URL_EXPIRES_SEC ?? 300),
    },
    superAdmin: {
      username: env.SUPER_ADMIN_USERNAME!,
      initialPassword: env.SUPER_ADMIN_INITIAL_PASSWORD!,
    },
  };
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- env.config
```

Expected: 2 passed.

- [ ] **Step 6: Wire ConfigModule and load .env from project root**

Edit `backend/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { AppController } from './app.controller';
import { loadEnvConfig } from './config/env.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '..', '.env'), join(process.cwd(), '.env')],
      load: [() => ({ app: loadEnvConfig(process.env) })],
    }),
  ],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): typed env config with @nestjs/config"
```

---

## Task 3: Prisma + database schema

**Files:**
- Create: `backend/prisma/schema.prisma`, `backend/src/prisma/prisma.service.ts`, `backend/src/prisma/prisma.module.ts`
- Modify: `backend/src/app.module.ts`, `backend/package.json`

- [ ] **Step 1: Install Prisma**

```bash
cd /data/github/fapiao/backend
npm install prisma --save-dev
npm install @prisma/client
npx prisma init --datasource-provider mysql
```

This creates `prisma/schema.prisma` and adds `DATABASE_URL` to `.env` — delete the new `.env` line Prisma added in `backend/.env` (we use the project-root `.env` instead) and remove the file if it's now empty.

- [ ] **Step 2: Replace schema.prisma with full schema**

Replace `backend/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum Role {
  super_admin
  team_admin
  operator
}

enum TeamStatus {
  active
  disabled
}

enum UserStatus {
  active
  disabled
}

enum PaymentMethod {
  cash
  online
}

enum InvoiceStatus {
  unprocessed
  processed
}

enum InvoiceType {
  catering
  fuel
  consumable
  printing
  other
}

model Team {
  id        BigInt     @id @default(autoincrement())
  name      String     @unique @db.VarChar(64)
  status    TeamStatus @default(active)
  createdAt DateTime   @default(now()) @map("created_at")
  users     User[]
  invoices  Invoice[]
  @@map("teams")
}

model User {
  id                  BigInt     @id @default(autoincrement())
  teamId              BigInt?    @map("team_id")
  username            String     @unique @db.VarChar(64)
  passwordHash        String     @map("password_hash") @db.VarChar(255)
  role                Role
  mustChangePassword  Boolean    @default(true) @map("must_change_password")
  status              UserStatus @default(active)
  lastLoginAt         DateTime?  @map("last_login_at")
  createdAt           DateTime   @default(now()) @map("created_at")
  team                Team?      @relation(fields: [teamId], references: [id])
  invoices            Invoice[]  @relation("InvoiceOperator")
  @@index([teamId, role])
  @@map("users")
}

model Invoice {
  id             BigInt          @id @default(autoincrement())
  teamId         BigInt          @map("team_id")
  operatorId     BigInt          @map("operator_id")
  amount         Decimal?        @db.Decimal(12, 2)
  invoiceType    InvoiceType?    @map("invoice_type")
  paymentMethod  PaymentMethod   @map("payment_method")
  status         InvoiceStatus   @default(unprocessed)
  remark         String?         @db.VarChar(200)
  createdAt      DateTime        @default(now()) @map("created_at")
  updatedAt      DateTime        @updatedAt @map("updated_at")
  processedAt    DateTime?       @map("processed_at")
  processedBy    BigInt?         @map("processed_by")
  deletedAt      DateTime?       @map("deleted_at")
  team           Team            @relation(fields: [teamId], references: [id])
  operator       User            @relation("InvoiceOperator", fields: [operatorId], references: [id])
  invoiceImages  InvoiceImage[]
  proofImages    PaymentProofImage[]
  @@index([teamId, status])
  @@index([teamId, operatorId])
  @@index([createdAt])
  @@map("invoices")
}

model InvoiceImage {
  id                BigInt   @id @default(autoincrement())
  invoiceId         BigInt   @map("invoice_id")
  ossKey            String   @map("oss_key") @db.VarChar(512)
  originalFilename  String   @map("original_filename") @db.VarChar(255)
  sizeBytes         Int      @map("size_bytes")
  uploadedAt        DateTime @default(now()) @map("uploaded_at")
  invoice           Invoice  @relation(fields: [invoiceId], references: [id])
  @@index([invoiceId])
  @@map("invoice_images")
}

model PaymentProofImage {
  id                BigInt   @id @default(autoincrement())
  invoiceId         BigInt   @map("invoice_id")
  ossKey            String   @map("oss_key") @db.VarChar(512)
  originalFilename  String   @map("original_filename") @db.VarChar(255)
  sizeBytes         Int      @map("size_bytes")
  uploadedAt        DateTime @default(now()) @map("uploaded_at")
  invoice           Invoice  @relation(fields: [invoiceId], references: [id])
  @@index([invoiceId])
  @@map("payment_proof_images")
}
```

- [ ] **Step 3: Generate first migration**

Make sure project-root `.env` has working `DATABASE_URL`. From `/data/github/fapiao/backend`:

```bash
DATABASE_URL="$(grep '^DATABASE_URL' ../.env | cut -d= -f2-)" npx prisma migrate dev --name init
```

Expected: migration file created in `prisma/migrations/<timestamp>_init/migration.sql`, MySQL has 5 new tables.

- [ ] **Step 4: Verify schema applied**

```bash
DATABASE_URL="$(grep '^DATABASE_URL' ../.env | cut -d= -f2-)" npx prisma db pull --print | head -30
```

Expected: prints 5 tables.

- [ ] **Step 5: Add PrismaService**

Create `backend/src/prisma/prisma.service.ts`:

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Create `backend/src/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Update `backend/src/app.module.ts` to import `PrismaModule`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { AppController } from './app.controller';
import { loadEnvConfig } from './config/env.config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '..', '.env'), join(process.cwd(), '.env')],
      load: [() => ({ app: loadEnvConfig(process.env) })],
    }),
    PrismaModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 6: Add bigint JSON serialization in main.ts**

Prisma returns BigInt; JSON.stringify can't serialize. Add to `backend/src/main.ts` before `bootstrap()`:

```ts
// Serialize BigInt as string in JSON responses
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
```

- [ ] **Step 7: Commit**

```bash
git add backend prisma
git commit -m "feat(backend): prisma schema + initial migration for 5 tables"
```

---

## Task 4: Password service (bcrypt, TDD)

**Files:**
- Create: `backend/src/common/crypto/password.service.ts`, `backend/src/common/crypto/password.service.spec.ts`

- [ ] **Step 1: Install bcrypt**

```bash
cd /data/github/fapiao/backend
npm install bcrypt
npm install --save-dev @types/bcrypt
```

- [ ] **Step 2: Write failing test**

Create `backend/src/common/crypto/password.service.spec.ts`:

```ts
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes a password to a non-empty string different from input', async () => {
    const hash = await svc.hash('admin123');
    expect(hash).toBeTruthy();
    expect(hash).not.toBe('admin123');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies the correct password', async () => {
    const hash = await svc.hash('s3cret!');
    await expect(svc.verify('s3cret!', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await svc.hash('s3cret!');
    await expect(svc.verify('nope', hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

```bash
npm test -- password.service
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `backend/src/common/crypto/password.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordService {
  private readonly cost = 10;

  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
```

- [ ] **Step 5: Run test to verify pass**

```bash
npm test -- password.service
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): password service (bcrypt cost 10)"
```

---

## Task 5: Super admin seed script

**Files:**
- Create: `backend/prisma/seed.ts`
- Modify: `backend/package.json` (add `prisma.seed`)

- [ ] **Step 1: Add ts-node dep and prisma seed config**

```bash
cd /data/github/fapiao/backend
npm install --save-dev ts-node
```

Edit `backend/package.json` — add at top level:

```json
"prisma": {
  "seed": "ts-node prisma/seed.ts"
}
```

- [ ] **Step 2: Write seed script**

Create `backend/prisma/seed.ts`:

```ts
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SUPER_ADMIN_USERNAME;
  const initialPassword = process.env.SUPER_ADMIN_INITIAL_PASSWORD;
  if (!username || !initialPassword) {
    throw new Error('SUPER_ADMIN_USERNAME or SUPER_ADMIN_INITIAL_PASSWORD missing');
  }
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`super_admin "${username}" already exists, skipping`);
    return;
  }
  const passwordHash = await bcrypt.hash(initialPassword, 10);
  await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: Role.super_admin,
      mustChangePassword: true,
    },
  });
  console.log(`super_admin "${username}" created (must change password on first login)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Run seed**

```bash
cd /data/github/fapiao/backend
set -a; source ../.env; set +a
npx prisma db seed
```

Expected: prints `super_admin "admin" created`. Re-running prints `already exists, skipping`.

- [ ] **Step 4: Commit**

```bash
git add backend
git commit -m "feat(backend): super_admin seed script (idempotent)"
```

---

## Task 6: JWT auth service — login & token issuance (TDD)

**Files:**
- Create: `backend/src/auth/auth.module.ts`, `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.service.spec.ts`, `backend/src/auth/types/jwt-payload.type.ts`, `backend/src/auth/dto/login.dto.ts`

- [ ] **Step 1: Install JWT module**

```bash
cd /data/github/fapiao/backend
npm install @nestjs/jwt
```

- [ ] **Step 2: Define JWT payload type**

Create `backend/src/auth/types/jwt-payload.type.ts`:

```ts
import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;        // user id as string
  username: string;
  role: Role;
  teamId: string | null;
  type: 'access' | 'refresh';
}
```

- [ ] **Step 3: Write LoginDto**

Create `backend/src/auth/dto/login.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
```

- [ ] **Step 4: Write failing test for AuthService.login**

Create `backend/src/auth/auth.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { PasswordService } from '../common/crypto/password.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService.login', () => {
  let svc: AuthService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
  let pwd: PasswordService;

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockImplementation(async (p, o) => `tok-${p.type}`),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string) => {
              if (k === 'app') {
                return {
                  jwt: {
                    accessSecret: 'a',
                    refreshSecret: 'b',
                    accessTtl: '30m',
                    refreshTtl: '7d',
                  },
                };
              }
            }),
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(AuthService);
    pwd = moduleRef.get(PasswordService);
  });

  it('returns tokens and user on correct credentials', async () => {
    const hash = await pwd.hash('admin123');
    prisma.user.findUnique.mockResolvedValue({
      id: 1n,
      username: 'admin',
      passwordHash: hash,
      role: Role.super_admin,
      teamId: null,
      mustChangePassword: true,
      status: UserStatus.active,
    });
    prisma.user.update.mockResolvedValue({});
    const result = await svc.login('admin', 'admin123');
    expect(result.accessToken).toBe('tok-access');
    expect(result.refreshToken).toBe('tok-refresh');
    expect(result.mustChangePassword).toBe(true);
    expect(result.user.username).toBe('admin');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastLoginAt: expect.any(Date) }) }),
    );
  });

  it('rejects unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.login('nobody', 'x')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects wrong password', async () => {
    const hash = await pwd.hash('correct');
    prisma.user.findUnique.mockResolvedValue({
      id: 1n,
      username: 'u',
      passwordHash: hash,
      role: Role.operator,
      teamId: 1n,
      mustChangePassword: false,
      status: UserStatus.active,
    });
    await expect(svc.login('u', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects disabled user', async () => {
    const hash = await pwd.hash('p');
    prisma.user.findUnique.mockResolvedValue({
      id: 1n,
      username: 'u',
      passwordHash: hash,
      role: Role.operator,
      teamId: 1n,
      mustChangePassword: false,
      status: UserStatus.disabled,
    });
    await expect(svc.login('u', 'p')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 5: Run test to verify failure**

```bash
npm test -- auth.service
```

Expected: FAIL — `AuthService` not found.

- [ ] **Step 6: Implement AuthService**

Create `backend/src/auth/auth.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../common/crypto/password.service';
import { JwtPayload } from './types/jwt-payload.type';
import { AppConfig } from '../config/env.config';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private cfg() {
    return this.config.get<AppConfig>('app')!;
  }

  async login(username: string, plainPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) throw new UnauthorizedException('invalid credentials');
    if (user.status === UserStatus.disabled) throw new UnauthorizedException('account disabled');
    const ok = await this.password.verify(plainPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens({
      sub: user.id.toString(),
      username: user.username,
      role: user.role,
      teamId: user.teamId?.toString() ?? null,
    });

    return {
      ...tokens,
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id.toString(),
        username: user.username,
        role: user.role,
        teamId: user.teamId?.toString() ?? null,
      },
    };
  }

  async issueTokens(base: Omit<JwtPayload, 'type'>) {
    const { accessSecret, refreshSecret, accessTtl, refreshTtl } = this.cfg().jwt;
    const accessToken = await this.jwt.signAsync(
      { ...base, type: 'access' } as JwtPayload,
      { secret: accessSecret, expiresIn: accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { ...base, type: 'refresh' } as JwtPayload,
      { secret: refreshSecret, expiresIn: refreshTtl },
    );
    return { accessToken, refreshToken };
  }
}
```

- [ ] **Step 7: Wire AuthModule**

Create `backend/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PasswordService } from '../common/crypto/password.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService, PasswordService],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
```

- [ ] **Step 8: Run test to verify pass**

```bash
npm test -- auth.service
```

Expected: 4 passed.

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat(backend): AuthService.login with JWT issuance"
```

---

## Task 7: Auth refresh + change-password (TDD)

**Files:**
- Modify: `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.service.spec.ts`
- Create: `backend/src/auth/dto/refresh.dto.ts`, `backend/src/auth/dto/change-password.dto.ts`

- [ ] **Step 1: Add DTOs**

Create `backend/src/auth/dto/refresh.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
```

Create `backend/src/auth/dto/change-password.dto.ts`:

```ts
import { IsString, Matches, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'password must be ≥ 8 chars' })
  @Matches(/[A-Za-z]/, { message: 'password must contain a letter' })
  @Matches(/[0-9]/, { message: 'password must contain a digit' })
  newPassword!: string;
}
```

- [ ] **Step 2: Append tests for refresh & changePassword**

Append to `backend/src/auth/auth.service.spec.ts`:

```ts
describe('AuthService.refresh', () => {
  let svc: AuthService;
  let prisma: any;
  let jwt: { verifyAsync: jest.Mock; signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };
    jwt = {
      verifyAsync: jest.fn(),
      signAsync: jest.fn().mockImplementation(async (p) => `tok-${p.type}`),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: () => ({
              jwt: { accessSecret: 'a', refreshSecret: 'b', accessTtl: '30m', refreshTtl: '7d' },
            }),
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(AuthService);
  });

  it('issues new tokens for valid refresh', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: '1', username: 'u', role: Role.operator, teamId: '2', type: 'refresh',
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 1n, username: 'u', role: Role.operator, teamId: 2n, status: UserStatus.active,
    });
    const out = await svc.refresh('rtok');
    expect(out.accessToken).toBe('tok-access');
    expect(out.refreshToken).toBe('tok-refresh');
  });

  it('rejects an access-typed token', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: '1', username: 'u', role: Role.operator, teamId: '2', type: 'access',
    });
    await expect(svc.refresh('atok')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when user is gone or disabled', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: '99', username: 'u', role: Role.operator, teamId: '2', type: 'refresh',
    });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.refresh('rtok')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.changePassword', () => {
  let svc: AuthService;
  let prisma: any;
  let pwd: PasswordService;

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => ({ jwt: {} }) } },
      ],
    }).compile();
    svc = moduleRef.get(AuthService);
    pwd = moduleRef.get(PasswordService);
  });

  it('hashes new password and clears mustChangePassword flag', async () => {
    const hash = await pwd.hash('oldpass1');
    prisma.user.findUnique.mockResolvedValue({
      id: 1n, passwordHash: hash, status: UserStatus.active,
    });
    prisma.user.update.mockResolvedValue({});
    await svc.changePassword(1n, 'oldpass1', 'newpass2');
    const updateArgs = prisma.user.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 1n });
    expect(updateArgs.data.mustChangePassword).toBe(false);
    expect(updateArgs.data.passwordHash).not.toBe(hash);
    await expect(pwd.verify('newpass2', updateArgs.data.passwordHash)).resolves.toBe(true);
  });

  it('rejects wrong current password', async () => {
    const hash = await pwd.hash('correct');
    prisma.user.findUnique.mockResolvedValue({
      id: 1n, passwordHash: hash, status: UserStatus.active,
    });
    await expect(svc.changePassword(1n, 'wrong', 'newpass2')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
npm test -- auth.service
```

Expected: FAIL — `svc.refresh` / `svc.changePassword` not defined.

- [ ] **Step 4: Add refresh & changePassword to AuthService**

Append to `backend/src/auth/auth.service.ts`:

```ts
  async refresh(refreshToken: string) {
    const cfg = this.cfg();
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: cfg.jwt.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('invalid refresh token');
    }
    if (payload.type !== 'refresh') throw new UnauthorizedException('not a refresh token');
    const user = await this.prisma.user.findUnique({ where: { id: BigInt(payload.sub) } });
    if (!user || user.status === UserStatus.disabled) throw new UnauthorizedException();
    return this.issueTokens({
      sub: user.id.toString(),
      username: user.username,
      role: user.role,
      teamId: user.teamId?.toString() ?? null,
    });
  }

  async changePassword(userId: bigint, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === UserStatus.disabled) throw new UnauthorizedException();
    const ok = await this.password.verify(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('current password mismatch');
    const newHash = await this.password.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, mustChangePassword: false },
    });
  }
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npm test -- auth.service
```

Expected: all auth.service tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): refresh + changePassword on AuthService"
```

---

## Task 8: Auth controller

**Files:**
- Create: `backend/src/auth/auth.controller.ts`, `backend/src/common/decorators/public.decorator.ts`, `backend/src/common/decorators/current-user.decorator.ts`
- Modify: `backend/src/auth/auth.module.ts`, `backend/src/app.module.ts`

- [ ] **Step 1: Create decorators**

Create `backend/src/common/decorators/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

Create `backend/src/common/decorators/current-user.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../../auth/types/jwt-payload.type';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtPayload => {
  return ctx.switchToHttp().getRequest().user;
});
```

- [ ] **Step 2: Create AuthController**

Create `backend/src/auth/auth.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from './types/jwt-payload.type';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @HttpCode(204)
  @Post('change-password')
  async changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(BigInt(user.sub), dto.currentPassword, dto.newPassword);
  }
}
```

- [ ] **Step 3: Register controller in module**

Replace `backend/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordService } from '../common/crypto/password.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, PasswordService],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
```

Add `AuthModule` to `backend/src/app.module.ts` `imports`.

- [ ] **Step 4: Commit**

```bash
git add backend
git commit -m "feat(backend): auth controller (login/refresh/change-password)"
```

> Tests for the controller are folded into the e2e suite (Task 14) — controller is a thin wrapper.

---

## Task 9: AuthGuard (validate JWT)

**Files:**
- Create: `backend/src/common/guards/auth.guard.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Implement guard**

Create `backend/src/common/guards/auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { AppConfig } from '../../config/env.config';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer');
    const token = auth.slice(7);

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<AppConfig>('app')!.jwt.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('invalid token');
    }
    if (payload.type !== 'access') throw new UnauthorizedException('wrong token type');
    (req as any).user = payload;
    return true;
  }
}
```

- [ ] **Step 2: Register as global guard**

Edit `backend/src/app.module.ts`:

```ts
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './common/guards/auth.guard';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    /* existing… */
    JwtModule.register({}),
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
  /* … */
})
export class AppModule {}
```

- [ ] **Step 3: Smoke test — start app and curl healthz (public) and a protected route**

We don't yet have a protected route, but `change-password` is. Defer to e2e in Task 14.

- [ ] **Step 4: Commit**

```bash
git add backend
git commit -m "feat(backend): global AuthGuard validates access JWT"
```

---

## Task 10: RolesGuard + TeamScopeGuard

**Files:**
- Create: `backend/src/common/guards/roles.guard.ts`, `backend/src/common/guards/team-scope.guard.ts`, `backend/src/common/decorators/roles.decorator.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Roles decorator**

Create `backend/src/common/decorators/roles.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 2: RolesGuard**

Create `backend/src/common/guards/roles.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../../auth/types/jwt-payload.type';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = ctx.switchToHttp().getRequest().user as JwtPayload | undefined;
    if (!user) throw new ForbiddenException('no user');
    if (!required.includes(user.role)) throw new ForbiddenException(`requires role ${required.join('|')}`);
    return true;
  }
}
```

- [ ] **Step 3: TeamScopeGuard**

Create `backend/src/common/guards/team-scope.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtPayload } from '../../auth/types/jwt-payload.type';

@Injectable()
export class TeamScopeGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtPayload | undefined;
    if (!user) throw new ForbiddenException();
    if (user.role === Role.super_admin) {
      throw new ForbiddenException('super_admin cannot access team-scoped routes');
    }
    if (!user.teamId) throw new ForbiddenException('user has no team');
    return true;
  }
}
```

- [ ] **Step 4: Register RolesGuard globally**

In `backend/src/app.module.ts` providers:

```ts
{ provide: APP_GUARD, useClass: AuthGuard },
{ provide: APP_GUARD, useClass: RolesGuard },
```

`TeamScopeGuard` will be applied per-controller via `@UseGuards()` (not global, since super-admin routes don't want it).

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): RolesGuard + TeamScopeGuard"
```

---

## Task 11: Teams service & controller (super_admin)

**Files:**
- Create: `backend/src/teams/teams.module.ts`, `backend/src/teams/teams.service.ts`, `backend/src/teams/teams.service.spec.ts`, `backend/src/teams/teams.controller.ts`, `backend/src/teams/dto/create-team.dto.ts`, `backend/src/teams/dto/update-team.dto.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: DTOs**

Create `backend/src/teams/dto/create-team.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;
}
```

Create `backend/src/teams/dto/update-team.dto.ts`:

```ts
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TeamStatus } from '@prisma/client';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsEnum(TeamStatus)
  status?: TeamStatus;
}
```

- [ ] **Step 2: Write failing test for service**

Create `backend/src/teams/teams.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TeamStatus } from '@prisma/client';
import { TeamsService } from './teams.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TeamsService', () => {
  let svc: TeamsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      team: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [TeamsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = moduleRef.get(TeamsService);
  });

  it('creates a team', async () => {
    prisma.team.create.mockResolvedValue({ id: 1n, name: 'A', status: 'active', createdAt: new Date() });
    const t = await svc.create('A');
    expect(t.name).toBe('A');
  });

  it('rejects duplicate name', async () => {
    prisma.team.create.mockRejectedValue({ code: 'P2002' });
    await expect(svc.create('A')).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists teams', async () => {
    prisma.team.findMany.mockResolvedValue([{ id: 1n, name: 'A' }]);
    const list = await svc.list();
    expect(list).toHaveLength(1);
  });

  it('updates status', async () => {
    prisma.team.findUnique.mockResolvedValue({ id: 1n });
    prisma.team.update.mockResolvedValue({ id: 1n, status: TeamStatus.disabled });
    const t = await svc.update(1n, { status: TeamStatus.disabled });
    expect(t.status).toBe(TeamStatus.disabled);
  });

  it('update throws on missing team', async () => {
    prisma.team.findUnique.mockResolvedValue(null);
    await expect(svc.update(99n, { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

```bash
npm test -- teams.service
```

Expected: FAIL — `TeamsService` not found.

- [ ] **Step 4: Implement service**

Create `backend/src/teams/teams.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTeamDto } from './dto/update-team.dto';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string) {
    try {
      return await this.prisma.team.create({ data: { name } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`team name "${name}" already exists`);
      }
      // Mocks throw plain { code }, accept that too
      if ((e as any)?.code === 'P2002') {
        throw new ConflictException(`team name "${name}" already exists`);
      }
      throw e;
    }
  }

  list() {
    return this.prisma.team.findMany({ orderBy: { id: 'asc' } });
  }

  async update(id: bigint, dto: UpdateTeamDto) {
    const existing = await this.prisma.team.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`team ${id} not found`);
    return this.prisma.team.update({ where: { id }, data: dto });
  }
}
```

- [ ] **Step 5: Run test to verify pass**

```bash
npm test -- teams.service
```

Expected: 5 passed.

- [ ] **Step 6: Implement controller**

Create `backend/src/teams/teams.controller.ts`:

```ts
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
```

- [ ] **Step 7: Module + register**

Create `backend/src/teams/teams.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';

@Module({
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
```

Add `TeamsModule` to `app.module.ts` imports.

- [ ] **Step 8: Commit**

```bash
git add backend
git commit -m "feat(backend): super_admin team CRUD"
```

---

## Task 12: Team-admin user management (super_admin scope)

**Files:**
- Create: `backend/src/users/users.module.ts`, `backend/src/users/users.service.ts`, `backend/src/users/users.service.spec.ts`, `backend/src/users/super-users.controller.ts`, `backend/src/users/dto/create-team-admin.dto.ts`, `backend/src/users/dto/reset-password.dto.ts`, `backend/src/users/dto/update-user-status.dto.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: DTOs**

Create `backend/src/users/dto/create-team-admin.dto.ts`:

```ts
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTeamAdminDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'username allows only letters/digits/._-' })
  username!: string;

  @IsString()
  @MinLength(8)
  initialPassword!: string;
}
```

Create `backend/src/users/dto/reset-password.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
```

Create `backend/src/users/dto/update-user-status.dto.ts`:

```ts
import { IsEnum } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}
```

- [ ] **Step 2: Service tests (TDD)**

Create `backend/src/users/users.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../common/crypto/password.service';

describe('UsersService.createTeamAdmin', () => {
  let svc: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      team: { findUnique: jest.fn() },
      user: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        PasswordService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(UsersService);
  });

  it('creates admin under existing team', async () => {
    prisma.team.findUnique.mockResolvedValue({ id: 1n, status: 'active' });
    prisma.user.create.mockResolvedValue({
      id: 2n, username: 'a1', role: Role.team_admin, teamId: 1n, mustChangePassword: true,
    });
    const u = await svc.createTeamAdmin(1n, 'a1', 'init1234');
    expect(u.username).toBe('a1');
    const args = prisma.user.create.mock.calls[0][0];
    expect(args.data.role).toBe(Role.team_admin);
    expect(args.data.mustChangePassword).toBe(true);
  });

  it('rejects creating under missing team', async () => {
    prisma.team.findUnique.mockResolvedValue(null);
    await expect(svc.createTeamAdmin(99n, 'a1', 'init1234')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps duplicate username to ConflictException', async () => {
    prisma.team.findUnique.mockResolvedValue({ id: 1n, status: 'active' });
    prisma.user.create.mockRejectedValue({ code: 'P2002' });
    await expect(svc.createTeamAdmin(1n, 'a1', 'init1234')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('UsersService.resetPassword', () => {
  let svc: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        PasswordService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(UsersService);
  });

  it('rehashes and re-arms mustChangePassword', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 5n, role: Role.team_admin });
    prisma.user.update.mockResolvedValue({});
    await svc.resetPassword(5n, 'newpass1');
    const args = prisma.user.update.mock.calls[0][0];
    expect(args.data.mustChangePassword).toBe(true);
    expect(args.data.passwordHash).toBeTruthy();
  });
});

describe('UsersService.setStatus', () => {
  let svc: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        PasswordService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(UsersService);
  });

  it('disables an active user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 5n });
    prisma.user.update.mockResolvedValue({ id: 5n, status: UserStatus.disabled });
    const u = await svc.setStatus(5n, UserStatus.disabled);
    expect(u.status).toBe(UserStatus.disabled);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
npm test -- users.service
```

Expected: FAIL — module missing.

- [ ] **Step 4: Implement UsersService**

Create `backend/src/users/users.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../common/crypto/password.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
  ) {}

  async createTeamAdmin(teamId: bigint, username: string, initialPassword: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException(`team ${teamId} not found`);
    return this.createUser({ teamId, username, password: initialPassword, role: Role.team_admin });
  }

  async createOperator(teamId: bigint, username: string, initialPassword: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException(`team ${teamId} not found`);
    return this.createUser({ teamId, username, password: initialPassword, role: Role.operator });
  }

  private async createUser(args: { teamId: bigint; username: string; password: string; role: Role }) {
    const hash = await this.password.hash(args.password);
    try {
      return await this.prisma.user.create({
        data: {
          teamId: args.teamId,
          username: args.username,
          passwordHash: hash,
          role: args.role,
          mustChangePassword: true,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`username "${args.username}" exists`);
      throw e;
    }
  }

  listByTeamAndRole(teamId: bigint, role: Role) {
    return this.prisma.user.findMany({
      where: { teamId, role },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  async resetPassword(userId: bigint, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`user ${userId} not found`);
    const hash = await this.password.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash, mustChangePassword: true },
    });
  }

  async setStatus(userId: bigint, status: UserStatus) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`user ${userId} not found`);
    return this.prisma.user.update({ where: { id: userId }, data: { status } });
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npm test -- users.service
```

Expected: all users.service tests pass.

- [ ] **Step 6: Super admins controller**

Create `backend/src/users/super-users.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateTeamAdminDto } from './dto/create-team-admin.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('super/teams/:teamId/admins')
@Roles(Role.super_admin)
export class SuperUsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Param('teamId') teamId: string, @Body() dto: CreateTeamAdminDto) {
    return this.users.createTeamAdmin(BigInt(teamId), dto.username, dto.initialPassword);
  }

  @Get()
  list(@Param('teamId') teamId: string) {
    return this.users.listByTeamAndRole(BigInt(teamId), Role.team_admin);
  }

  @Patch(':userId/password')
  reset(@Param('userId') userId: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(BigInt(userId), dto.newPassword);
  }

  @Patch(':userId/status')
  setStatus(@Param('userId') userId: string, @Body() dto: UpdateUserStatusDto) {
    return this.users.setStatus(BigInt(userId), dto.status);
  }
}
```

- [ ] **Step 7: Module**

Create `backend/src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { SuperUsersController } from './super-users.controller';
import { PasswordService } from '../common/crypto/password.service';

@Module({
  controllers: [SuperUsersController],
  providers: [UsersService, PasswordService],
  exports: [UsersService],
})
export class UsersModule {}
```

Add `UsersModule` to `app.module.ts`.

- [ ] **Step 8: Commit**

```bash
git add backend
git commit -m "feat(backend): super_admin can manage team admins"
```

---

## Task 13: Operator management (team_admin scope)

**Files:**
- Create: `backend/src/users/operators.controller.ts`, `backend/src/users/dto/create-operator.dto.ts`
- Modify: `backend/src/users/users.module.ts`

- [ ] **Step 1: DTO**

Create `backend/src/users/dto/create-operator.dto.ts`:

```ts
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateOperatorDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'username allows only letters/digits/._-' })
  username!: string;

  @IsString()
  @MinLength(8)
  initialPassword!: string;
}
```

- [ ] **Step 2: Controller**

Create `backend/src/users/operators.controller.ts`:

```ts
import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateOperatorDto } from './dto/create-operator.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TeamScopeGuard } from '../common/guards/team-scope.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('admin/operators')
@Roles(Role.team_admin)
@UseGuards(TeamScopeGuard)
export class OperatorsController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@CurrentUser() me: JwtPayload, @Body() dto: CreateOperatorDto) {
    return this.users.createOperator(BigInt(me.teamId!), dto.username, dto.initialPassword);
  }

  @Get()
  list(@CurrentUser() me: JwtPayload) {
    return this.users.listByTeamAndRole(BigInt(me.teamId!), Role.operator);
  }

  @Patch(':userId/password')
  async reset(
    @CurrentUser() me: JwtPayload,
    @Param('userId') userId: string,
    @Body() dto: ResetPasswordDto,
  ) {
    await this.assertSameTeam(me, BigInt(userId));
    return this.users.resetPassword(BigInt(userId), dto.newPassword);
  }

  @Patch(':userId/status')
  async setStatus(
    @CurrentUser() me: JwtPayload,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    await this.assertSameTeam(me, BigInt(userId));
    return this.users.setStatus(BigInt(userId), dto.status);
  }

  private async assertSameTeam(me: JwtPayload, userId: bigint) {
    const target = await this.users.getById(userId);
    if (!target || target.teamId?.toString() !== me.teamId) {
      // 404 rather than 403 to avoid information leak
      throw new NotFoundException(`user ${userId} not found in your team`);
    }
  }
}
```

- [ ] **Step 3: Add `getById` helper to UsersService**

Append to `backend/src/users/users.service.ts`:

```ts
  getById(userId: bigint) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }
```

- [ ] **Step 4: Register controller**

Edit `backend/src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { SuperUsersController } from './super-users.controller';
import { OperatorsController } from './operators.controller';
import { PasswordService } from '../common/crypto/password.service';

@Module({
  controllers: [SuperUsersController, OperatorsController],
  providers: [UsersService, PasswordService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): team_admin can manage operators in own team"
```

---

## Task 14: Full e2e test (auth + super flow + team flow)

**Files:**
- Create: `backend/test/auth.e2e-spec.ts`
- Modify: `backend/test/jest-e2e.json` (Nest CLI generated this)

This e2e test boots the real app against the real MySQL (the same `fapiao_db`), wipes the user/team tables, runs the seed, and exercises the whole flow end to end.

- [ ] **Step 1: Helper — clean DB at start**

Create `backend/test/auth.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';

describe('e2e: auth + super_admin + team_admin + operator', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    // Clean order respects FKs
    await prisma.paymentProofImage.deleteMany();
    await prisma.invoiceImage.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.user.deleteMany();
    await prisma.team.deleteMany();

    // Re-seed super admin
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

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let superAccess: string;
  let teamAdminAccess: string;
  let operatorAccess: string;
  let teamId: string;
  let teamAdminId: string;
  let operatorId: string;

  it('super_admin logs in', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: process.env.SUPER_ADMIN_USERNAME, password: process.env.SUPER_ADMIN_INITIAL_PASSWORD })
      .expect(200);
    expect(res.body.mustChangePassword).toBe(true);
    superAccess = res.body.accessToken;
  });

  it('super_admin creates a team', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/super/teams')
      .set('Authorization', `Bearer ${superAccess}`)
      .send({ name: 'TeamA' })
      .expect(201);
    teamId = res.body.id;
  });

  it('super_admin creates a team_admin', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/super/teams/${teamId}/admins`)
      .set('Authorization', `Bearer ${superAccess}`)
      .send({ username: 'admin_a', initialPassword: 'initpass1' })
      .expect(201);
    teamAdminId = res.body.id;
  });

  it('team_admin first login signals must_change_password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin_a', password: 'initpass1' })
      .expect(200);
    expect(res.body.mustChangePassword).toBe(true);
    teamAdminAccess = res.body.accessToken;
  });

  it('team_admin changes password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${teamAdminAccess}`)
      .send({ currentPassword: 'initpass1', newPassword: 'realpass2' })
      .expect(204);
  });

  it('team_admin creates an operator', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/operators')
      .set('Authorization', `Bearer ${teamAdminAccess}`)
      .send({ username: 'op_a', initialPassword: 'opinit12' })
      .expect(201);
    operatorId = res.body.id;
  });

  it('operator logs in', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'op_a', password: 'opinit12' })
      .expect(200);
    operatorAccess = res.body.accessToken;
  });

  it('operator cannot list other team operators', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/operators')
      .set('Authorization', `Bearer ${operatorAccess}`)
      .expect(403);
  });

  it('super_admin cannot hit team-scoped routes', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/operators')
      .set('Authorization', `Bearer ${superAccess}`)
      .expect(403);
  });

  it('team_admin cannot hit super-only routes', async () => {
    await request(app.getHttpServer())
      .get('/api/super/teams')
      .set('Authorization', `Bearer ${teamAdminAccess}`)
      .expect(403);
  });

  it('operator can refresh tokens', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'op_a', password: 'opinit12' });
    const refresh = login.body.refreshToken;
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: refresh })
      .expect(200);
    expect(res.body.accessToken).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run e2e**

```bash
cd /data/github/fapiao/backend
set -a; source ../.env; set +a
npm run test:e2e -- auth.e2e-spec.ts
```

Expected: all assertions pass. If anything fails, fix the implementation, not the test.

- [ ] **Step 3: Commit**

```bash
git add backend
git commit -m "test(backend): full auth + role + team-scope e2e"
```

---

## Task 15: Wire startup-time seed + README

**Files:**
- Modify: `backend/src/main.ts`, `backend/package.json`
- Create: `backend/README.md`

- [ ] **Step 1: Run seed automatically on app start in dev**

Edit `backend/src/main.ts`, after creating the app and before `listen`:

```ts
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { PasswordService } from './common/crypto/password.service';

// inside bootstrap(), after app creation:
const config = app.get(ConfigService);
const prisma = app.get(PrismaService);
const password = app.get(PasswordService);
const sa = config.get<any>('app').superAdmin;
const existing = await prisma.user.findUnique({ where: { username: sa.username } });
if (!existing) {
  await prisma.user.create({
    data: {
      username: sa.username,
      passwordHash: await password.hash(sa.initialPassword),
      role: 'super_admin',
      mustChangePassword: true,
    },
  });
  console.log(`bootstrapped super_admin "${sa.username}"`);
}
```

> This is idempotent and lets `npm run start` work on a fresh DB without needing to remember the seed step.

- [ ] **Step 2: README**

Create `backend/README.md`:

```markdown
# fapiao backend (M1)

## Local dev

```bash
cd backend
npm install
# .env lives at project root; backend reads ../.env
npx prisma migrate dev
npm run start:dev
```

Healthcheck: <http://localhost:3000/api/healthz>

## Tests

```bash
npm test            # unit
npm run test:e2e    # end-to-end (uses real MySQL — wipes tables!)
```

## Endpoints (M1)

| Method | Path | Role |
|---|---|---|
| POST | /api/auth/login | public |
| POST | /api/auth/refresh | public |
| POST | /api/auth/change-password | any authed |
| GET / POST / PATCH | /api/super/teams[/:id] | super_admin |
| GET / POST | /api/super/teams/:teamId/admins | super_admin |
| PATCH | /api/super/teams/:teamId/admins/:userId/password | super_admin |
| PATCH | /api/super/teams/:teamId/admins/:userId/status | super_admin |
| GET / POST | /api/admin/operators | team_admin |
| PATCH | /api/admin/operators/:userId/password | team_admin |
| PATCH | /api/admin/operators/:userId/status | team_admin |
```

- [ ] **Step 3: Commit**

```bash
git add backend
git commit -m "chore(backend): auto-seed super_admin on boot + README"
```

---

## Verification (run before declaring M1 done)

- [ ] `cd backend && npm test` — all unit tests green
- [ ] `npm run test:e2e` — all e2e tests green
- [ ] `npm run start` — boots, prints `listening on :3000`, healthz returns `{ ok: true }`
- [ ] Manual sanity:
  ```bash
  curl -s -X POST localhost:3000/api/auth/login \
    -H 'content-type: application/json' \
    -d "{\"username\":\"$SUPER_ADMIN_USERNAME\",\"password\":\"$SUPER_ADMIN_INITIAL_PASSWORD\"}" | jq
  ```
  Returns `accessToken`, `refreshToken`, `mustChangePassword: true`.
- [ ] Push to GitHub: `git push`

---

## Out of scope for this plan (handled in plan-02 onwards)

- Invoices CRUD
- OSS upload + signed URL access
- Admin invoice listing/registration/batch process
- Excel + ZIP export
- Frontend (any UI)
- Production deployment
