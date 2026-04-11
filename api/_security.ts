const parseAllowedHosts = (): string[] =>
  String(process.env.STREAM_HOST_ALLOWLIST || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

export const isValidAccessToken = (token: string): boolean => {
  const expected = String(process.env.STREAM_ACCESS_TOKEN || '').trim();
  if (!expected) return true;
  return token.trim() === expected;
};

export const getRequestToken = (req: any): string => {
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : '';
  const headerToken = typeof req.headers?.['x-stream-token'] === 'string' ? req.headers['x-stream-token'] : '';
  return String(queryToken || headerToken || '').trim();
};

export const enforceAccessToken = (req: any, res: any): boolean => {
  const provided = getRequestToken(req);
  if (isValidAccessToken(provided)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
};

export const isUrlHostAllowed = (rawUrl: string): boolean => {
  const allowlist = parseAllowedHosts();
  if (allowlist.length === 0) return true;

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return allowlist.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`));
  } catch {
    return false;
  }
};
