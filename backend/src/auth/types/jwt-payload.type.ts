import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;        // user id as string
  username: string;
  role: Role;
  teamId: string | null;
  type: 'access' | 'refresh';
}
