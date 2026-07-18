import { createHmac, timingSafeEqual } from 'node:crypto';

export function createN8nSignature(secret: string, timestamp: string, rawBody: Buffer | string): string {
  return createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex');
}

export function verifyN8nSignature(secret: string, timestamp: string, rawBody: Buffer, supplied: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = Buffer.from(createN8nSignature(secret, timestamp, rawBody), 'hex');
  const actual = Buffer.from(supplied, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isFreshTimestamp(timestamp: string, now = Date.now(), toleranceMs = 300_000): boolean {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && Math.abs(now - parsed) <= toleranceMs;
}
