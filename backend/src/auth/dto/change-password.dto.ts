import { IsString, Matches, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'password must be ≥ 8 chars' })
  @Matches(/[A-Za-z]/, { message: 'password must contain a letter' })
  @Matches(/[0-9]/, { message: 'password must contain a digit' })
  newPassword!: string;
}
