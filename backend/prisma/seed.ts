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
