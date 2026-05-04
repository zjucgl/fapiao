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
