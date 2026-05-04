import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import OSS = require('ali-oss');
import { Readable } from 'stream';
import { AppConfig } from '../config/env.config';

@Injectable()
export class OssService implements OnModuleInit {
  private client!: OSS;
  private prefix!: string;
  private signedUrlTtl!: number;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const cfg = this.config.get<AppConfig>('app')!.oss;
    this.client = new OSS({
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      bucket: cfg.bucket,
      secure: true,
    });
    this.prefix = cfg.keyPrefix;
    this.signedUrlTtl = cfg.signedUrlExpiresSec;
  }

  getPrefix(): string { return this.prefix; }

  async putObject(key: string, body: Buffer, mime: string): Promise<void> {
    await this.client.put(key, body, { mime });
  }

  signedUrl(key: string, ttlSec: number = this.signedUrlTtl): string {
    return this.client.signatureUrl(key, { expires: ttlSec });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.delete(key);
  }

  async getStream(key: string): Promise<Readable> {
    const result = await this.client.getStream(key);
    return result.stream as Readable;
  }
}
