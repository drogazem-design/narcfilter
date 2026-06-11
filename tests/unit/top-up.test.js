import { vi, describe, it, expect, beforeEach } from 'vitest';

// vi.hoisted — these run BEFORE vi.mock factories, so factories can reference them
const mocks = vi.hoisted(() => ({
  redisGet:  vi.fn(),
  redisEval: vi.fn(),
  emailSend: vi.fn().mockResolvedValue({ id: 'mock-email-id' }),
}));

vi.mock('../../api/_checkEnv.js', () => ({ checkEnv: vi.fn() }));

vi.mock('resend', () => ({
  // Regular function (not arrow) — arrow functions cannot be called with `new`.
  Resend: vi.fn(function () { return { emails: { send: mocks.emailSend } }; }),
}));

vi.mock('../../api/_redis.js', () => ({
  redis: {
    get: mocks.redisGet,
    eval: mocks.redisEval,
    set: vi.fn(),
    del: vi.fn(),
  },
  withTimeout:      vi.fn((p) => p),
  incrWithExpiry:   vi.fn(),
  getClientIp:      vi.fn(),
  checkIpRateLimit: vi.fn(),
}));

import { topUpKey, createAndDeliverKey, PACKAGES } from '../../api/_generateKeyLogic.js';

// ─── topUpKey ──────────────────────────────────────────────────────────────────

describe('topUpKey', () => {
  beforeEach(() => {
    mocks.redisGet.mockReset();
    mocks.redisEval.mockReset();
    mocks.emailSend.mockReset();
    mocks.emailSend.mockResolvedValue({ id: 'mock-email-id' });
  });

  it('returns null when no key is found for the email', async () => {
    mocks.redisGet.mockResolvedValue(null);

    const result = await topUpKey({ queriesCount: 10, customerEmail: 'new@example.com' });

    expect(result).toBeNull();
    expect(mocks.redisEval).not.toHaveBeenCalled();
  });

  it('returns { key, newBalance } on successful top-up', async () => {
    mocks.redisGet.mockResolvedValue('NF-ABC12-XYZ34');
    mocks.redisEval.mockResolvedValue(50);

    const result = await topUpKey({ queriesCount: 10, customerEmail: 'user@example.com' });

    expect(result).toEqual({ key: 'NF-ABC12-XYZ34', newBalance: 50 });
  });

  it('returns null when LUA_TOP_UP returns null (key record missing)', async () => {
    mocks.redisGet.mockResolvedValue('NF-ABC12-XYZ34');
    mocks.redisEval.mockResolvedValue(null);

    const result = await topUpKey({ queriesCount: 10, customerEmail: 'user@example.com' });

    expect(result).toBeNull();
    expect(mocks.emailSend).not.toHaveBeenCalled();
  });

  it('normalises email to lowercase for Redis lookup', async () => {
    mocks.redisGet.mockResolvedValue(null);

    await topUpKey({ queriesCount: 10, customerEmail: 'User@Example.COM' });

    expect(mocks.redisGet).toHaveBeenCalledWith('email:user@example.com');
  });

  it('sends top-up email with correct recipient and queriesCount', async () => {
    mocks.redisGet.mockResolvedValue('NF-ABC12-XYZ34');
    mocks.redisEval.mockResolvedValue(20);

    await topUpKey({ queriesCount: 10, customerEmail: 'user@example.com' });

    expect(mocks.emailSend).toHaveBeenCalledOnce();
    expect(mocks.emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to:      'user@example.com',
        subject: 'Doładowano konto NarcFilter',
      })
    );
  });

  it('passes queriesCount as string ARGV to LUA_TOP_UP', async () => {
    mocks.redisGet.mockResolvedValue('NF-ABC12-XYZ34');
    mocks.redisEval.mockResolvedValue(110);

    await topUpKey({ queriesCount: 100, customerEmail: 'user@example.com' });

    const [, keys, args] = mocks.redisEval.mock.calls[0];
    expect(keys[0]).toBe('NF-ABC12-XYZ34');
    expect(args[0]).toBe('100');
  });
});

