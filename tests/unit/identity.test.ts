import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../src/modules/identity/password';
import { encryptSecret, decryptSecret } from '../../src/modules/identity/mfa';
import { assertOrigin } from '../../src/modules/identity/http';

test('密码随机盐与恒定长度散列；错误或异常散列拒绝', async () => {
  const a = await hashPassword('sufficient-password-123'), b = await hashPassword('sufficient-password-123');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('sufficient-password-123', a), true);
  assert.equal(await verifyPassword('wrong', a), false);
  assert.equal(await verifyPassword('any', 'malformed'), false);
  await assert.rejects(() => hashPassword('short'), { status: 400 });
});

test('二次验证secret带用户绑定加密；篡改、换用户或换密钥无法解密', () => {
  const key = randomBytes(32).toString('hex');
  const encrypted = encryptSecret('private-mfa-secret', 'user-a', key);
  assert.equal(encrypted.includes('private-mfa-secret'), false);
  assert.equal(decryptSecret(encrypted, 'user-a', key), 'private-mfa-secret');
  assert.throws(() => decryptSecret(encrypted, 'user-b', key));
  assert.throws(() => decryptSecret(encrypted, 'user-a', randomBytes(32).toString('hex')));
  assert.throws(() => decryptSecret(encrypted.slice(0, -4) + 'aaaa', 'user-a', key));
});

test('写请求Origin必须匹配配置；不信任伪造Host与转发头', () => {
  const origin = 'http://127.0.0.1:3100';
  assert.doesNotThrow(() => assertOrigin(new Request(origin, { headers: { origin } }), origin));
  const invalid: Record<string, string>[] = [{}, { origin: 'https://evil.example' }, { origin: 'https://evil.example', host: 'evil.example', 'x-forwarded-host': 'evil.example' }];
  for (const headers of invalid) {
    assert.throws(() => assertOrigin(new Request(origin, { headers }), origin), { status: 403 });
  }
});
