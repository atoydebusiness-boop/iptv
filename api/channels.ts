interface NormalizedChannel {
  id: string;
  name: string;
  group: string;
  url: string;
  kind: "live" | "movie" | "series" | "unknown";
}

type RequestedType = "all" | "live" | "movie" | "series";
type ErrorCode =
  | "server_unavailable"
  | "timeout"
  | "empty_response"
  | "html_instead_of_playlist"
  | "invalid_credentials"
  | "forbidden"
  | "endpoint_not_found"
  | "server_error"
  | "unsupported_format"
  | "parse_error"
  | "upstream_http_error"
  | "unknown_error";

interface ParseDiagnostics {
  totalLines: number;
  extinfLines: number;
  urlLines: number;
  foundItems: number;
  discardedItems: number;
  discardReasons: Record<string, number>;
}

interface ApiErrorPayload {
  ok: false;
  error: ErrorCode;
  status?: number;
  statusText?: string;
  message: string;
  diagnostics?: {
    responseTime?: number;
    contentType?: string;
    contentLength?: string;
    responseSize?: number;
    headers?: Record<string, string>;
    preview?: string;
  };
  reason?: string;
  parseDiagnostics?: ParseDiagnostics;
}

interface ApiSuccessPayload {
  ok: true;
  items: NormalizedChannel[];
  meta: {
    requestedType: RequestedType;
    total: number;
    generatedAt: string;
  };
}

class ChannelLoadError extends Error {
  code: ErrorCode;
  httpStatus: number;
  upstreamStatus?: number;
  upstreamStatusText?: string;
  upstreamHeaders?: Record<string, string>;
  responseTimeMs?: number;
  responseSizeBytes?: number;
  contentType?: string;
  contentLength?: string;
  reason: string;
  preview?: string;
  diagnostics?: ParseDiagnostics;

  constructor(params: {
    code: ErrorCode;
    message: string;
    reason: string;
    httpStatus?: number;
    upstreamStatus?: number;
    upstreamStatusText?: string;
    upstreamHeaders?: Record<string, string>;
    responseTimeMs?: number;
    responseSizeBytes?: number;
    contentType?: string;
    contentLength?: string;
    preview?: string;
    diagnostics?: ParseDiagnostics;
  }) {
    super(params.message);
    this.name = "ChannelLoadError";
    this.code = params.code;
    this.reason = params.reason;
    this.httpStatus = params.httpStatus ?? 500;
    this.upstreamStatus = params.upstreamStatus;
    this.upstreamStatusText = params.upstreamStatusText;
    this.upstreamHeaders = params.upstreamHeaders;
    this.responseTimeMs = params.responseTimeMs;
    this.responseSizeBytes = params.responseSizeBytes;
    this.contentType = params.contentType;
    this.contentLength = params.contentLength;
    this.preview = params.preview;
    this.diagnostics = params.diagnostics;
  }
}

const PLAYLIST_SOURCE_URL =
  "http://rozelds.shop:80/get.php?username=462763&password=322879&type=m3u_plus&output=hls";
const M3U_TIMEOUT_MS = 20000;
const PREVIEW_LIMIT = 500;

const sanitizeUrl = (value: string) => value.replace(/\n/g, "").replace(/\r/g, "").trim();
const normalize = (text?: string) => (text || "").trim().toLowerCase();

const PREVIEW_SANITIZE_REGEX = /\s+/g;
const ABSOLUTE_URL_REGEX = /^https?:\/\//i;

