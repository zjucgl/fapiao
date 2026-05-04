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

  getById(userId: bigint) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }
}
