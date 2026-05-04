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
