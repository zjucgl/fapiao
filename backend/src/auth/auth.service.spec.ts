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
