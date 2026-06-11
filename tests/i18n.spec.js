import { test, expect } from '@playwright/test';
import { gotoClean, gotoWithKey, mockKeyInfo, mockAnalyze, setLang } from './helpers.js';

test.describe('P10 — i18n overlay', () => {
  test('overlay intro text is in Polish by default', async ({ page }) => {
    await gotoClean(page);
    await expect(page.locator('[data-i18n="overlay_intro"]')).toHaveText(
      'Wprowadź klucz dostępu, aby korzystać z aplikacji.',
    );
  });

  test('overlay intro text switches to English', async ({ page }) => {
    await gotoClean(page);
    await setLang(page, 'en');
    await expect(page.locator('[data-i18n="overlay_intro"]')).toHaveText(
      'Enter your access key to use the app.',
    );
  });
});

test.describe('P10 — classifyError overloaded message', () => {
  async function runOverloadedAnalysis(page) {
    await mockKeyInfo(page, { body: { valid: true, queriesRemaining: 5 } });
    await mockAnalyze(page, { status: 503, body: { error: 'overloaded' } });
    await gotoWithKey(page);

    await expect(page.locator('#msg-input')).toBeVisible();
    await page.locator('#msg-input').fill('Test message to analyze.');
    await page.locator('#btn-analyze').click();

    await expect(page.locator('#error-area')).toBeVisible();
  }

  test('overloaded error message is in Polish', async ({ page }) => {
    await runOverloadedAnalysis(page);
    await expect(page.locator('#error-msg')).toHaveText(
      'Serwis AI jest chwilowo przeciążony — to po stronie Anthropic, nie aplikacji. Odczekaj chwilę i spróbuj ponownie.',
    );
  });

  test('overloaded error message is in English', async ({ page }) => {
    await mockKeyInfo(page, { body: { valid: true, queriesRemaining: 5 } });
    await mockAnalyze(page, { status: 503, body: { error: 'overloaded' } });
    await gotoWithKey(page);

    await setLang(page, 'en');
    await page.locator('#msg-input').fill('Test message to analyze.');
    await page.locator('#btn-analyze').click();

    await expect(page.locator('#error-area')).toBeVisible();
    await expect(page.locator('#error-msg')).toHaveText(
      "The AI service is temporarily overloaded — this is on Anthropic's side, not the app. Please wait a moment and try again.",
    );
  });
});