function safePreview(text: string, limit = PREVIEW_LIMIT): string {
  return text.replace(PREVIEW_SANITIZE_REGEX, " ").trim().slice(0, limit);
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

function detectKind(name: string, group: string, url: string): NormalizedChannel["kind"] {
  const haystack = `${name} ${group} ${url}`.toLowerCase();
  if (haystack.includes("/series/") || haystack.includes("series") || haystack.includes("temporada")) return "series";
  if (haystack.includes("/movie/") || haystack.includes("filme") || haystack.includes("vod")) return "movie";
  if (haystack.includes("/live/") || haystack.includes("ao vivo") || haystack.includes("canal") || haystack.includes("live")) return "live";
  return "unknown";
}

function parseRequestedType(value: unknown): RequestedType {
  const candidate = String(value || "all");
  if (candidate === "all" || candidate === "live" || candidate === "movie" || candidate === "series") return candidate;
  return "all";
}

function filterByRequestedType(items: NormalizedChannel[], requestedType: RequestedType): NormalizedChannel[] {
  if (requestedType === "all") return items;
  return items.filter((item) => item.kind === requestedType);
}

function getPlaylistSourceUrl(): string {
  return sanitizeUrl(PLAYLIST_SOURCE_URL);
}

function ensureValidPlaylistBody(body: string, preview: string): void {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new ChannelLoadError({
      code: "empty_response",
      reason: "upstream retornou body vazio",
      message: "Resposta da origem vazia",
      httpStatus: 502,
      preview,
    });
  }

  const normalizedBody = normalize(trimmed);
  if (normalizedBody.startsWith("<html") || normalizedBody.startsWith("<!doctype html") || normalizedBody.includes("<body")) {
    throw new ChannelLoadError({
      code: "html_instead_of_playlist",
      reason: "origem retornou HTML ao invés de playlist",
      message: "Origem respondeu HTML em vez de M3U",
      httpStatus: 502,
      preview,
    });
  }

  if (/(invalid|username|password|auth|authentication|credentials)/i.test(trimmed)) {
    throw new ChannelLoadError({
      code: "invalid_credentials",
      reason: "origem retornou texto indicando credenciais inválidas",
      message: "Credenciais inválidas na origem",
      httpStatus: 401,
      preview,
    });
  }

  const hasExtM3u = /#EXTM3U/i.test(trimmed);
  const hasExtInf = /#EXTINF:/i.test(trimmed);
  if (!hasExtM3u && !hasExtInf) {
    throw new ChannelLoadError({
      code: "unsupported_format",
      reason: "resposta sem #EXTM3U e sem #EXTINF",
      message: "Formato de resposta não suportado",
      httpStatus: 502,
      preview,
    });
  }
}

function pickMainHeaders(response: Response): Record<string, string> {
  const main = ["content-type", "content-length", "server", "date", "cache-control", "cf-ray", "via"];
  const result: Record<string, string> = {};
  for (const key of main) {
    const value = response.headers.get(key);
    if (value) result[key] = value;
  }
  return result;
}

