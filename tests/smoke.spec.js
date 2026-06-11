import { test, expect } from '@playwright/test';
import { gotoClean, gotoWithKey, mockKeyInfo } from './helpers.js';

test.describe('smoke', () => {
  test('app loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(err.message));

    await gotoClean(page);
    await expect(page.locator('#access-key-overlay')).toBeVisible();

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('textarea for message exists once a key is present', async ({ page }) => {
    await mockKeyInfo(page, { body: { valid: true, queriesRemaining: 10 } });
    await gotoWithKey(page);

    await expect(page.locator('#access-key-overlay')).toBeHidden();
    await expect(page.locator('#no-key-warning')).toBeHidden();
    await expect(page.locator('#analyzer-input')).toBeVisible();
    await expect(page.locator('#msg-input')).toBeVisible();
    await expect(page.locator('#btn-analyze')).toBeVisible();
  });

  test('theme toggle works', async ({ page }) => {
    await gotoClean(page);

    const before = await page.evaluate(() => document.documentElement.dataset.theme || 'dark');

    // The overlay (position:fixed, z-index:600) covers the header — hide it so the
    // click reaches the button and triggers the JS event listener.
    await page.evaluate(() => {
      const ol = document.getElementById('access-key-overlay');
      if (ol) ol.style.display = 'none';
    });
    await page.locator('#btn-theme').click();

    const after = await page.evaluate(() => document.documentElement.dataset.theme);

    expect(after).not.toBe(before);
    expect(['light', 'dark']).toContain(after);
  });

  test('language toggle works', async ({ page }) => {
    await gotoClean(page);

    // `const S` in 'use strict' non-module script is NOT on window in Chrome.
    // Use document.documentElement.lang (set by I18n.setLang) as observable proxy.
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('pl');

    // Overlay covers header buttons — hide it so click reaches btn-en
    await page.evaluate(() => {
      const ol = document.getElementById('access-key-overlay');
      if (ol) ol.style.display = 'none';
    });
    await page.locator('#btn-en').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en');
    await expect(page.locator('#btn-en')).toHaveClass(/active/);
  });
});
