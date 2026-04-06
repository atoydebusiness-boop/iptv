interface Channel {
  name: string;
  url: string;
  group?: string;
  type: "live" | "movie" | "series" | "unknown";
}

type RequestedType = "all" | "live" | "movie" | "series";
type ErrorCode =
  | "SERVER_UNAVAILABLE"
  | "TIMEOUT"
  | "EMPTY_RESPONSE"
  | "PARSE_ERROR"
  | "INVALID_CREDENTIALS"
  | "UPSTREAM_HTTP_ERROR"
  | "UNKNOWN_ERROR";

interface ApiErrorPayload {
  ok: false;
  errorCode: ErrorCode;
  message: string;
  details?: string;
}

interface ApiSuccessPayload {
  ok: true;
  items: Channel[];
  meta: {
    requestedType: RequestedType;
    total: number;
    generatedAt: string;
    source: "m3u" | "xtream";
  };
}

interface XtreamCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

class ChannelLoadError extends Error {
  code: ErrorCode;
  httpStatus: number;

  constructor(code: ErrorCode, message: string, httpStatus = 500, details?: string) {
    super(details ? `${message}: ${details}` : message);
    this.name = "ChannelLoadError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const DEFAULT_IPTV_URL =
  "http://rozelds.shop:80/get.php?username=462763&password=322879&type=m3u_plus&output=hls";
const FALLBACK_IPTV_URL =
  "http://rozelds.shop:80/get.php?username=462763&password=322879&type=m3u_plus&output=mpegts";
const LOCKED_SOURCE_URLS = [DEFAULT_IPTV_URL, FALLBACK_IPTV_URL] as const;
const CHANNEL_CACHE_TTL_MS = 2 * 60 * 1000;
const M3U_TIMEOUT_MS = 15000;
const XTREAM_TIMEOUT_MS = 15000;

const sanitizeUrl = (value: string) => value.replace(/\n/g, "").replace(/\r/g, "").trim();

type ChannelCacheState = {
  channels: Channel[];
  fetchedAt: number;
};

let cachedAllChannels: ChannelCacheState | null = null;
let inflightAllChannelsPromise: Promise<{ channels: Channel[]; source: "m3u" | "xtream" }> | null = null;

const normalize = (text: string) => text.trim().toLowerCase();

function detectChannelType(channel: Pick<Channel, "name" | "group" | "url" | "type">): Channel["type"] {
  if (channel.type && channel.type !== "unknown") return channel.type;

  const haystack = `${channel.name || ""} ${channel.group || ""} ${channel.url || ""}`.toLowerCase();
  if (haystack.includes("/series/") || haystack.includes("series") || haystack.includes("temporada")) return "series";
  if (haystack.includes("/movie/") || haystack.includes("filme") || haystack.includes("vod")) return "movie";
  if (haystack.includes("/live/") || haystack.includes("ao vivo") || haystack.includes("canal")) return "live";
  return "unknown";
}

function filterByRequestedType(channels: Channel[], requestedType: RequestedType): Channel[] {
  if (requestedType === "all") return channels;
  return channels.filter((channel) => detectChannelType(channel) === requestedType);
}

function mapError(error: unknown, fallbackMessage = "Falha ao buscar canais"): ChannelLoadError {
  if (error instanceof ChannelLoadError) return error;

  const message = String((error as any)?.message || "");
  const normalizedMessage = message.toLowerCase();

  if ((error as any)?.name === "AbortError" || normalizedMessage.includes("timeout")) {
    return new ChannelLoadError("TIMEOUT", "Timeout ao buscar a lista", 504, message);
  }

  if (normalizedMessage.includes("failed to fetch") || normalizedMessage.includes("econn") || normalizedMessage.includes("enotfound")) {
    return new ChannelLoadError("SERVER_UNAVAILABLE", "Servidor de origem indisponível", 503, message);
  }

  if (normalizedMessage.includes("credenciais") || normalizedMessage.includes("username") || normalizedMessage.includes("password")) {
    return new ChannelLoadError("INVALID_CREDENTIALS", "Credenciais inválidas", 401, message);
  }

  return new ChannelLoadError("UNKNOWN_ERROR", fallbackMessage, 500, message);
}

function validateM3UHeader(content: string) {
  if (!content || !content.trim()) {
    throw new ChannelLoadError("EMPTY_RESPONSE", "Resposta da lista vazia", 502);
  }

  if (!content.includes("#EXTM3U")) {
    throw new ChannelLoadError("PARSE_ERROR", "Resposta não parece ser M3U válido", 502);
  }
}

function parseM3U(content: string): Channel[] {
  const lines = content.split(/\r?\n/);
  const channels: Channel[] = [];
  let pendingName = "";
  let pendingGroup = "";
  let pendingType: Channel["type"] = "unknown";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const tvgNameMatch = line.match(/tvg-name="([^"]+)"/i);
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const commaNameMatch = line.match(/,(.*)$/);

      pendingName = tvgNameMatch?.[1]?.trim() || commaNameMatch?.[1]?.trim() || "Canal sem nome";
      pendingGroup = groupMatch?.[1]?.trim() || "Sem categoria";

      const hint = normalize(`${pendingName} ${pendingGroup}`);
      if (hint.includes("series") || hint.includes("temporada")) pendingType = "series";
      else if (hint.includes("filme") || hint.includes("movie") || hint.includes("vod")) pendingType = "movie";
      else if (hint.includes("ao vivo") || hint.includes("live") || hint.includes("canal")) pendingType = "live";
      else pendingType = "unknown";
      continue;
    }

