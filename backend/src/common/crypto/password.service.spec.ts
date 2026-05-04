import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes a password to a non-empty string different from input', async () => {
    const hash = await svc.hash('admin123');
    expect(hash).toBeTruthy();
    expect(hash).not.toBe('admin123');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies the correct password', async () => {
    const hash = await svc.hash('s3cret!');
    await expect(svc.verify('s3cret!', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await svc.hash('s3cret!');
    await expect(svc.verify('nope', hash)).resolves.toBe(false);
  });
});
