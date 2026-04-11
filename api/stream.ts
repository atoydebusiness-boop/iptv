import { enforceAccessToken, isUrlHostAllowed } from './_security';

const STREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const isAbsoluteHttp = (value: string) => /^https?:\/\//i.test(value);
const proxify = (url: string) => `/api/stream?url=${encodeURIComponent(url)}`;
const STREAM_EXTENSIONS = ['m3u8', 'mp4', 'ts', 'mkv'];
type SeriesInfoEpisode = { id?: string | number; container_extension?: string };
type SeriesInfoPayload = { episodes?: Record<string, SeriesInfoEpisode[] | undefined> | SeriesInfoEpisode[] };

const buildProxyHeaders = (sourceUrl: string, rangeHeader: string) => {
  const parsed = new URL(sourceUrl);
  const origin = `${parsed.protocol}//${parsed.host}`;

  const headers: Record<string, string> = {
    'User-Agent': STREAM_UA,
    Accept: '*/*',
    Referer: `${origin}/`,
    Origin: origin,
  };

  if (typeof rangeHeader === 'string' && rangeHeader.trim()) {
    headers.Range = rangeHeader;
  }

  return headers;
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

function m3u8NeedsRewrite(content: string): boolean {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      const uriMatch = line.match(/URI="([^"]+)"/i);
      if (uriMatch?.[1] && !isAbsoluteHttp(uriMatch[1])) return true;
      continue;
    }

    if (!isAbsoluteHttp(line)) return true;
  }
  return false;
}

function buildSourceCandidates(sourceUrl: string): string[] {
  const candidates = new Set<string>();
  const normalized = sourceUrl.toLowerCase();

  const add = (url: string) => {
    candidates.add(url);
    if (url.startsWith('http://')) candidates.add(url.replace('http://', 'https://'));
  };

  add(sourceUrl);

  const shouldTryVODFallbacks = normalized.includes('/movie/') || normalized.includes('/series/');
  if (shouldTryVODFallbacks) {
    for (const ext of STREAM_EXTENSIONS) {
      if (/\.[a-z0-9]+(\?.*)?$/i.test(sourceUrl)) {
        add(sourceUrl.replace(/\.[a-z0-9]+(\?.*)?$/i, `.${ext}$1`));
      } else {
        add(`${sourceUrl}.${ext}`);
      }
    }
  }

  return [...candidates];
}

const parseFirstEpisode = (episodes: SeriesInfoPayload['episodes']): SeriesInfoEpisode | null => {
  if (!episodes) return null;
  if (Array.isArray(episodes)) return episodes.find((episode) => episode?.id) || null;

  const seasonKeys = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
  for (const seasonKey of seasonKeys) {
    const seasonEpisodes = episodes[seasonKey];
    if (!Array.isArray(seasonEpisodes)) continue;
    const first = seasonEpisodes.find((episode) => episode?.id);
    if (first) return first;
  }

  return null;
};

async function resolveSeriesInfoToStream(seriesInfoUrl: string): Promise<string> {
  const parsed = new URL(seriesInfoUrl);
  if (parsed.searchParams.get('action') !== 'get_series_info') return seriesInfoUrl;

  const username = parsed.searchParams.get('username') || '';
  const password = parsed.searchParams.get('password') || '';
  if (!username || !password) return seriesInfoUrl;

  const seriesResponse = await fetch(seriesInfoUrl, {
    headers: {
      'User-Agent': STREAM_UA,
      Accept: 'application/json,text/plain,*/*',
      'Cache-Control': 'no-cache',
    },
  });

  if (!seriesResponse.ok) {
    throw new Error(`Series info retornou ${seriesResponse.status}`);
  }

  const payload = (await seriesResponse.text()).trim();
  const parsedPayload = JSON.parse(payload) as SeriesInfoPayload;
  const firstEpisode = parseFirstEpisode(parsedPayload.episodes);
  if (!firstEpisode?.id) {
    throw new Error('Série sem episódios reproduzíveis.');
  }

  const ext = (firstEpisode.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  return `${parsed.protocol}//${parsed.host}/series/${username}/${password}/${firstEpisode.id}.${ext}`;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (!enforceAccessToken(req, res)) return;

  const raw = typeof req.query?.url === 'string' ? req.query.url : '';
  const sourceUrl = decodeURIComponent(raw || '').trim();

  if (!isAbsoluteHttp(sourceUrl)) {
    res.status(400).json({ error: 'Invalid stream URL' });
    return;
  }
  if (!isUrlHostAllowed(sourceUrl)) {
    res.status(403).json({ error: 'Host não permitido pelo STREAM_HOST_ALLOWLIST' });
    return;
  }

  try {
    const resolvedSourceUrl = await resolveSeriesInfoToStream(sourceUrl);
    const candidateUrls = buildSourceCandidates(resolvedSourceUrl);
    let upstream: Response | null = null;
    let finalSourceUrl = sourceUrl;
    let lastError = '';

    for (const candidateUrl of candidateUrls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const attempt = await fetch(candidateUrl, {
          signal: controller.signal,
          headers: buildProxyHeaders(candidateUrl, req.headers?.range || ''),
        });

        if (!attempt.ok) {
          lastError = `Upstream ${attempt.status} para ${candidateUrl}`;
          continue;
        }

        upstream = attempt;
        finalSourceUrl = candidateUrl;
        break;
      } catch (error: any) {
        lastError = error?.message || `Falha ao buscar ${candidateUrl}`;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!upstream) {
      throw new Error(lastError || 'Nenhuma URL candidata respondeu com sucesso.');
    }

    const contentType = upstream.headers.get('content-type') || '';

    if (contentType.includes('mpegurl') || finalSourceUrl.toLowerCase().includes('.m3u8')) {
      const m3u = await upstream.text();
      const shouldRewrite = m3u8NeedsRewrite(m3u);
      const payload = shouldRewrite ? rewriteM3U8(m3u, finalSourceUrl) : m3u;
      console.info('[stream-proxy] playlist_mode', {
        mode: shouldRewrite ? 'rewrite' : 'passthrough',
        source: finalSourceUrl,
      });
      res.status(upstream.status);
      res.setHeader('content-type', 'application/vnd.apple.mpegurl');
      res.setHeader('cache-control', 'no-store');
      res.send(payload);
      return;
    }

    console.info('[stream-proxy] binary_mode', {
      mode: 'proxy_binary',
      source: finalSourceUrl,
    });
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
  }
}
