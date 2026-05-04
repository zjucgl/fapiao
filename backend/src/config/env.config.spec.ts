import { loadEnvConfig } from './env.config';

describe('loadEnvConfig', () => {
  it('returns typed config when all required vars present', () => {
    const cfg = loadEnvConfig({
      DATABASE_URL: 'mysql://u:p@h:3306/d',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      JWT_ACCESS_TTL: '30m',
      JWT_REFRESH_TTL: '7d',
      OSS_REGION: 'oss-cn-hangzhou',
      OSS_BUCKET: 'b',
      OSS_ACCESS_KEY_ID: 'k',
      OSS_ACCESS_KEY_SECRET: 's',
      OSS_KEY_PREFIX: 'fapiao/',
      OSS_SIGNED_URL_EXPIRES_SEC: '300',
      SUPER_ADMIN_USERNAME: 'admin',
      SUPER_ADMIN_INITIAL_PASSWORD: 'admin123',
    });
    expect(cfg.databaseUrl).toBe('mysql://u:p@h:3306/d');
    expect(cfg.oss.signedUrlExpiresSec).toBe(300);
  });

  it('throws on missing required var', () => {
    expect(() => loadEnvConfig({})).toThrow(/DATABASE_URL/);
  });
});
