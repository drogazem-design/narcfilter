import { test, expect } from '@playwright/test';
import { gotoClean, setLang } from './helpers.js';

test.describe('P11 — purchase overlay UX', () => {
  test.beforeEach(async ({ page }) => {
    await gotoClean(page);
    await expect(page.locator('#access-key-overlay')).toBeVisible();
  });

  test('packages are visible immediately without interaction', async ({ page }) => {
    const pkgs = page.locator('#access-key-overlay .pkg-link');
    await expect(pkgs).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(pkgs.nth(i)).toBeVisible();
    }
    const open = await page.locator('#access-key-overlay details').evaluate((el) => el.open);
    expect(open).toBe(false);
  });

  test('key input is inside collapsed details', async ({ page }) => {
    const input = page.locator('#overlay-key-input');
    await expect(input).toBeAttached();
    await expect(input).toBeHidden();

    const insideDetails = await input.evaluate((el) => !!el.closest('details'));
    expect(insideDetails).toBe(true);
  });

  test('opening details reveals key input', async ({ page }) => {
    await page.locator('#access-key-overlay summary').click();
    await expect(page.locator('#overlay-key-input')).toBeVisible();
    await expect(page.locator('#btn-overlay-save')).toBeVisible();
  });

  test('invalid key format shows error and opens details', async ({ page }) => {
    await page.locator('#access-key-overlay summary').click();
    await page.locator('#overlay-key-input').fill('XYZ');
    await page.locator('#btn-overlay-save').click();

    await expect(page.locator('#overlay-key-error')).toBeVisible();
    const open = await page.locator('#access-key-overlay details').evaluate((el) => el.open);
    expect(open).toBe(true);
    await expect(page.locator('#access-key-overlay')).toBeVisible();
  });

  test('pkg links have Stripe URLs', async ({ page }) => {
    const pkgs = page.locator('#access-key-overlay .pkg-link');
    const count = await pkgs.count();
    expect(count).toBe(3);
    for (let i = 0; i < count; i++) {
      const href = await pkgs.nth(i).getAttribute('href');
      expect(href).toContain('buy.stripe.com');
    }
  });

  test('EN: summary text translates to overlay_have_key.en', async ({ page }) => {
    await setLang(page, 'en');
    await expect(page.locator('#access-key-overlay summary')).toHaveText('I already have an access key');
  });
});
