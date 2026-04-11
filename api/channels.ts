import { enforceAccessToken } from './_security';

interface Channel {
  name: string;
  url: string;
  group?: string;
  type?: "live" | "movie" | "series" | "unknown";
  playback?: {
    directUrl: string;
    proxyUrl: string;
    preferDirect: boolean;
  };
}

interface XtreamCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

type RequestedType = 'all' | 'live' | 'movie' | 'series';

type CacheEntry = {
  data: Channel[];
  updatedAt: number;
};

const sanitizeUrl = (value: string) => value.replace(/\n/g, "").replace(/\r/g, "").trim();
const toProxyUrl = (url: string) => `/api/stream?url=${encodeURIComponent(url)}`;
const SERIES_KEYWORDS = ['series', 'série', 'tv shows', 'season', 'temporada'];
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_REFRESH_ATTEMPTS = 1;
const REFRESH_RETRY_DELAY_MS = 700;
const UPSTREAM_TIMEOUT_MS = 3200;
const MAX_CANDIDATE_URLS = 3;

const channelsCache: Partial<Record<RequestedType, CacheEntry>> = {};
const inFlightRefresh: Partial<Record<RequestedType, Promise<Channel[]>>> = {};

const hasSeriesKeyword = (value: string) => {
  const normalized = value.toLowerCase();
  return SERIES_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

function parseM3U(content: string): Channel[] {
  const lines = content.split(/\r?\n/);
  const channels: Channel[] = [];
  let currentName = "";
  let currentGroup = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
      const groupMatch = line.match(/group-title="([^"]+)"/);
      const commaMatch = line.match(/,(.*)$/);
      if (tvgNameMatch?.[1]) currentName = tvgNameMatch[1];
      else if (commaMatch?.[1]) currentName = commaMatch[1].trim();
      else currentName = "Canal Sem Nome";
      currentGroup = groupMatch?.[1]?.trim() || "";
    } else if (line.startsWith("http")) {
      const normalizedUrl = line.toLowerCase();
      const metadata = `${currentName} ${currentGroup}`.toLowerCase();
      let type: Channel["type"] = "unknown";
      if (normalizedUrl.includes("/series/") || hasSeriesKeyword(metadata)) type = "series";
      else if (normalizedUrl.includes("/live/")) type = "live";
      else if (normalizedUrl.includes("/movie/")) type = "movie";

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


function detectChannelType(channel: Channel): Exclude<Channel['type'], 'unknown'> | 'unknown' {
  if (channel.type && channel.type !== 'unknown') return channel.type;

  const haystack = `${channel.name || ''} ${channel.group || ''} ${channel.url || ''}`.toLowerCase();
  if (haystack.includes('/series/') || hasSeriesKeyword(haystack)) return 'series';
  if (haystack.includes('/movie/') || haystack.includes('filme') || haystack.includes('vod')) return 'movie';
  if (haystack.includes('/live/') || haystack.includes('ao vivo') || haystack.includes('canal')) return 'live';
  return 'unknown';
}

function filterByRequestedType(channels: Channel[], requestedType: RequestedType): Channel[] {
  if (requestedType === 'all') return channels;
  return channels.filter((channel) => detectChannelType(channel) === requestedType);
}

function withPlayback(channel: Channel): Channel {
  const directUrl = channel.url;
  const preferDirect = /^https?:\/\//i.test(directUrl);
  return {
    ...channel,
    playback: {
      directUrl,
      proxyUrl: toProxyUrl(directUrl),
      preferDirect,
    },
  };
}

function buildCandidateUrls(rawUrl: string): string[] {
  const cleaned = sanitizeUrl(rawUrl);
  if (!cleaned) return [];

  const candidates = new Set<string>();
  try {
    const parsed = new URL(cleaned.startsWith("http") ? cleaned : `http://${cleaned}`);
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
    candidates.add(cleaned);
  }

  return [...candidates];
}

const isLikelyNotFoundPage = (content: string) => {
  const normalized = content.toLowerCase();
  return (
    normalized.includes("not_found") ||
    normalized.includes("the page could not be found") ||
    normalized.includes("gru1::")
  );
};

function extractXtreamCredentials(rawUrl: string): XtreamCredentials | null {
  try {
    const parsed = new URL(rawUrl.startsWith("http") ? rawUrl : `http://${rawUrl}`);
    const username = parsed.searchParams.get("username")?.trim();
    const password = parsed.searchParams.get("password")?.trim();
    if (!username || !password) return null;

    return { baseUrl: `${parsed.protocol}//${parsed.host}`, username, password };
  } catch {
    return null;
  }
}

async function fetchXtreamJson<T>(url: string, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<T> {
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

    if (!response.ok) throw new Error(`Xtream API retornou ${response.status}`);

    const payload = (await response.text()).trim();
    if (!payload) throw new Error("Xtream API retornou vazio.");
    return JSON.parse(payload) as T;
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

  type LiveItem = { name?: string; stream_id?: string | number; category_name?: string };
  type VodItem = { name?: string; stream_id?: string | number; category_name?: string; container_extension?: string };
  type SeriesItem = { name?: string; series_id?: string | number; category_name?: string };

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
      if (!item.stream_id) continue;
      channels.push(withPlayback({
        name: item.name?.trim() || `Live ${item.stream_id}`,
        group: item.category_name?.trim() || "Ao vivo",
        type: "live",
        url: `${baseUrl}/live/${username}/${password}/${item.stream_id}.m3u8`,
      }));
    }
  }

  if (vodItems.status === "fulfilled" && Array.isArray(vodItems.value)) {
    for (const item of vodItems.value) {
      if (!item.stream_id) continue;
      const ext = (item.container_extension || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
      channels.push(withPlayback({
        name: item.name?.trim() || `Filme ${item.stream_id}`,
        group: item.category_name?.trim() || "Filmes",
        type: "movie",
        url: `${baseUrl}/movie/${username}/${password}/${item.stream_id}.${ext}`,
      }));
    }
  }


  if (seriesItems.status === "fulfilled" && Array.isArray(seriesItems.value)) {
    for (const item of seriesItems.value) {
      if (!item?.series_id) continue;
      channels.push(withPlayback({
        name: item.name?.trim() || `Série ${item.series_id}`,
        group: item.category_name?.trim() || "Séries",
        type: "series",
        url: `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_info&series_id=${encodeURIComponent(String(item.series_id))}`,
      }));
    }
  }

  if (channels.length === 0) {
    const liveErr = liveItems.status === "rejected" ? String(liveItems.reason) : "ok";
    const vodErr = vodItems.status === "rejected" ? String(vodItems.reason) : "ok";
    const seriesErr = seriesItems.status === "rejected" ? String(seriesItems.reason) : "ok";
    throw new Error(`Fallback Xtream sem itens disponíveis. live=${liveErr}; vod=${vodErr}; series=${seriesErr}`);
  }

  return channels;
}

async function resolveChannels(sourceUrl: string, requestedType: RequestedType): Promise<Channel[]> {
  const xtreamCreds = extractXtreamCredentials(sourceUrl);
  if (xtreamCreds) {
    try {
      return await buildChannelsFromXtream(sourceUrl, requestedType);
    } catch (xtreamError) {
      console.warn('Xtream direto falhou, tentando M3U.', xtreamError);
    }
  }

  const candidateUrls = buildCandidateUrls(sourceUrl).slice(0, MAX_CANDIDATE_URLS);
  let lastError = "Falha ao buscar a lista M3U.";
  let lastTriedUrl = "";

  for (const url of candidateUrls) {
    lastTriedUrl = url;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "*/*",
          "Cache-Control": "no-cache",
        },
      });

      const responseText = await response.text();

      if (!response.ok) {
        lastError = `IPTV Server returned ${response.status} para ${url}`;
        continue;
      }
      if (isLikelyNotFoundPage(responseText)) {
        lastError = `Servidor respondeu NOT_FOUND para ${url}`;
        continue;
      }
      if (!responseText.includes("#EXTM3U")) {
        lastError = `Resposta inválida em ${url} (não retornou M3U).`;
        continue;
      }

      const parsedChannels = parseM3U(responseText).map(withPlayback);
      const channels = filterByRequestedType(parsedChannels, requestedType);
      if (channels.length > 0) return channels;

      if (requestedType !== "all" && parsedChannels.length > 0) {
        return parsedChannels;
      }

      lastError = `M3U sem itens reproduzíveis em ${url}.`;
    } catch (err: any) {
      lastError = err?.message || `Erro de rede ao buscar ${url}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  const failureContext = `${lastError}${lastTriedUrl ? ` | Última tentativa: ${lastTriedUrl}` : ""}`;
  console.warn(`M3U falhou: ${failureContext}. Tentando Xtream API...`);

  return buildChannelsFromXtream(sourceUrl, requestedType);
}

function getCachedChannels(requestedType: RequestedType): CacheEntry | null {
  const direct = channelsCache[requestedType];
  if (direct?.data?.length) return direct;

  if (requestedType !== 'all') {
    const allCache = channelsCache.all;
    if (allCache?.data?.length) {
      const filtered = filterByRequestedType(allCache.data, requestedType);
      if (filtered.length > 0) {
        return { data: filtered, updatedAt: allCache.updatedAt };
      }
    }
  }

  return null;
}

function persistCache(requestedType: RequestedType, channels: Channel[]) {
  const entry: CacheEntry = { data: channels, updatedAt: Date.now() };
  channelsCache[requestedType] = entry;

  if (requestedType === 'all') {
    channelsCache.live = { data: filterByRequestedType(channels, 'live'), updatedAt: entry.updatedAt };
    channelsCache.movie = { data: filterByRequestedType(channels, 'movie'), updatedAt: entry.updatedAt };
    channelsCache.series = { data: filterByRequestedType(channels, 'series'), updatedAt: entry.updatedAt };
  }
}

async function refreshChannelsWithRetry(sourceUrl: string, requestedType: RequestedType): Promise<Channel[]> {
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_REFRESH_ATTEMPTS; attempt += 1) {
    try {
      const channels = await resolveChannels(sourceUrl, requestedType);
      if (Array.isArray(channels) && channels.length > 0) {
        persistCache(requestedType, channels);
      }
      return channels;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_REFRESH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
      }
    }
  }

  throw lastError || new Error('Falha ao atualizar lista.');
}

function ensureBackgroundRefresh(sourceUrl: string, requestedType: RequestedType): Promise<Channel[]> {
  const existing = inFlightRefresh[requestedType];
  if (existing) return existing;

  const refreshPromise = refreshChannelsWithRetry(sourceUrl, requestedType)
    .catch((error) => {
      const cached = getCachedChannels(requestedType);
      if (cached?.data?.length) {
        console.warn(`Atualização em background falhou para ${requestedType}, mantendo cache anterior.`, error);
        return cached.data;
      }
      throw error;
    })
    .finally(() => {
      delete inFlightRefresh[requestedType];
    });

  inFlightRefresh[requestedType] = refreshPromise;
  return refreshPromise;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  if (!enforceAccessToken(req, res)) return;

  try {
    const requestedType = (["all", "live", "movie", "series"].includes(String(req.query?.type || "all"))
      ? String(req.query?.type || "all")
      : "all") as RequestedType;

    const sourceUrl = sanitizeUrl(process.env.IPTV_M3U_URL || '');
    if (!sourceUrl) {
      res.status(500).json({ error: "IPTV_M3U_URL não configurada no ambiente." });
      return;
    }
    const cached = getCachedChannels(requestedType);

    if (cached?.data?.length) {
      const isExpired = Date.now() - cached.updatedAt > CACHE_TTL_MS;
      if (isExpired) {
        ensureBackgroundRefresh(sourceUrl, requestedType).catch((err) => {
          console.warn(`Refresh assíncrono falhou para ${requestedType}.`, err);
        });
      }
      res.status(200).json(cached.data);
      return;
    }

    const channels = await ensureBackgroundRefresh(sourceUrl, requestedType);
    res.status(200).json(channels);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to fetch channels",
      details: error?.message || "Erro desconhecido",
    });
  }
}
