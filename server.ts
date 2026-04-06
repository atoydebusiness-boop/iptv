import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Channel {
  name: string;
  url: string;
  group?: string;
  type?: "live" | "movie" | "series" | "unknown";
}

interface XtreamCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

type RequestedType = 'all' | 'live' | 'movie' | 'series';
type ChannelsApiResponse = {
  ok: true;
  stale: boolean;
  items: Channel[];
  source: 'origin' | 'cache';
  generatedAt: string;
};

type CacheEntry = {
  items: Channel[];
  updatedAt: number;
};

const REQUEST_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const RETRY_BACKOFF_MS = [2000, 5000, 10000] as const;

function extractXtreamCredentials(rawUrl: string): XtreamCredentials | null {
  try {
    const parsed = new URL(rawUrl.startsWith("http") ? rawUrl : `http://${rawUrl}`);
    const username = parsed.searchParams.get("username")?.trim();
    const password = parsed.searchParams.get("password")?.trim();

    if (!username || !password) return null;

    return {
      baseUrl: `${parsed.protocol}//${parsed.host}`,
      username,
      password,
    };
  } catch {
    return null;
  }
}

async function fetchXtreamJson<T>(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) {
      throw new Error(`Xtream API retornou ${response.status}`);
    }

    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Xtream API retornou vazio.");

    try {
      return JSON.parse(trimmed) as T;
    } catch {
      throw new Error("Xtream API não retornou JSON válido.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function buildChannelsFromXtream(rawUrl: string, requestedType: RequestedType): Promise<Channel[]> {
  const creds = extractXtreamCredentials(rawUrl);
  if (!creds) throw new Error("URL não contém credenciais Xtream válidas.");

  const { baseUrl, username, password } = creds;
  const liveUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
  const vodUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_vod_streams`;
  const seriesUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series`;

  type LiveItem = { name?: string; stream_id?: number | string; category_name?: string };
  type VodItem = { name?: string; stream_id?: number | string; category_name?: string; container_extension?: string };
  type SeriesItem = { name?: string; series_id?: number | string; category_name?: string };

  const shouldLoadLive = requestedType === 'all' || requestedType === 'live';
  const shouldLoadVod = requestedType === 'all' || requestedType === 'movie';
  const shouldLoadSeries = requestedType === 'all' || requestedType === 'series';

  const [liveItems, vodItems, seriesItems] = await Promise.allSettled([
    shouldLoadLive ? fetchXtreamJson<LiveItem[]>(liveUrl) : Promise.resolve([] as LiveItem[]),
    shouldLoadVod ? fetchXtreamJson<VodItem[]>(vodUrl) : Promise.resolve([] as VodItem[]),
    shouldLoadSeries ? fetchXtreamJson<SeriesItem[]>(seriesUrl) : Promise.resolve([] as SeriesItem[]),
  ]);

  const channels: Channel[] = [];

  if (liveItems.status === "fulfilled" && Array.isArray(liveItems.value)) {
    for (const item of liveItems.value) {
      if (!item?.stream_id) continue;
      channels.push({
        name: item.name?.trim() || `Live ${item.stream_id}`,
        group: item.category_name?.trim() || "Ao vivo",
        type: "live",
        url: `${baseUrl}/live/${username}/${password}/${item.stream_id}.m3u8`,
      });
    }
  }

  if (vodItems.status === "fulfilled" && Array.isArray(vodItems.value)) {
    for (const item of vodItems.value) {
      if (!item?.stream_id) continue;
      const ext = (item.container_extension || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
      channels.push({
        name: item.name?.trim() || `Filme ${item.stream_id}`,
        group: item.category_name?.trim() || "Filmes",
        type: "movie",
        url: `${baseUrl}/movie/${username}/${password}/${item.stream_id}.${ext}`,
      });
    }
  }


  if (seriesItems.status === "fulfilled" && Array.isArray(seriesItems.value)) {
    for (const item of seriesItems.value) {
      if (!item?.series_id) continue;
      channels.push({
        name: item.name?.trim() || `Série ${item.series_id}`,
        group: item.category_name?.trim() || "Séries",
        type: "series",
        url: `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_info&series_id=${encodeURIComponent(String(item.series_id))}`,
      });
    }
  }

  if (channels.length === 0) {
    const liveErr = liveItems.status === "rejected" ? liveItems.reason?.message || String(liveItems.reason) : "ok";
    const vodErr = vodItems.status === "rejected" ? vodItems.reason?.message || String(vodItems.reason) : "ok";
    const seriesErr = seriesItems.status === "rejected" ? seriesItems.reason?.message || String(seriesItems.reason) : "ok";
    throw new Error(`Fallback Xtream sem itens. live=${liveErr}; vod=${vodErr}; series=${seriesErr}`);
  }

  return channels;
}


function detectChannelType(channel: Channel): Exclude<Channel['type'], 'unknown'> | 'unknown' {
  if (channel.type && channel.type !== 'unknown') return channel.type;

  const haystack = `${channel.name || ''} ${channel.group || ''} ${channel.url || ''}`.toLowerCase();
  if (haystack.includes('/series/') || haystack.includes('series') || haystack.includes('temporada')) return 'series';
  if (haystack.includes('/movie/') || haystack.includes('filme') || haystack.includes('vod')) return 'movie';
  if (haystack.includes('/live/') || haystack.includes('ao vivo') || haystack.includes('canal')) return 'live';
  return 'unknown';
}

function filterByRequestedType(channels: Channel[], requestedType: RequestedType): Channel[] {
  if (requestedType === 'all') return channels;
  return channels.filter((channel) => detectChannelType(channel) === requestedType);
}

function parseM3U(content: string): Channel[] {
  const lines = content.split(/\r?\n/);
  const channels: Channel[] = [];
  let currentName = "";
  let currentGroup = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
      const groupMatch = line.match(/group-title="([^"]+)"/);
      const commaMatch = line.match(/,(.*)$/);
      if (tvgNameMatch && tvgNameMatch[1]) {
        currentName = tvgNameMatch[1];
      } else if (commaMatch && commaMatch[1]) {
        currentName = commaMatch[1].trim();
      } else {
        currentName = "Canal Sem Nome";
      }
      currentGroup = groupMatch?.[1]?.trim() || "";
    } else if (line.startsWith("http")) {
      const normalizedUrl = line.toLowerCase();
      let type: Channel["type"] = "unknown";
      if (normalizedUrl.includes("/live/")) type = "live";
      else if (normalizedUrl.includes("/movie/")) type = "movie";
      else if (normalizedUrl.includes("/series/")) type = "series";

      channels.push({
        name: currentName || "Canal Sem Nome",
        url: line,
        group: currentGroup,
        type,
      });
      currentName = "";
      currentGroup = "";
    }
  }
  return channels;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  const DEFAULT_IPTV_URL =
    "http://ryzeeng.pro:80/get.php?username=462763&password=322879&type=m3u_plus&output=hls";

  const sanitizeUrl = (value: string) =>
    value
      .replace(/\n/g, "")
      .replace(/\r/g, "")
      .trim();

  const buildCandidateUrls = () => {
    const rawUrl = process.env.IPTV_M3U_URL || DEFAULT_IPTV_URL;
    const cleaned = sanitizeUrl(rawUrl);

    if (!cleaned) return [];

    const candidates = new Set<string>();

    const addUrlVariants = (urlValue: string) => {
      try {
        const parsed = new URL(urlValue.startsWith("http") ? urlValue : `http://${urlValue}`);

        const output = (parsed.searchParams.get("output") || "").toLowerCase();
        const outputs = output ? [output, "m3u8", "mpegts"] : ["hls", "m3u8", "mpegts"];
        const protocols = [parsed.protocol, parsed.protocol === "http:" ? "https:" : "http:"];

        for (const protocol of protocols) {
          for (const out of outputs) {
            parsed.protocol = protocol;
            parsed.searchParams.set("output", out);
            candidates.add(parsed.toString());
          }
        }
      } catch {
        candidates.add(urlValue);
      }
    };

    addUrlVariants(cleaned);
    return [...candidates];
  };

  const inMemoryCache = new Map<RequestedType, CacheEntry>();
  const inFlightByType = new Map<RequestedType, Promise<CacheEntry>>();
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const cacheStateFor = (requestedType: RequestedType) => {
    const entry = inMemoryCache.get(requestedType);
    if (!entry) return { valid: null as CacheEntry | null, stale: null as CacheEntry | null };
    const age = Date.now() - entry.updatedAt;
    if (age <= CACHE_TTL_MS) return { valid: entry, stale: entry };
    return { valid: null, stale: entry };
  };
  const updateCache = (requestedType: RequestedType, items: Channel[]): CacheEntry => {
    const entry = { items, updatedAt: Date.now() };
    inMemoryCache.set(requestedType, entry);
    if (requestedType === 'all') {
      inMemoryCache.set('live', { items: filterByRequestedType(items, 'live'), updatedAt: entry.updatedAt });
      inMemoryCache.set('movie', { items: filterByRequestedType(items, 'movie'), updatedAt: entry.updatedAt });
      inMemoryCache.set('series', { items: filterByRequestedType(items, 'series'), updatedAt: entry.updatedAt });
    }
    return entry;
  };

  const isLikelyNotFoundPage = (content: string) => {
    const normalized = content.toLowerCase();
    return normalized.includes("not_found") || normalized.includes("the page could not be found") || normalized.includes("gru1::");
  };

  const isAbsoluteHttp = (value: string) => /^https?:\/\//i.test(value);
  const proxify = (url: string) => `/api/stream?url=${encodeURIComponent(url)}`;
  const STREAM_EXTENSIONS = ['m3u8', 'mp4', 'ts', 'mkv'];
  type SeriesInfoEpisode = { id?: string | number; container_extension?: string };
  type SeriesInfoPayload = { episodes?: Record<string, SeriesInfoEpisode[] | undefined> | SeriesInfoEpisode[] };
  const buildProxyHeaders = (sourceUrl: string, rangeHeader: string) => {
    const parsed = new URL(sourceUrl);
    const origin = `${parsed.protocol}//${parsed.host}`;

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: '*/*',
      Referer: `${origin}/`,
      Origin: origin,
    };

    if (typeof rangeHeader === 'string' && rangeHeader.trim()) {
      headers.Range = rangeHeader;
    }

    return headers;
  };
  const rewriteM3U8 = (content: string, sourceUrl: string) =>
    content
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        try {
          const absolute = new URL(trimmed, sourceUrl).toString();
          if (!isAbsoluteHttp(absolute)) return line;
          return proxify(absolute);
        } catch {
          return line;
        }
      })
      .join('\n');

  const buildStreamCandidates = (sourceUrl: string) => {
    const candidates = new Set<string>();
    const normalized = sourceUrl.toLowerCase();
    const shouldTryVODFallbacks = normalized.includes('/movie/') || normalized.includes('/series/');

    const add = (url: string) => {
      candidates.add(url);
      if (url.startsWith('http://')) candidates.add(url.replace('http://', 'https://'));
    };

    add(sourceUrl);

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
  };

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

  const resolveSeriesInfoToStream = async (seriesInfoUrl: string): Promise<string> => {
    const parsed = new URL(seriesInfoUrl);
    if (parsed.searchParams.get('action') !== 'get_series_info') return seriesInfoUrl;

    const username = parsed.searchParams.get('username') || '';
    const password = parsed.searchParams.get('password') || '';
    if (!username || !password) return seriesInfoUrl;

    const seriesResponse = await fetch(seriesInfoUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
  };

  app.get('/api/stream', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const sourceUrl = decodeURIComponent(rawUrl || '').trim();

    if (!isAbsoluteHttp(sourceUrl)) {
      res.status(400).json({ error: 'Invalid stream URL' });
      return;
    }

    try {
      const resolvedSourceUrl = await resolveSeriesInfoToStream(sourceUrl);
      const candidateUrls = buildStreamCandidates(resolvedSourceUrl);
      let upstream: Response | null = null;
      let finalSourceUrl = sourceUrl;
      let lastError = '';

      for (const candidateUrl of candidateUrls) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          const attempt = await fetch(candidateUrl, {
            signal: controller.signal,
            headers: buildProxyHeaders(
              candidateUrl,
              typeof req.headers.range === 'string' ? req.headers.range : '',
            ),
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
        const rewritten = rewriteM3U8(m3u, finalSourceUrl);
        res.status(upstream.status);
        res.setHeader('content-type', 'application/vnd.apple.mpegurl');
        res.setHeader('cache-control', 'no-store');
        res.send(rewritten);
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status);
      for (const key of ['content-type', 'accept-ranges', 'content-range', 'content-length']) {
        const value = upstream.headers.get(key);
        if (value) res.setHeader(key, value);
      }
      res.send(buffer);
    } catch (error: any) {
      res.status(502).json({ error: 'Stream proxy failed', details: error?.message || 'Unknown error' });
    }
  });

  // API route to proxy and parse M3U
  app.get("/api/channels", async (req, res) => {
    const requestedType = (["all", "live", "movie", "series"].includes(String(req.query?.type || "all"))
      ? String(req.query?.type || "all")
      : "all") as RequestedType;

    const cacheState = cacheStateFor(requestedType);
    if (cacheState.valid) {
      const ageMs = Date.now() - cacheState.valid.updatedAt;
      console.info(`[channels] cache=hit type=${requestedType} ageMs=${ageMs} items=${cacheState.valid.items.length}`);
      const payload: ChannelsApiResponse = {
        ok: true,
        stale: false,
        items: cacheState.valid.items,
        source: 'cache',
        generatedAt: new Date().toISOString(),
      };
      res.status(200).json(payload);
      return;
    }

    const inFlight = inFlightByType.get(requestedType);
    if (inFlight) {
      console.info(`[channels] lock=reused type=${requestedType}`);
      try {
        const shared = await inFlight;
        res.status(200).json({
          ok: true,
          stale: false,
          items: shared.items,
          source: 'origin',
          generatedAt: new Date().toISOString(),
        } satisfies ChannelsApiResponse);
        return;
      } catch {
        if (cacheState.stale?.items?.length) {
          res.status(200).json({
            ok: true,
            stale: true,
            items: cacheState.stale.items,
            source: 'cache',
            generatedAt: new Date().toISOString(),
          } satisfies ChannelsApiResponse);
          return;
        }
      }
    }

    const sourceUrl = sanitizeUrl(process.env.IPTV_M3U_URL || DEFAULT_IPTV_URL);
    const requestPromise = (async () => {
      const candidateUrls = buildCandidateUrls();
      let lastError = "Falha ao buscar a lista M3U.";
      let lastTriedUrl = "";

      for (const url of candidateUrls) {
        for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
          lastTriedUrl = url;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
          const startedAt = Date.now();

          try {
            const response = await fetch(url, {
              signal: controller.signal,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
                Accept: "*/*",
              },
            });

            const responseText = await response.text();
            const elapsed = Date.now() - startedAt;
            console.info(`[channels] origin elapsedMs=${elapsed} status=${response.status} cache=miss bytes=${responseText.length} url=${url} attempt=${attempt + 1}`);

            if (!response.ok) {
              lastError = `IPTV Server returned ${response.status} para ${url}`;
              throw new Error(lastError);
            }
            if (isLikelyNotFoundPage(responseText)) {
              lastError = `Servidor respondeu NOT_FOUND para ${url}.`;
              throw new Error(lastError);
            }
            if (!responseText.includes("#EXTM3U")) {
              lastError = `Resposta inválida do provedor em ${url} (não retornou M3U).`;
              throw new Error(lastError);
            }

            const parsedChannels = parseM3U(responseText);
            const channels = filterByRequestedType(parsedChannels, requestedType);
            const finalChannels =
              channels.length > 0 || requestedType === "all" ? channels : parsedChannels;

            if (finalChannels.length === 0) {
              lastError = `M3U sem itens reproduzíveis em ${url}.`;
              throw new Error(lastError);
            }

            return updateCache(requestedType, finalChannels);
          } catch (fetchError: any) {
            lastError = fetchError?.name === 'AbortError'
              ? `Timeout (${REQUEST_TIMEOUT_MS}ms) ao buscar M3U em ${url}.`
              : fetchError?.message || `Erro de rede ao buscar M3U em ${url}.`;
            const backoff = RETRY_BACKOFF_MS[attempt];
            if (backoff) {
              console.warn(`[channels] origin retry em ${backoff}ms (${attempt + 1}/${RETRY_BACKOFF_MS.length + 1}) motivo=${lastError}`);
              await sleep(backoff);
            }
          } finally {
            clearTimeout(timeout);
          }
        }
      }

      const m3uFailureContext = `${lastError}${lastTriedUrl ? ` Última tentativa: ${lastTriedUrl}` : ""}`;
      console.warn(`M3U fetch falhou (${m3uFailureContext}). Tentando fallback Xtream API: ${sourceUrl}`);
      const fallbackChannels = await buildChannelsFromXtream(sourceUrl, requestedType);
      console.log(`[channels] fallback=xtream items=${fallbackChannels.length}`);
      return updateCache(requestedType, fallbackChannels);
    })();

    inFlightByType.set(requestedType, requestPromise);

    try {
      const loaded = await requestPromise;
      res.status(200).json({
        ok: true,
        stale: false,
        items: loaded.items,
        source: 'origin',
        generatedAt: new Date().toISOString(),
      } satisfies ChannelsApiResponse);
    } catch (error: any) {
      console.error(`[channels] origin_failed type=${requestedType} reason=${error?.message || 'unknown'}`);
      if (cacheState.stale?.items?.length) {
        res.status(200).json({
          ok: true,
          stale: true,
          items: cacheState.stale.items,
          source: 'cache',
          generatedAt: new Date().toISOString(),
        } satisfies ChannelsApiResponse);
        return;
      }

      res.status(200).json({
        ok: true,
        stale: true,
        items: [],
        source: 'cache',
        generatedAt: new Date().toISOString(),
      } satisfies ChannelsApiResponse);
    } finally {
      inFlightByType.delete(requestedType);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
