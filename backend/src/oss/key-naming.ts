import { randomUUID } from 'crypto';
import * as path from 'path';

export type OssKind = 'invoice' | 'proof';

export interface BuildOssKeyArgs {
  prefix: string;
  teamId: bigint;
  invoiceId: bigint;
  kind: OssKind;
  originalFilename: string;
}

export function buildOssKey(args: BuildOssKeyArgs): string {
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const ext = (path.extname(args.originalFilename) || '.bin').toLowerCase();
  return `${args.prefix}team_${args.teamId}/${yyyymm}/invoice_${args.invoiceId}/${args.kind}_${randomUUID()}${ext}`;
}
