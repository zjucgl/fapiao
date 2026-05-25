import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import OSS = require('ali-oss');

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function main() {
  const prisma = new PrismaClient();
  const client = new OSS({
    region: process.env.OSS_REGION!,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    secure: true,
  });

  const batchSize = 50;
  let processed = 0;
  let lastId: bigint | undefined;

  while (true) {
    const rows: { id: bigint; ossKey: string }[] = await prisma.invoiceImage.findMany({
      where: { contentSha256: null, ...(lastId ? { id: { gt: lastId } } : {}) },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, ossKey: true },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        const result = await client.getStream(row.ossKey);
        const buf = await streamToBuffer(result.stream as NodeJS.ReadableStream);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        await prisma.invoiceImage.update({ where: { id: row.id }, data: { contentSha256: hash } });
        processed++;
        if (processed % 50 === 0) console.log(`backfilled ${processed} images`);
      } catch (e) {
        console.error(`failed image id=${row.id} key=${row.ossKey}`, e);
      }
      lastId = row.id;
    }
  }
  console.log(`done. backfilled ${processed} images.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
