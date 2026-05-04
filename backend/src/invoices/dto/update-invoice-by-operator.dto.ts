import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class UpdateInvoiceByOperatorDto {
  @IsOptional() @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional() @IsString() @MaxLength(200)
  remark?: string | null;
}