    if (/^https?:\/\//i.test(line)) {
      const inferred = detectChannelType({
        name: pendingName,
        group: pendingGroup,
        url: line,
        type: pendingType,
      });

      channels.push({
        name: pendingName || "Canal sem nome",
        group: pendingGroup || "Sem categoria",
        url: line,
        type: inferred,
      });

      pendingName = "";
      pendingGroup = "";
      pendingType = "unknown";
    }
  }

  if (channels.length === 0) {
    throw new ChannelLoadError("PARSE_ERROR", "Parser não encontrou itens reproduzíveis no M3U", 502);
  }

  return channels;
}

const isLikelyNotFoundPage = (content: string) => {
  const normalized = content.toLowerCase();
  return (
    normalized.includes("not_found") ||
    normalized.includes("the page could not be found") ||
    normalized.includes("gru1::")
  );
};

function parseSourceUrls(): string[] {
  return [...LOCKED_SOURCE_URLS].map(sanitizeUrl).filter(Boolean);
}

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

function buildLogger(scope: string) {
  const startedAt = Date.now();
  return (payload: Record<string, unknown>) => {
    console.log(
      JSON.stringify({
        scope,
        elapsedMs: Date.now() - startedAt,
        ...payload,
      }),
    );
  };
}

async function fetchWithMetrics(url: string, timeoutMs: number, accept: string, scope: string): Promise<{ response: Response; body: string }> {
  const log = buildLogger(scope);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const startedAt = Date.now();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: accept,
        "Cache-Control": "no-cache",
      },
    });
    const body = await response.text();
    const responseTimeMs = Date.now() - startedAt;

    log({ url, status: response.status, responseTimeMs, responseSizeBytes: Buffer.byteLength(body, "utf8") });

    return { response, body };
  } catch (error: any) {
    log({ url, failed: true, reason: error?.message || String(error) });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchXtreamJson<T>(url: string): Promise<T> {
  const { response, body } = await fetchWithMetrics(url, XTREAM_TIMEOUT_MS, "application/json,text/plain,*/*", "xtream-fetch");

  if (response.status === 401 || response.status === 403) {
    throw new ChannelLoadError("INVALID_CREDENTIALS", "Credenciais inválidas no servidor Xtream", 401);
  }

  if (!response.ok) {
    throw new ChannelLoadError("UPSTREAM_HTTP_ERROR", `Xtream API retornou ${response.status}`, 502);
  }

  if (!body.trim()) {
    throw new ChannelLoadError("EMPTY_RESPONSE", "Xtream API retornou corpo vazio", 502);
  }

  try {
    return JSON.parse(body) as T;
  } catch (error: any) {
    throw new ChannelLoadError("PARSE_ERROR", "Xtream API retornou JSON inválido", 502, error?.message);
  }
}

async function buildChannelsFromXtream(rawUrl: string, requestedType: RequestedType): Promise<Channel[]> {
  const creds = extractXtreamCredentials(rawUrl);
  if (!creds) throw new ChannelLoadError("INVALID_CREDENTIALS", "URL não contém credenciais Xtream válidas", 401);

  const { baseUrl, username, password } = creds;
  const liveUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
  const vodUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_vod_streams`;
  const seriesUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series`;

  type LiveItem = { name?: string; stream_id?: string | number; category_name?: string };
  type VodItem = { name?: string; stream_id?: string | number; category_name?: string; container_extension?: string };
  type SeriesItem = { name?: string; series_id?: string | number; category_name?: string };

  const shouldLoadLive = requestedType === "all" || requestedType === "live";
  const shouldLoadVod = requestedType === "all" || requestedType === "movie";
  const shouldLoadSeries = requestedType === "all" || requestedType === "series";

  const [liveItems, vodItems, seriesItems] = await Promise.allSettled([
    shouldLoadLive ? fetchXtreamJson<LiveItem[]>(liveUrl) : Promise.resolve([] as LiveItem[]),
    shouldLoadVod ? fetchXtreamJson<VodItem[]>(vodUrl) : Promise.resolve([] as VodItem[]),
    shouldLoadSeries ? fetchXtreamJson<SeriesItem[]>(seriesUrl) : Promise.resolve([] as SeriesItem[]),
  ]);

  const channels: Channel[] = [];

  if (liveItems.status === "fulfilled") {
    for (const item of liveItems.value || []) {
      if (!item.stream_id) continue;
      channels.push({
        name: item.name?.trim() || `Live ${item.stream_id}`,
        group: item.category_name?.trim() || "Ao vivo",
        type: "live",
        url: `${baseUrl}/live/${username}/${password}/${item.stream_id}.m3u8`,
      });
    }
  }

  if (vodItems.status === "fulfilled") {
    for (const item of vodItems.value || []) {
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

  if (seriesItems.status === "fulfilled") {
    for (const item of seriesItems.value || []) {
      if (!item.series_id) continue;
      channels.push({
        name: item.name?.trim() || `Série ${item.series_id}`,
        group: item.category_name?.trim() || "Séries",
        type: "series",
        url: `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_info&series_id=${encodeURIComponent(String(item.series_id))}`,
      });
    }
  }

  if (channels.length === 0) {
    const reasons = [liveItems, vodItems, seriesItems]
      .filter((item) => item.status === "rejected")
      .map((item: PromiseRejectedResult) => item.reason?.message || String(item.reason));

    const details = reasons.length > 0 ? reasons.join(" | ") : "Sem itens nas respostas Xtream";
    throw new ChannelLoadError("EMPTY_RESPONSE", "Fallback Xtream retornou vazio", 502, details);
  }

  return channels;
}

async function resolveChannelsFromM3U(sourceUrls: string[], requestedType: RequestedType): Promise<Channel[]> {
  const allErrors: string[] = [];

  for (const sourceUrl of sourceUrls) {
    try {
      const { response, body } = await fetchWithMetrics(sourceUrl, M3U_TIMEOUT_MS, "*/*", "m3u-fetch");

      if (response.status === 401 || response.status === 403) {
        throw new ChannelLoadError("INVALID_CREDENTIALS", "Credenciais inválidas no endpoint da lista", 401);
      }

      if (!response.ok) {
        throw new ChannelLoadError("UPSTREAM_HTTP_ERROR", `Servidor da lista retornou ${response.status}`, 502);
      }

      if (isLikelyNotFoundPage(body)) {
        throw new ChannelLoadError("SERVER_UNAVAILABLE", "Servidor retornou página de erro/not_found", 503);
      }

      validateM3UHeader(body);
      const parsed = parseM3U(body);
      const typed = parsed.map((item) => ({ ...item, type: detectChannelType(item) }));
      const filtered = filterByRequestedType(typed, requestedType);

      if (filtered.length === 0) {
        throw new ChannelLoadError("EMPTY_RESPONSE", "Lista parseada sem itens para o tipo solicitado", 502);
      }

      return filtered;
    } catch (error) {
      const mapped = mapError(error, "Falha ao carregar M3U");
      allErrors.push(`${sourceUrl}: ${mapped.message}`);
    }
  }

  throw new ChannelLoadError("SERVER_UNAVAILABLE", "Nenhuma origem M3U respondeu com sucesso", 503, allErrors.join(" | "));
}

function isCacheFresh(cache: ChannelCacheState | null) {
  if (!cache) return false;
  return Date.now() - cache.fetchedAt <= CHANNEL_CACHE_TTL_MS;
}

async function resolveAllChannelsWithCache(sourceUrls: string[]): Promise<{ channels: Channel[]; source: "m3u" | "xtream" }> {
  if (isCacheFresh(cachedAllChannels)) {
    return { channels: cachedAllChannels!.channels, source: "m3u" };
  }

  if (inflightAllChannelsPromise) {
    return inflightAllChannelsPromise;
  }

  inflightAllChannelsPromise = (async () => {
    try {
      const channels = await resolveChannelsFromM3U(sourceUrls, "all");
      cachedAllChannels = { channels, fetchedAt: Date.now() };
      return { channels, source: "m3u" as const };
    } catch (m3uError) {
      const fallback = await buildChannelsFromXtream(sourceUrls[0], "all");
      cachedAllChannels = { channels: fallback, fetchedAt: Date.now() };
      console.warn("M3U falhou, usando fallback Xtream.", (m3uError as Error)?.message || String(m3uError));
      return { channels: fallback, source: "xtream" as const };
    }
  })().finally(() => {
    inflightAllChannelsPromise = null;
  });

  return inflightAllChannelsPromise;
}

function parseRequestedType(value: unknown): RequestedType {
  const candidate = String(value || "all");
  if (candidate === "all" || candidate === "live" || candidate === "movie" || candidate === "series") return candidate;
  return "all";
}

function toApiError(error: unknown): ApiErrorPayload {
  const mapped = mapError(error, "Erro ao carregar lista");

  return {
    ok: false,
    errorCode: mapped.code,
    message: mapped.message,
    details: mapped.message,
  };
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
    res.status(405).json({ ok: false, errorCode: "UNKNOWN_ERROR", message: "Method Not Allowed" });
    return;
  }

  const requestedType = parseRequestedType(req.query?.type);

  try {
    const sourceUrls = parseSourceUrls();
    const { channels: allChannels, source } = await resolveAllChannelsWithCache(sourceUrls);
    const filtered = filterByRequestedType(allChannels, requestedType);

    if (filtered.length === 0) {
      throw new ChannelLoadError("EMPTY_RESPONSE", "Nenhum item disponível após normalização", 502);
    }

    const payload: ApiSuccessPayload = {
      ok: true,
      items: filtered,
      meta: {
        requestedType,
        total: filtered.length,
        generatedAt: new Date().toISOString(),
        source,
      },
    };

    res.status(200).json(payload);
  } catch (error: any) {
    if (cachedAllChannels?.channels?.length) {
      const fallbackChannels = filterByRequestedType(cachedAllChannels.channels, requestedType);
      if (fallbackChannels.length > 0) {
        res.setHeader("X-Cache", "STALE");
        const payload: ApiSuccessPayload = {
          ok: true,
          items: fallbackChannels,
          meta: {
            requestedType,
            total: fallbackChannels.length,
            generatedAt: new Date().toISOString(),
            source: "m3u",
          },
        };
        res.status(200).json(payload);
        return;
      }
    }

    const mapped = mapError(error, "Erro ao carregar canais");
    const apiError = toApiError(mapped);
    res.status(mapped.httpStatus).json(apiError);
  }
}