// ─── createAndDeliverKey ───────────────────────────────────────────────────────

describe('createAndDeliverKey', () => {
  beforeEach(() => {
    mocks.redisEval.mockReset();
    mocks.emailSend.mockReset();
    mocks.redisEval.mockResolvedValue(1);
    mocks.emailSend.mockResolvedValue({ id: 'mock-email-id' });
  });

  it('returns a key in NF-XXXXX-XXXXX format', async () => {
    const { key } = await createAndDeliverKey({ packageType: 'starter', customerEmail: 'buyer@example.com' });

    expect(key).toMatch(/^NF-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  });

  it('saves correct queriesRemaining for starter (10)', async () => {
    await createAndDeliverKey({ packageType: 'starter', customerEmail: 'buyer@example.com' });

    const [, , args] = mocks.redisEval.mock.calls[0];
    const record = JSON.parse(args[0]);

    expect(record.queriesRemaining).toBe(PACKAGES.starter.queriesRemaining);
    expect(record.packageType).toBe('starter');
    expect(record.email).toBe('buyer@example.com');
  });

  it('saves correct queriesRemaining for standard (100)', async () => {
    await createAndDeliverKey({ packageType: 'standard', customerEmail: 'user@example.com' });

    const [, , args] = mocks.redisEval.mock.calls[0];
    expect(JSON.parse(args[0]).queriesRemaining).toBe(100);
  });

  it('saves correct queriesRemaining for pro (500)', async () => {
    await createAndDeliverKey({ packageType: 'pro', customerEmail: 'pro@example.com' });

    const [, , args] = mocks.redisEval.mock.calls[0];
    expect(JSON.parse(args[0]).queriesRemaining).toBe(500);
  });

  it('email-to-key mapping uses 365-day TTL', async () => {
    await createAndDeliverKey({ packageType: 'starter', customerEmail: 'user@example.com' });

    const [, , args] = mocks.redisEval.mock.calls[0];
    expect(args[2]).toBe(String(365 * 86_400)); // '31536000'
  });

  it('email mapping key is lowercased', async () => {
    await createAndDeliverKey({ packageType: 'starter', customerEmail: 'Buyer@Example.COM' });

    const [, keys] = mocks.redisEval.mock.calls[0];
    expect(keys[1]).toBe('email:buyer@example.com');
  });

  it('sends purchase email with correct recipient', async () => {
    await createAndDeliverKey({ packageType: 'starter', customerEmail: 'buyer@example.com' });

    expect(mocks.emailSend).toHaveBeenCalledOnce();
    expect(mocks.emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to:      'buyer@example.com',
        subject: 'Twój klucz dostępu do NarcFilter',
      })
    );
  });
});

// ─── Webhook routing: same payment link → topUp if known, create if new ────────

describe('webhook routing logic (topUp-first, createAndDeliver-fallback)', () => {
  beforeEach(() => {
    mocks.redisGet.mockReset();
    mocks.redisEval.mockReset();
    mocks.emailSend.mockReset();
    mocks.emailSend.mockResolvedValue({ id: 'mock-email-id' });
  });

  it('existing customer: topUpKey succeeds → returns { key, newBalance }', async () => {
    mocks.redisGet.mockResolvedValue('NF-EXIST-12345');
    mocks.redisEval.mockResolvedValue(110);

    const result = await topUpKey({ queriesCount: 10, customerEmail: 'returning@example.com' });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ key: 'NF-EXIST-12345', newBalance: 110 });
  });

  it('new customer: topUpKey returns null → createAndDeliverKey generates a new key', async () => {
    // topUpKey path: email not found
    mocks.redisGet.mockResolvedValue(null);
    const topped = await topUpKey({ queriesCount: 10, customerEmail: 'new@example.com' });
    expect(topped).toBeNull();

    // createAndDeliverKey path: eval returns 1 (success)
    mocks.redisEval.mockResolvedValue(1);
    const { key } = await createAndDeliverKey({ packageType: 'starter', customerEmail: 'new@example.com' });
    expect(key).toMatch(/^NF-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  });
});
