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

const DEFAULT_IPTV_URL =
  "http://ryzeeng.pro:80/get.php?username=462763&password=322879&type=m3u_plus&output=hls";
const REQUEST_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const RETRY_BACKOFF_MS = [2000, 5000, 10000] as const;

const sanitizeUrl = (value: string) => value.replace(/\n/g, "").replace(/\r/g, "").trim();
const SERIES_KEYWORDS = ['series', 'série', 'tv shows', 'season', 'temporada'];

const inMemoryCache = new Map<RequestedType, CacheEntry>();
const inFlightByType = new Map<RequestedType, Promise<CacheEntry>>();

const hasSeriesKeyword = (value: string) => {
  const normalized = value.toLowerCase();
  return SERIES_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function nowIso() {
  return new Date().toISOString();
}

function getCacheState(requestedType: RequestedType) {
  const entry = inMemoryCache.get(requestedType);
  if (!entry) return { valid: null as CacheEntry | null, stale: null as CacheEntry | null };

  const age = Date.now() - entry.updatedAt;
  if (age <= CACHE_TTL_MS) {
    return { valid: entry, stale: entry };
  }

  return { valid: null, stale: entry };
}

function updateCache(requestedType: RequestedType, items: Channel[]): CacheEntry {
  const entry = { items, updatedAt: Date.now() };
  inMemoryCache.set(requestedType, entry);
  if (requestedType === 'all') {
    inMemoryCache.set('live', {
      items: filterByRequestedType(items, 'live'),
      updatedAt: entry.updatedAt,
    });
    inMemoryCache.set('movie', {
      items: filterByRequestedType(items, 'movie'),
      updatedAt: entry.updatedAt,
    });
    inMemoryCache.set('series', {
      items: filterByRequestedType(items, 'series'),
      updatedAt: entry.updatedAt,
    });
  }
  return entry;
}

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

async function fetchXtreamJson<T>(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const startedAt = Date.now();
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
    const elapsed = Date.now() - startedAt;
    console.info(`[channels] xtream elapsedMs=${elapsed} status=${response.status} bytes=${payload.length} url=${url}`);
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
      if (!item.stream_id) continue;
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
    const liveErr = liveItems.status === "rejected" ? String(liveItems.reason) : "ok";
    const vodErr = vodItems.status === "rejected" ? String(vodItems.reason) : "ok";
    const seriesErr = seriesItems.status === "rejected" ? String(seriesItems.reason) : "ok";
    throw new Error(`Fallback Xtream sem itens disponíveis. live=${liveErr}; vod=${vodErr}; series=${seriesErr}`);
  }

  return channels;
}

async function fetchChannelsFromOrigin(sourceUrl: string, requestedType: RequestedType): Promise<Channel[]> {
  const candidateUrls = buildCandidateUrls(sourceUrl);
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
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "*/*",
            "Cache-Control": "no-cache",
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
          lastError = `Servidor respondeu NOT_FOUND para ${url}`;
          throw new Error(lastError);
        }
        if (!responseText.includes("#EXTM3U")) {
          lastError = `Resposta inválida em ${url} (não retornou M3U).`;
          throw new Error(lastError);
        }

        const parsedChannels = parseM3U(responseText);
        const channels = filterByRequestedType(parsedChannels, requestedType);
        if (channels.length > 0) return channels;

        if (requestedType !== "all" && parsedChannels.length > 0) {
          return parsedChannels;
        }

        lastError = `M3U sem itens reproduzíveis em ${url}.`;
        throw new Error(lastError);
      } catch (err: any) {
        lastError = err?.name === 'AbortError'
          ? `Timeout (${REQUEST_TIMEOUT_MS}ms) ao buscar ${url}`
          : err?.message || `Erro de rede ao buscar ${url}`;

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

  const failureContext = `${lastError}${lastTriedUrl ? ` | Última tentativa: ${lastTriedUrl}` : ""}`;
  console.warn(`M3U falhou: ${failureContext}. Tentando Xtream API...`);
  return buildChannelsFromXtream(sourceUrl, requestedType);
}

async function loadAndCache(sourceUrl: string, requestedType: RequestedType) {
  const resolved = await fetchChannelsFromOrigin(sourceUrl, requestedType);
  return updateCache(requestedType, resolved);
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

  const requestedType = (["all", "live", "movie", "series"].includes(String(req.query?.type || "all"))
    ? String(req.query?.type || "all")
    : "all") as RequestedType;

  const sourceUrl = sanitizeUrl(process.env.IPTV_M3U_URL || DEFAULT_IPTV_URL);
  const cacheState = getCacheState(requestedType);

  if (cacheState.valid) {
    const ageMs = Date.now() - cacheState.valid.updatedAt;
    console.info(`[channels] cache=hit type=${requestedType} ageMs=${ageMs} items=${cacheState.valid.items.length}`);
    const payload: ChannelsApiResponse = {
      ok: true,
      stale: false,
      items: cacheState.valid.items,
      source: 'cache',
      generatedAt: nowIso(),
    };
    res.status(200).json(payload);
    return;
  }

  const inFlight = inFlightByType.get(requestedType);
  if (inFlight) {
    console.info(`[channels] lock=reused type=${requestedType}`);
    try {
      const fromInflight = await inFlight;
      const payload: ChannelsApiResponse = {
        ok: true,
        stale: false,
        items: fromInflight.items,
        source: 'origin',
        generatedAt: nowIso(),
      };
      res.status(200).json(payload);
      return;
    } catch {
      if (cacheState.stale?.items?.length) {
        const payload: ChannelsApiResponse = {
          ok: true,
          stale: true,
          items: cacheState.stale.items,
          source: 'cache',
          generatedAt: nowIso(),
        };
        res.status(200).json(payload);
        return;
      }
    }
  }

  const requestPromise = loadAndCache(sourceUrl, requestedType);
  inFlightByType.set(requestedType, requestPromise);

  try {
    const refreshed = await requestPromise;
    const payload: ChannelsApiResponse = {
      ok: true,
      stale: false,
      items: refreshed.items,
      source: 'origin',
      generatedAt: nowIso(),
    };
    res.status(200).json(payload);
  } catch (error: any) {
    console.error(`[channels] origin_failed type=${requestedType} reason=${error?.message || 'unknown'}`);

    if (cacheState.stale?.items?.length) {
      const payload: ChannelsApiResponse = {
        ok: true,
        stale: true,
        items: cacheState.stale.items,
        source: 'cache',
        generatedAt: nowIso(),
      };
      res.status(200).json(payload);
      return;
    }

    res.status(200).json({
      ok: true,
      stale: true,
      items: [],
      source: 'cache',
      generatedAt: nowIso(),
    } satisfies ChannelsApiResponse);
  } finally {
    inFlightByType.delete(requestedType);
  }
}