async function fetchWithDiagnostics(url: string, timeoutMs: number) {
  const log = buildLogger("m3u-fetch");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const startedAt = Date.now();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Cache-Control": "no-cache",
      },
    });

    const body = await response.text();
    const responseTimeMs = Date.now() - startedAt;
    const contentType = response.headers.get("content-type") || "";
    const contentLength = response.headers.get("content-length") || String(Buffer.byteLength(body, "utf8"));
    const responseSizeBytes = Buffer.byteLength(body, "utf8");
    const preview = safePreview(body, PREVIEW_LIMIT);
    const headers = pickMainHeaders(response);

    log({
      url,
      status: response.status,
      statusText: response.statusText,
      contentType,
      contentLength,
      responseSizeBytes,
      headers,
      responseTimeMs,
      preview,
    });

    return { response, body, preview, responseTimeMs, contentType, contentLength, responseSizeBytes, headers };
  } catch (error: any) {
    const reason = error?.message || String(error);
    log({ url, failed: true, reason });

    if (error?.name === "AbortError") {
      throw new ChannelLoadError({
        code: "timeout",
        reason: `timeout após ${timeoutMs}ms`,
        message: "Timeout ao buscar a lista",
        httpStatus: 504,
      });
    }

    throw new ChannelLoadError({
      code: "server_unavailable",
      reason,
      message: "Servidor da lista indisponível",
      httpStatus: 503,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseM3UTolerant(content: string): { items: NormalizedChannel[]; diagnostics: ParseDiagnostics } {
  const lines = content.split(/\r?\n/);

  const diagnostics: ParseDiagnostics = {
    totalLines: lines.length,
    extinfLines: 0,
    urlLines: 0,
    foundItems: 0,
    discardedItems: 0,
    discardReasons: {},
  };

  const incDiscard = (reason: string) => {
    diagnostics.discardedItems += 1;
    diagnostics.discardReasons[reason] = (diagnostics.discardReasons[reason] || 0) + 1;
  };

  const items: NormalizedChannel[] = [];

  let pendingName = "";
  let pendingGroup = "";
  let pendingLineNumber = -1;

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] || "";
    const line = raw.trim();

    if (!line) continue;

    if (/^#EXTINF:/i.test(line)) {
      diagnostics.extinfLines += 1;

      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const tvgNameMatch = line.match(/tvg-name="([^"]+)"/i);
      const commaNameMatch = line.match(/,(.*)$/);

      pendingGroup = groupMatch?.[1]?.trim() || "Sem categoria";
      pendingName = commaNameMatch?.[1]?.trim() || tvgNameMatch?.[1]?.trim() || "Item sem nome";
      pendingLineNumber = index + 1;
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    if (ABSOLUTE_URL_REGEX.test(line)) {
      diagnostics.urlLines += 1;

      const name = pendingName || `Item ${items.length + 1}`;
      const group = pendingGroup || "Sem categoria";
      const url = line;

      if (!url) {
        incDiscard("url_vazia");
        pendingName = "";
        pendingGroup = "";
        pendingLineNumber = -1;
        continue;
      }

      const kind = detectKind(name, group, url);
      const id = `${items.length + 1}-${Buffer.from(`${name}-${url}`).toString("base64").slice(0, 12)}`;

      items.push({ id, name, group, url, kind });
      diagnostics.foundItems += 1;

      pendingName = "";
      pendingGroup = "";
      pendingLineNumber = -1;
      continue;
    }

    if (pendingLineNumber > 0) {
      incDiscard("extinf_sem_url_na_linha_seguinte");
      pendingName = "";
      pendingGroup = "";
      pendingLineNumber = -1;
    } else {
      incDiscard("linha_nao_suportada");
    }
  }

  if (pendingLineNumber > 0) {
    incDiscard("extinf_sem_url_final_arquivo");
  }

  console.log(
    JSON.stringify({
      scope: "m3u-parse",
      totalLines: diagnostics.totalLines,
      extinfLines: diagnostics.extinfLines,
      urlLines: diagnostics.urlLines,
      foundItems: diagnostics.foundItems,
      discardedItems: diagnostics.discardedItems,
      discardReasons: diagnostics.discardReasons,
    }),
  );

  return { items, diagnostics };
}

function mapError(error: unknown): ChannelLoadError {
  if (error instanceof ChannelLoadError) return error;
  const message = String((error as any)?.message || "Erro desconhecido");
  return new ChannelLoadError({
    code: "unknown_error",
    reason: message,
    message: "Erro ao carregar lista",
    httpStatus: 500,
  });
}

async function resolveChannelsFromSource(sourceUrl: string, requestedType: RequestedType): Promise<NormalizedChannel[]> {
  console.log(
    JSON.stringify({
      scope: "playlist-source",
      message: "Usando origem única de playlist",
      sourceUrl,
    }),
  );

  const { response, body, preview, responseTimeMs, contentType, contentLength, responseSizeBytes, headers } = await fetchWithDiagnostics(sourceUrl, M3U_TIMEOUT_MS);

  if (response.status === 401) {
    throw new ChannelLoadError({
      code: "invalid_credentials",
      reason: `upstream respondeu ${response.status} ${response.statusText || ""}`.trim(),
      message: "Credenciais rejeitadas pela origem",
      httpStatus: 401,
      upstreamStatus: response.status,
      upstreamStatusText: response.statusText,
      upstreamHeaders: headers,
      responseTimeMs,
      responseSizeBytes,
      contentType,
      contentLength,
      preview,
    });
  }

  if (response.status === 403) {
    throw new ChannelLoadError({
      code: "forbidden",
      reason: `upstream respondeu ${response.status} ${response.statusText || ""}`.trim(),
      message: "Acesso proibido/bloqueado pela origem",
      httpStatus: 403,
      upstreamStatus: response.status,
      upstreamStatusText: response.statusText,
      upstreamHeaders: headers,
      responseTimeMs,
      responseSizeBytes,
      contentType,
      contentLength,
      preview,
    });
  }

  if (response.status === 404) {
    throw new ChannelLoadError({
      code: "endpoint_not_found",
      reason: `upstream respondeu ${response.status} ${response.statusText || ""}`.trim(),
      message: "Endpoint da playlist não encontrado",
      httpStatus: 404,
      upstreamStatus: response.status,
      upstreamStatusText: response.statusText,
      upstreamHeaders: headers,
      responseTimeMs,
      responseSizeBytes,
      contentType,
      contentLength,
      preview,
    });
  }

  if (response.status >= 500 && response.status <= 599) {
    throw new ChannelLoadError({
      code: "server_error",
      reason: `upstream respondeu ${response.status} ${response.statusText || ""}`.trim(),
      message: "Servidor da origem com erro interno",
      httpStatus: 502,
      upstreamStatus: response.status,
      upstreamStatusText: response.statusText,
      upstreamHeaders: headers,
      responseTimeMs,
      responseSizeBytes,
      contentType,
      contentLength,
      preview,
    });
  }

  if (!response.ok) {
    throw new ChannelLoadError({
      code: "upstream_http_error",
      reason: `upstream respondeu ${response.status} ${response.statusText || ""}`.trim(),
      message: `Servidor da lista retornou ${response.status}`,
      httpStatus: 502,
      upstreamStatus: response.status,
      upstreamStatusText: response.statusText,
      upstreamHeaders: headers,
      responseTimeMs,
      responseSizeBytes,
      contentType,
      contentLength,
      preview,
    });
  }

  ensureValidPlaylistBody(body, preview);

  const { items, diagnostics } = parseM3UTolerant(body);
  const filtered = filterByRequestedType(items, requestedType);

  if (filtered.length === 0) {
    throw new ChannelLoadError({
      code: "parse_error",
      reason: "resposta recebida, mas nenhum item válido foi gerado",
      message: "Sem itens válidos após parse e normalização",
      httpStatus: 422,
      preview,
      diagnostics,
    });
  }

  return filtered;
}

function toApiError(error: ChannelLoadError): ApiErrorPayload {
  return {
    ok: false,
    error: error.code,
    status: error.upstreamStatus ?? error.httpStatus,
    statusText: error.upstreamStatusText,
    message: error.message,
    diagnostics: {
      responseTime: error.responseTimeMs,
      contentType: error.contentType,
      contentLength: error.contentLength,
      responseSize: error.responseSizeBytes,
      headers: error.upstreamHeaders,
      preview: error.preview?.slice(0, 300),
    },
    reason: error.reason,
    parseDiagnostics: error.diagnostics,
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
    res.status(405).json({ ok: false, error: "unknown_error", reason: "method_not_allowed", message: "Method Not Allowed", status: 405 });
    return;
  }

  const requestedType = parseRequestedType(req.query?.type);
  const sourceUrl = getPlaylistSourceUrl();

  try {
    const items = await resolveChannelsFromSource(sourceUrl, requestedType);
    const payload: ApiSuccessPayload = {
      ok: true,
      items,
      meta: {
        requestedType,
        total: items.length,
        generatedAt: new Date().toISOString(),
      },
    };
    res.status(200).json(payload);
    return;
  } catch (error) {
    const mapped = mapError(error);
    res.status(mapped.httpStatus).json(toApiError(mapped));
    return;
  }
}
