// Payment link → package type mapping.
// Same 3 links handle both new purchases and top-ups:
// topUpKey() is tried first; it falls back to createAndDeliverKey() only
// when the customer email has no existing key in Redis.
export const PAYMENT_LINK_MAP = {
  'plink_1TT0JKDg3rjklSS3hFN4Bp7o': 'starter',
  'plink_1TT0JUDg3rjklSS3Z5drAAz7': 'standard',
  'plink_1TT0JWDg3rjklSS3ioLl2rU7': 'pro',
};
