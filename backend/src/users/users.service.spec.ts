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
