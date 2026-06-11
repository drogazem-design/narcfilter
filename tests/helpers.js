import { expect } from '@playwright/test';

export async function gotoClean(page) {
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch {}
  });
  await page.goto('/');
}

export async function gotoWithKey(page, key = 'NF-ABC12-XYZ34') {
  await page.addInitScript((k) => {
    try {
      localStorage.clear();
      localStorage.setItem('nf_access_key', k);
    } catch {}
  }, key);
  await page.goto('/');
}

export async function mockAnalyze(page, { status = 200, body = {} } = {}) {
  await page.route('**/api/analyze', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

export async function mockKeyInfo(page, { status = 200, body = {} } = {}) {
  await page.route('**/api/key-info', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

export async function mockVerifyKey(page, { status = 200, body = {} } = {}) {
  await page.route('**/api/verify-key', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

export async function setLang(page, lang) {
  // The access-key overlay (position:fixed, z-index:600) covers the entire viewport
  // including the header language buttons. We hide it temporarily so the real click
  // reaches the button and triggers the JS event listener.
  await page.evaluate(() => {
    const ol = document.getElementById('access-key-overlay');
    if (ol) ol.style.display = 'none';
  });
  await page.locator(lang === 'en' ? '#btn-en' : '#btn-pl').click();
  // `const S` in a 'use strict' non-module script is NOT on window in Chrome.
  // Use document.documentElement.lang (set by I18n.setLang) as observable proxy.
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(lang);
  // Restore overlay display so subsequent overlay assertions still work
  await page.evaluate(() => {
    const ol = document.getElementById('access-key-overlay');
    if (ol) ol.style.display = '';
  });
}
