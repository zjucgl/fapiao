import { Type } from 'class-transformer';
import { IsBooleanString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { InvoiceStatus, InvoiceType, PaymentMethod } from '@prisma/client';

export class ListInvoicesQueryDto {
  @IsOptional() @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional() @IsEnum(InvoiceType)
  invoiceType?: InvoiceType;

  @IsOptional() @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional() @IsString()
  operatorId?: string;

  @IsOptional() @IsString()
  fromDate?: string;

  @IsOptional() @IsString()
  toDate?: string;

  @IsOptional() @IsBooleanString()
  amountRegistered?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number = 50;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;
}
