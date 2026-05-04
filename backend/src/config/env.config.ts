export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  oss: {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
    keyPrefix: string;
    signedUrlExpiresSec: number;
  };
  superAdmin: {
    username: string;
    initialPassword: string;
  };
}

const REQUIRED = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'OSS_REGION',
  'OSS_BUCKET',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'SUPER_ADMIN_USERNAME',
  'SUPER_ADMIN_INITIAL_PASSWORD',
] as const;

export function loadEnvConfig(
  env: NodeJS.ProcessEnv | Record<string, string>,
): AppConfig {
  for (const key of REQUIRED) {
    if (!env[key]) throw new Error(`Missing required env var: ${key}`);
  }
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL!,
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET!,
      refreshSecret: env.JWT_REFRESH_SECRET!,
      accessTtl: env.JWT_ACCESS_TTL ?? '30m',
      refreshTtl: env.JWT_REFRESH_TTL ?? '7d',
    },
    oss: {
      region: env.OSS_REGION!,
      bucket: env.OSS_BUCKET!,
      accessKeyId: env.OSS_ACCESS_KEY_ID!,
      accessKeySecret: env.OSS_ACCESS_KEY_SECRET!,
      keyPrefix: env.OSS_KEY_PREFIX ?? 'fapiao/',
      signedUrlExpiresSec: Number(env.OSS_SIGNED_URL_EXPIRES_SEC ?? 300),
    },
    superAdmin: {
      username: env.SUPER_ADMIN_USERNAME!,
      initialPassword: env.SUPER_ADMIN_INITIAL_PASSWORD!,
    },
  };
}
