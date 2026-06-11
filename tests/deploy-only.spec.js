import { test, expect } from '@playwright/test';

test.describe('deploy-only (skipped in local)', () => {
  test.skip('P2 — security headers present (CSP, HSTS, X-Frame-Options)', async ({ request }) => {
    const res = await request.get('/');
    const h = res.headers();
    expect(h['content-security-policy']).toBeTruthy();
    expect(h['strict-transport-security']).toBeTruthy();
    expect(h['x-frame-options']).toBeTruthy();
  });

  test.skip('P3 — per-IP rate limiting kicks in after threshold', async () => {});
  test.skip('P5 — Redis TTL / rejection sampling (backend, real Redis)', async () => {});
  test.skip('P8 — Stripe webhook addon placeholder in PAYMENT_LINK_MAP', async () => {});
});
