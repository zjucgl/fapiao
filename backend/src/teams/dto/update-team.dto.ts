import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TeamStatus } from '@prisma/client';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsEnum(TeamStatus)
  status?: TeamStatus;
}
