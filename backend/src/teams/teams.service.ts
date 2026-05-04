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
