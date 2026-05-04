import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { InvoiceType } from '@prisma/client';

export class RegisterInvoiceDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  amount?: number;

  @IsOptional() @IsEnum(InvoiceType)
  invoiceType?: InvoiceType;
}
