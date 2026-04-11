import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TTL_SECONDS = 60 * 30;

type SignedPayload = {
  u: string;
  e: number;
};

const toBase64Url = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const fromBase64Url = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

const getSigningSecret = () => {
  const configured = (process.env.STREAM_ACCESS_TOKEN || '').trim();
  if (configured) return configured;
  return 'ultrastream-fallback-secret-change-me';
};

const sign = (payload: string) =>
  createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');

export const createSignedSourceToken = (sourceUrl: string, ttlSeconds = DEFAULT_TTL_SECONDS) => {
  const payload: SignedPayload = {
    u: sourceUrl,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
};

export const resolveSignedSourceToken = (token: string): string | null => {
  const trimmed = (token || '').trim();
  if (!trimmed.includes('.')) return null;

  const [encodedPayload, providedSignature] = trimmed.split('.', 2);
  const expectedSignature = sign(encodedPayload);

  const providedBuffer = Buffer.from(providedSignature || '', 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  const parsed = JSON.parse(fromBase64Url(encodedPayload)) as SignedPayload;
  const now = Math.floor(Date.now() / 1000);
  if (!parsed?.u || typeof parsed.e !== 'number' || parsed.e < now) return null;

  return parsed.u;
};
