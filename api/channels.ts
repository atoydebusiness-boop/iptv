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
type SeriesInfoEpisode = { id?: string | number; container_extension?: string };
type SeriesInfoPayload = { episodes?: Record<string, SeriesInfoEpisode[] | undefined> | SeriesInfoEpisode[] };

interface NormalizedResponse {
  live: Array<{ id: string; name: string; category: string; poster: string; source: string; type: 'live' }>;
  movies: Array<{ id: string; name: string; category: string; poster: string; source: string; type: 'movie' }>;
  series: Array<{
    id: string;
    name: string;
    category: string;
    poster: string;
    seasons: Array<{
      seasonNumber: number;
      episodes: Array<{ id: string; name: string; seasonNumber: number; episodeNumber: number; source: string }>;
    }>;
    type: 'series';
  }>;
  diagnostics: {
    totalReceived: number;
    totalDiscarded: number;
    totalByType: Record<'live' | 'movie' | 'series' | 'unknown', number>;
    discardedReasons: Record<string, number>;
  };
}

const DEFAULT_IPTV_URL =
  "http://ryzeeng.pro:80/get.php?username=462763&password=322879&type=m3u_plus&output=hls";

const sanitizeUrl = (value: string) => value.replace(/\n/g, "").replace(/\r/g, "").trim();

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

async function normalizeCatalog(channels: Channel[], sourceUrl: string): Promise<NormalizedResponse> {
  const diagnostics: NormalizedResponse['diagnostics'] = {
    totalReceived: channels.length,
    totalDiscarded: 0,
    totalByType: { live: 0, movie: 0, series: 0, unknown: 0 },
    discardedReasons: {},
  };
  const addReason = (reason: string) => {
    diagnostics.totalDiscarded += 1;
    diagnostics.discardedReasons[reason] = (diagnostics.discardedReasons[reason] || 0) + 1;
  };

  const live: NormalizedResponse['live'] = [];
  const movies: NormalizedResponse['movies'] = [];
  const seriesMap = new Map<string, NormalizedResponse['series'][number]>();
  const creds = extractXtreamCredentials(sourceUrl);

  for (const item of channels) {
    const type = detectChannelType(item);
    diagnostics.totalByType[type] += 1;
    if (type === 'unknown') {
      addReason('unknown_type');
      continue;
    }
    if (type === 'live') {
      if (!item.url || !item.name) {
        addReason('live_missing_required_fields');
        continue;
      }
      live.push({ id: item.url, name: item.name, category: item.group || 'Ao vivo', poster: '', source: item.url, type: 'live' });
      continue;
    }
    if (type === 'movie') {
      if (!item.url || !item.name) {
        addReason('movie_missing_required_fields');
        continue;
      }
      movies.push({ id: item.url, name: item.name, category: item.group || 'Filmes', poster: '', source: item.url, type: 'movie' });
      continue;
    }

    const seriesId = item.url.match(/series_id=([^&]+)/i)?.[1] || item.url.match(/\/series\/[^/]+\/[^/]+\/([^/.?]+)/i)?.[1];
    if (!seriesId) {
      addReason('series_missing_id');
      continue;
    }
    let seriesItem = seriesMap.get(seriesId);
    if (!seriesItem) {
      seriesItem = { id: decodeURIComponent(seriesId), name: item.name || `Série ${seriesId}`, category: item.group || 'Séries', poster: '', seasons: [], type: 'series' };
      seriesMap.set(seriesId, seriesItem);
    }

    if (creds && item.url.includes('action=get_series_info') && !seriesItem.seasons.length) {
      try {
        const payload = await fetchXtreamJson<SeriesInfoPayload>(item.url, 10000);
        if (Array.isArray(payload.episodes)) {
          seriesItem.seasons = [{
            seasonNumber: 1,
            episodes: payload.episodes.filter((ep) => ep?.id).map((ep, i) => ({
              id: String(ep.id),
              name: `Episódio ${i + 1}`,
              seasonNumber: 1,
              episodeNumber: i + 1,
              source: `${creds.baseUrl}/series/${creds.username}/${creds.password}/${ep.id}.${(ep.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4'}`,
            })),
          }];
        } else if (payload.episodes) {
          seriesItem.seasons = Object.keys(payload.episodes).map((seasonKey) => {
            const seasonNumber = Number(seasonKey) || 1;
            const rawEpisodes = (payload.episodes as Record<string, SeriesInfoEpisode[] | undefined>)[seasonKey] || [];
            return {
              seasonNumber,
              episodes: rawEpisodes.filter((ep) => ep?.id).map((ep, i) => ({
                id: String(ep.id),
                name: `Episódio ${i + 1}`,
                seasonNumber,
                episodeNumber: i + 1,
                source: `${creds.baseUrl}/series/${creds.username}/${creds.password}/${ep.id}.${(ep.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4'}`,
              })),
            };
          }).filter((season) => season.episodes.length > 0);
        }
      } catch {
        // no-op: fallback abaixo
      }
    }

    if (!seriesItem.seasons.length && item.url) {
      seriesItem.seasons = [{
        seasonNumber: 1,
        episodes: [{ id: `${seriesId}-1`, name: item.name || 'Episódio 1', seasonNumber: 1, episodeNumber: 1, source: item.url }],
      }];
    }
  }

  console.log(`[catalog] received=${diagnostics.totalReceived} byType=${JSON.stringify(diagnostics.totalByType)} discarded=${diagnostics.totalDiscarded} reasons=${JSON.stringify(diagnostics.discardedReasons)}`);

  return { live, movies, series: [...seriesMap.values()], diagnostics };
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

async function fetchXtreamJson<T>(url: string, timeoutMs = 7000): Promise<T> {
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

async function resolveChannels(sourceUrl: string, requestedType: RequestedType): Promise<Channel[]> {
  const candidateUrls = buildCandidateUrls(sourceUrl);
  let lastError = "Falha ao buscar a lista M3U.";
  let lastTriedUrl = "";

  for (const url of candidateUrls) {
    lastTriedUrl = url;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

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

      const parsedChannels = parseM3U(responseText);
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

  try {
    const requestedType = (["all", "live", "movie", "series"].includes(String(req.query?.type || "all"))
      ? String(req.query?.type || "all")
      : "all") as RequestedType;

    const sourceUrl = sanitizeUrl(process.env.IPTV_M3U_URL || DEFAULT_IPTV_URL);
    const channels = await resolveChannels(sourceUrl, "all");
    const normalized = await normalizeCatalog(channels, sourceUrl);
    const filtered = requestedType === 'all'
      ? normalized
      : {
          ...normalized,
          live: requestedType === 'live' ? normalized.live : [],
          movies: requestedType === 'movie' ? normalized.movies : [],
          series: requestedType === 'series' ? normalized.series : [],
        };
    res.status(200).json(filtered);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to fetch channels",
      details: error?.message || "Erro desconhecido",
    });
  }
}
