const STREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const isAbsoluteHttp = (value: string) => /^https?:\/\//i.test(value);
const proxify = (url: string) => `/api/stream?url=${encodeURIComponent(url)}`;

const buildProxyHeaders = (sourceUrl: string, rangeHeader: string) => {
  const parsed = new URL(sourceUrl);
  const origin = `${parsed.protocol}//${parsed.host}`;

  return {
    'User-Agent': STREAM_UA,
    Accept: '*/*',
    Range: rangeHeader,
    Referer: `${origin}/`,
    Origin: origin,
  };
};

function rewriteM3U8(content: string, sourceUrl: string) {
  const lines = content.split(/\r?\n/);
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;

      try {
        const absolute = new URL(trimmed, sourceUrl).toString();
        if (!isAbsoluteHttp(absolute)) return line;
        return proxify(absolute);
      } catch {
        return line;
      }
    })
    .join('\n');
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const raw = typeof req.query?.url === 'string' ? req.query.url : '';
  const sourceUrl = decodeURIComponent(raw || '').trim();

  if (!isAbsoluteHttp(sourceUrl)) {
    res.status(400).json({ error: 'Invalid stream URL' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const upstream = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: buildProxyHeaders(sourceUrl, req.headers?.range || ''),
    });

    const contentType = upstream.headers.get('content-type') || '';

    if (contentType.includes('mpegurl') || sourceUrl.toLowerCase().includes('.m3u8')) {
      const m3u = await upstream.text();
      const rewritten = rewriteM3U8(m3u, sourceUrl);
      res.status(upstream.status);
      res.setHeader('content-type', 'application/vnd.apple.mpegurl');
      res.setHeader('cache-control', 'no-store');
      res.send(rewritten);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    const passthroughHeaders = ['content-type', 'accept-ranges', 'content-range', 'content-length'];
    for (const key of passthroughHeaders) {
      const value = upstream.headers.get(key);
      if (value) res.setHeader(key, value);
    }
    res.send(buffer);
  } catch (error: any) {
    res.status(502).json({ error: 'Stream proxy failed', details: error?.message || 'Unknown error' });
  } finally {
    clearTimeout(timeout);
  }
}
