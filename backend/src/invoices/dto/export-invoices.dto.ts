import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export enum ExportImageMode {
  invoice_only = 'invoice_only',
  proof_only = 'proof_only',
  both = 'both',
}

export class ExportInvoicesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000)
  @IsString({ each: true })
  ids!: string[];

  @IsEnum(ExportImageMode)
  mode!: ExportImageMode;

  @IsOptional() @IsBoolean()
  alsoMarkProcessed?: boolean = false;
}
