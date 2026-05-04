import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as archiver from 'archiver';
import * as path from 'path';
import { Writable } from 'stream';
import { OssService } from '../../oss/oss.service';

const STATUS_LABEL: Record<string, string> = {
  unprocessed: '未处理',
  processed: '已处理',
};
const PAY_LABEL: Record<string, string> = {
  cash: '现金',
  online: '线上',
};
const TYPE_LABEL: Record<string, string> = {
  catering: '餐饮',
  fuel: '油票',
  consumable: '耗材',
  printing: '打印',
  other: '其它',
};

interface ExportInvoice {
  id: bigint;
  amount: any | null;
  invoiceType: string | null;
  paymentMethod: string;
  status: string;
  remark: string | null;
  createdAt: Date;
  operator: { username: string };
  invoiceImages: { id: bigint; originalFilename: string; ossKey: string }[];
  proofImages: { id: bigint; originalFilename: string; ossKey: string }[];
}

@Injectable()
export class ExportService {
  constructor(private readonly oss: OssService) {}

  async buildXlsxBuffer(invoices: ExportInvoice[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('发票');
    ws.columns = [
      { header: '序号', key: 'idx', width: 6 },
      { header: '录入日期', key: 'createdAt', width: 18 },
      { header: '操作员', key: 'operator', width: 14 },
      { header: '金额', key: 'amount', width: 12 },
      { header: '发票类型', key: 'type', width: 10 },
      { header: '支付方式', key: 'pay', width: 10 },
      { header: '状态', key: 'status', width: 10 },
      { header: '备注', key: 'remark', width: 24 },
      { header: '发票图片文件名', key: 'invoiceImageNames', width: 40 },
      { header: '支付凭证文件名', key: 'proofImageNames', width: 40 },
    ];
    ws.getRow(1).font = { bold: true };

    invoices.forEach((inv, i) => {
      ws.addRow({
        idx: i + 1,
        createdAt: this.fmtBeijing(inv.createdAt),
        operator: inv.operator.username,
        amount: inv.amount ? Number(inv.amount.toString()) : '',
        type: inv.invoiceType ? TYPE_LABEL[inv.invoiceType] ?? inv.invoiceType : '',
        pay: PAY_LABEL[inv.paymentMethod] ?? inv.paymentMethod,
        status: STATUS_LABEL[inv.status] ?? inv.status,
        remark: inv.remark ?? '',
        invoiceImageNames: inv.invoiceImages.map((img, j) => this.zipName(inv.id, j + 1, 'invoice', img.ossKey)).join('; '),
        proofImageNames: inv.proofImages.map((img, j) => this.zipName(inv.id, j + 1, 'proof', img.ossKey)).join('; '),
      });
    });

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  async streamImagesZip(invoices: ExportInvoice[], kind: 'invoice' | 'proof', sink: Writable): Promise<void> {
    const archive = archiver('zip', { zlib: { level: 5 } });
    const done = new Promise<void>((resolve, reject) => {
      sink.on('close', resolve);
      sink.on('finish', resolve);
      sink.on('error', reject);
      archive.on('error', reject);
    });
    archive.pipe(sink);

    for (const inv of invoices) {
      const list = kind === 'invoice' ? inv.invoiceImages : inv.proofImages;
      for (let j = 0; j < list.length; j++) {
        const img = list[j];
        const stream = await this.oss.getStream(img.ossKey);
        archive.append(stream, { name: this.zipName(inv.id, j + 1, kind, img.ossKey) });
      }
    }
    await archive.finalize();
    await done;
  }

  private zipName(invoiceId: bigint, idx: number, kind: 'invoice' | 'proof', ossKey: string) {
    const ext = path.extname(ossKey).toLowerCase() || '.bin';
    return `invoice_${invoiceId}_${kind}_${idx}${ext}`;
  }

  private fmtBeijing(d: Date): string {
    const t = new Date(d.getTime() + 8 * 3600 * 1000);
    const Y = t.getUTCFullYear();
    const M = String(t.getUTCMonth() + 1).padStart(2, '0');
    const D = String(t.getUTCDate()).padStart(2, '0');
    const h = String(t.getUTCHours()).padStart(2, '0');
    const m = String(t.getUTCMinutes()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}`;
  }
}
