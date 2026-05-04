import { buildOssKey } from './key-naming';

describe('buildOssKey', () => {
  beforeAll(() => { jest.useFakeTimers().setSystemTime(new Date('2026-05-15T10:00:00Z')); });
  afterAll(() => { jest.useRealTimers(); });

  it('builds invoice key under correct prefix', () => {
    const k = buildOssKey({
      prefix: 'fapiao/',
      teamId: 3n,
      invoiceId: 128n,
      kind: 'invoice',
      originalFilename: 'IMG_001.JPG',
    });
    expect(k).toMatch(/^fapiao\/team_3\/202605\/invoice_128\/invoice_[0-9a-f-]+\.jpg$/);
  });

  it('builds proof key with png extension', () => {
    const k = buildOssKey({
      prefix: 'fapiao/',
      teamId: 9n,
      invoiceId: 1n,
      kind: 'proof',
      originalFilename: 'screenshot.png',
    });
    expect(k).toMatch(/^fapiao\/team_9\/202605\/invoice_1\/proof_[0-9a-f-]+\.png$/);
  });

  it('falls back to bin when extension is unknown', () => {
    const k = buildOssKey({
      prefix: 'fapiao/',
      teamId: 1n,
      invoiceId: 1n,
      kind: 'invoice',
      originalFilename: 'noext',
    });
    expect(k).toMatch(/\.bin$/);
  });
});
