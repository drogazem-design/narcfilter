import { describe, it, expect } from 'vitest';
import { PAYMENT_LINK_MAP } from '../../api/_payment-links.js';

describe('PAYMENT_LINK_MAP', () => {
  it('has exactly 3 entries — no addon placeholder', () => {
    expect(Object.keys(PAYMENT_LINK_MAP)).toHaveLength(3);
  });

  it('maps all 3 Stripe links to starter / standard / pro', () => {
    const values = Object.values(PAYMENT_LINK_MAP);
    expect(values).toContain('starter');
    expect(values).toContain('standard');
    expect(values).toContain('pro');
  });

  it('does not contain addon as a value', () => {
    expect(Object.values(PAYMENT_LINK_MAP)).not.toContain('addon');
  });

  it('does not contain the placeholder key', () => {
    expect(Object.keys(PAYMENT_LINK_MAP)).not.toContain('plink_REPLACE_WITH_ADDON_LINK_ID');
  });

  it('all 3 package types are uniquely covered', () => {
    const packages = new Set(Object.values(PAYMENT_LINK_MAP));
    expect(packages).toEqual(new Set(['starter', 'standard', 'pro']));
  });
});
