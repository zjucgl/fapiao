import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtPayload } from '../../auth/types/jwt-payload.type';

@Injectable()
export class TeamScopeGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtPayload | undefined;
    if (!user) throw new ForbiddenException();
    if (user.role === Role.super_admin) {
      throw new ForbiddenException('super_admin cannot access team-scoped routes');
    }
    if (!user.teamId) throw new ForbiddenException('user has no team');
    return true;
  }
}
