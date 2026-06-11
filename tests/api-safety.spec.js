import { test, expect } from '@playwright/test';
import { gotoWithKey, mockKeyInfo, mockAnalyze } from './helpers.js';

test.describe('P6 — error responses do not leak internals', () => {
  test('500 error response has no detail field shown in UI', async ({ page }) => {
    await mockKeyInfo(page, { body: { valid: true, queriesRemaining: 5 } });
    await mockAnalyze(page, { status: 500, body: { error: 'Internal server error' } });
    await gotoWithKey(page);

    await page.locator('#msg-input').fill('Trigger a server error.');
    await page.locator('#btn-analyze').click();

    await expect(page.locator('#error-area')).toBeVisible();

    const text = await page.locator('#error-msg').innerText();
    expect(text).toContain('Internal server error');
    expect(text.toLowerCase()).not.toContain('detail');
    expect(text.toLowerCase()).not.toContain('stack');
    expect(text).not.toMatch(/at\s+\w+.*\(.*:\d+:\d+\)/);
    expect(text.toLowerCase()).not.toContain('redis');
    expect(text.toLowerCase()).not.toContain('anthropic_api_key');
  });

  test('UI stays safe even if backend mistakenly leaks a detail field', async ({ page }) => {
    await mockKeyInfo(page, { body: { valid: true, queriesRemaining: 5 } });
    await mockAnalyze(page, {
      status: 500,
      body: { error: 'Internal server error', detail: 'TypeError at redis.eval line 42' },
    });
    await gotoWithKey(page);

    await page.locator('#msg-input').fill('Trigger a server error.');
    await page.locator('#btn-analyze').click();

    await expect(page.locator('#error-area')).toBeVisible();
    await expect(page.locator('#error-msg')).toHaveText('Internal server error');
  });
});
