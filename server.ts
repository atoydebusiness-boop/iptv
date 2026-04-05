import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createClientSession, touchStreamForSession, validateClientSession } from "./lib/sessionStore";

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
  type SeriesInfo = {
    episodes?: Record<string, Array<{ id?: string | number; title?: string; container_extension?: string }>>;
    info?: { name?: string; category_name?: string };
  };

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
    const candidateSeries = seriesItems.value.slice(0, 250);
    const infos = await Promise.allSettled(
      candidateSeries.map((item) =>
        fetchXtreamJson<SeriesInfo>(
          `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_info&series_id=${encodeURIComponent(String(item.series_id || ''))}`,
        ),
      ),
    );

    infos.forEach((result, index) => {
      const baseSeries = candidateSeries[index];
      if (result.status !== 'fulfilled') return;
      const payload = result.value;
      const seasons = Object.values(payload.episodes || {});
      const firstEpisode = seasons.flat().find((episode) => episode?.id);
      if (!firstEpisode?.id) return;
      const ext = (firstEpisode.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
      channels.push({
        name: `${payload.info?.name?.trim() || baseSeries?.name?.trim() || `Série ${baseSeries?.series_id}`} • ${firstEpisode.title?.trim() || 'Episódio 1'}`,
        group: payload.info?.category_name?.trim() || baseSeries?.category_name?.trim() || 'Séries',
        type: 'series',
        url: `${baseUrl}/series/${username}/${password}/${firstEpisode.id}.${ext}`,
      });
    });
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
    "http://dnsnexplay.shop/get.php?username=66645868&password=56348969&type=m3u_plus&output=hls";

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

  const isLikelyNotFoundPage = (content: string) => {
    const normalized = content.toLowerCase();
    return normalized.includes("not_found") || normalized.includes("the page could not be found") || normalized.includes("gru1::");
  };

  const isAbsoluteHttp = (value: string) => /^https?:\/\//i.test(value);
  const proxify = (url: string, auth: { token: string; clientId: string; sid: string }) =>
    `/api/stream?url=${encodeURIComponent(url)}&token=${encodeURIComponent(auth.token)}&clientId=${encodeURIComponent(auth.clientId)}&sid=${encodeURIComponent(auth.sid)}`;
  const buildProxyHeaders = (sourceUrl: string, rangeHeader: string) => {
    const parsed = new URL(sourceUrl);
    const origin = `${parsed.protocol}//${parsed.host}`;

    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: '*/*',
      Range: rangeHeader,
      Referer: `${origin}/`,
      Origin: origin,
    };
  };
  const rewriteM3U8 = (content: string, sourceUrl: string, auth: { token: string; clientId: string; sid: string }) =>
    content
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        try {
          const absolute = new URL(trimmed, sourceUrl).toString();
          if (!isAbsoluteHttp(absolute)) return line;
          return proxify(absolute, auth);
        } catch {
          return line;
        }
      })
      .join('\n');

  app.get('/api/session', (req, res) => {
    try {
      const clientId = String(req.query?.clientId || '').trim();
      const plan = String(req.query?.plan || 'teste');
      const trialMinutes = Number(req.query?.trialMinutes || 10);
      const session = createClientSession({ clientId, plan, trialMinutes });
      res.status(200).json(session);
    } catch (error: any) {
      res.status(400).json({ error: 'Falha ao criar sessão', details: error?.message || 'Parâmetros inválidos.' });
    }
  });

  app.get('/api/stream', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const sourceUrl = decodeURIComponent(rawUrl || '').trim();
    const token = String(req.query?.token || '').trim();
    const clientId = String(req.query?.clientId || '').trim();
    const sid = String(req.query?.sid || '').trim();

    if (!isAbsoluteHttp(sourceUrl)) {
      res.status(400).json({ error: 'Invalid stream URL' });
      return;
    }
    const validation = validateClientSession({ token, clientId });
    if (!validation.ok) {
      res.status(401).json({ error: 'Sessão inválida', details: validation.reason });
      return;
    }
    if (!sid) {
      res.status(400).json({ error: 'streamId ausente', details: 'Envie sid no /api/stream.' });
      return;
    }
    const streamAccess = touchStreamForSession({ token, streamId: sid });
    if (!streamAccess.ok) {
      res.status(429).json({
        error: 'Limite de sessões excedido',
        details: streamAccess.reason,
        activeStreams: streamAccess.activeStreams,
        limit: streamAccess.limit,
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const upstream = await fetch(sourceUrl, {
        signal: controller.signal,
        headers: buildProxyHeaders(
          sourceUrl,
          typeof req.headers.range === 'string' ? req.headers.range : '',
        ),
      });

      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('mpegurl') || sourceUrl.toLowerCase().includes('.m3u8')) {
        const m3u = await upstream.text();
        const rewritten = rewriteM3U8(m3u, sourceUrl, { token, clientId, sid });
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
    } finally {
      clearTimeout(timeout);
    }
  });

  // API route to proxy and parse M3U
  app.get("/api/channels", async (req, res) => {
    try {
      console.log("Fetching M3U from IPTV server...");
      const requestedType = (["all", "live", "movie", "series"].includes(String(req.query?.type || "all"))
        ? String(req.query?.type || "all")
        : "all") as RequestedType;
      const candidateUrls = buildCandidateUrls();
      let lastError = "Falha ao buscar a lista M3U.";
      let lastTriedUrl = "";
      let content = "";

      for (const url of candidateUrls) {
        lastTriedUrl = url;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000); // 15s timeout

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
              Accept: "*/*",
            },
          });
          clearTimeout(timeout);

          const responseText = await response.text();
          if (!response.ok) {
            lastError = `IPTV Server returned ${response.status} para ${url}`;
            continue;
          }
          if (isLikelyNotFoundPage(responseText)) {
            lastError = `Servidor respondeu NOT_FOUND para ${url}.`;
            continue;
          }
          if (!responseText.includes("#EXTM3U")) {
            lastError = `Resposta inválida do provedor em ${url} (não retornou M3U).`;
            continue;
          }

          content = responseText;
          console.log(`M3U fetched successfully from ${url} (${content.length} bytes)`);
          break;
        } catch (fetchError: any) {
          clearTimeout(timeout);
          lastError = fetchError?.message || `Erro de rede ao buscar M3U em ${url}.`;
        }
      }
      if (content) {
        const channels = filterByRequestedType(parseM3U(content), requestedType);
        if (channels.length > 0) {
          console.log(`Parsed ${channels.length} channels`);
          res.json(channels);
          return;
        }
      }

      const fallbackUrl = process.env.IPTV_M3U_URL || DEFAULT_IPTV_URL;
      const m3uFailureContext = `${lastError}${lastTriedUrl ? ` Última tentativa: ${lastTriedUrl}` : ""}`;
      console.warn(`M3U fetch falhou (${m3uFailureContext}). Tentando fallback Xtream API: ${fallbackUrl}`);
      const fallbackChannels = await buildChannelsFromXtream(sanitizeUrl(fallbackUrl), requestedType);
      console.log(`Fallback Xtream retornou ${fallbackChannels.length} itens`);
      res.json(fallbackChannels);
    } catch (error: any) {
      console.error("Error proxying M3U:", error.message);
      res.status(500).json({ error: "Failed to fetch channels", details: error.message });
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
