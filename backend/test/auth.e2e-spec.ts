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
