import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OssService } from './oss.service';

const putMock = jest.fn();
const signatureUrlMock = jest.fn();
const deleteMock = jest.fn();
const getStreamMock = jest.fn();

jest.mock('ali-oss', () => {
  return jest.fn().mockImplementation(() => ({
    put: putMock,
    signatureUrl: signatureUrlMock,
    delete: deleteMock,
    getStream: getStreamMock,
  }));
});

describe('OssService', () => {
  let svc: OssService;

  beforeEach(async () => {
    putMock.mockReset();
    signatureUrlMock.mockReset();
    deleteMock.mockReset();
    getStreamMock.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        OssService,
        {
          provide: ConfigService,
          useValue: {
            get: () => ({
              oss: {
                region: 'oss-cn-hangzhou',
                bucket: 'b',
                accessKeyId: 'k',
                accessKeySecret: 's',
                keyPrefix: 'fapiao/',
                signedUrlExpiresSec: 300,
              },
            }),
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(OssService);
    svc.onModuleInit();
  });

  it('exposes the configured prefix', () => {
    expect(svc.getPrefix()).toBe('fapiao/');
  });

  it('putObject calls client.put with mime', async () => {
    putMock.mockResolvedValue({});
    await svc.putObject('fapiao/x.jpg', Buffer.from('hi'), 'image/jpeg');
    expect(putMock).toHaveBeenCalledWith('fapiao/x.jpg', Buffer.from('hi'), { mime: 'image/jpeg' });
  });

  it('signedUrl uses default TTL when none provided', () => {
    signatureUrlMock.mockReturnValue('https://signed/');
    expect(svc.signedUrl('fapiao/x.jpg')).toBe('https://signed/');
    expect(signatureUrlMock).toHaveBeenCalledWith('fapiao/x.jpg', { expires: 300 });
  });

  it('signedUrl honours overridden TTL', () => {
    signatureUrlMock.mockReturnValue('https://signed/');
    svc.signedUrl('fapiao/x.jpg', 60);
    expect(signatureUrlMock).toHaveBeenCalledWith('fapiao/x.jpg', { expires: 60 });
  });

  it('deleteObject delegates to client.delete', async () => {
    deleteMock.mockResolvedValue({});
    await svc.deleteObject('fapiao/x.jpg');
    expect(deleteMock).toHaveBeenCalledWith('fapiao/x.jpg');
  });

  it('getStream unwraps the stream property', async () => {
    const fake = { stream: 'STREAM' };
    getStreamMock.mockResolvedValue(fake);
    const out = await svc.getStream('fapiao/x.jpg');
    expect(out).toBe('STREAM');
  });
});
