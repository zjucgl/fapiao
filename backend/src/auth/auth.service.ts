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
      { secret: accessSecret, expiresIn: accessTtl as any },
    );
    const refreshToken = await this.jwt.signAsync(
      { ...base, type: 'refresh' } as JwtPayload,
      { secret: refreshSecret, expiresIn: refreshTtl as any },
    );
    return { accessToken, refreshToken };
  }
}
