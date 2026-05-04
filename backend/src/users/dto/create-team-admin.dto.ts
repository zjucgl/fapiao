import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTeamAdminDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'username allows only letters/digits/._-' })
  username!: string;

  @IsString()
  @MinLength(8)
  initialPassword!: string;
}
