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
  }, 60000);

  afterAll(async () => {
    for (const k of createdKeys) {
      try { await oss.deleteObject(k); } catch (_) {}
    }
    await app.close();
    await prisma.$disconnect();
  }, 60000);

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
  }, 30000);

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
  }, 60000);

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
  }, 30000);

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
      const dl = await request(app.getHttpServer())
        .get(p.href)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const len = (dl.body as Buffer)?.length ?? (typeof dl.text === 'string' ? dl.text.length : 0);
      expect(len).toBeGreaterThan(80);
    }
  }, 60000);
});
