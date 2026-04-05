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

const DEFAULT_IPTV_URL =
  "http://dnsnexplay.shop/get.php?username=66645868&password=56348969&type=m3u_plus&output=mpegts";

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

function buildCandidateUrls(rawUrl: string): string[] {
  const cleaned = sanitizeUrl(rawUrl);
  if (!cleaned) return [];

  const candidates = new Set<string>();
  try {
    const parsed = new URL(cleaned.startsWith("http") ? cleaned : `http://${cleaned}`);
    const output = (parsed.searchParams.get("output") || "").toLowerCase();
    const outputs = output ? [output, "mpegts", "ts", "m3u8"] : ["mpegts", "ts", "m3u8"];

    for (const protocol of ["http:", "https:"]) {
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

async function fetchXtreamJson<T>(url: string, timeoutMs = 15000): Promise<T> {
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

async function buildChannelsFromXtream(rawUrl: string): Promise<Channel[]> {
  const creds = extractXtreamCredentials(rawUrl);
  if (!creds) throw new Error("URL não contém credenciais Xtream válidas.");

  const { baseUrl, username, password } = creds;
  const liveUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
  const vodUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_vod_streams`;
  const seriesUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series`;

  type LiveItem = { name?: string; stream_id?: string | number; category_name?: string };
  type VodItem = { name?: string; stream_id?: string | number; category_name?: string; container_extension?: string };
  type SeriesItem = { name?: string; series_id?: string | number; category_name?: string };

  const [liveItems, vodItems, seriesItems] = await Promise.allSettled([
    fetchXtreamJson<LiveItem[]>(liveUrl),
    fetchXtreamJson<VodItem[]>(vodUrl),
    fetchXtreamJson<SeriesItem[]>(seriesUrl),
  ]);

  const channels: Channel[] = [];

  if (liveItems.status === "fulfilled" && Array.isArray(liveItems.value)) {
    for (const item of liveItems.value) {
      if (!item.stream_id) continue;
      channels.push({
        name: item.name?.trim() || `Live ${item.stream_id}`,
        group: item.category_name?.trim() || "Ao vivo",
        type: "live",
        url: `${baseUrl}/live/${username}/${password}/${item.stream_id}.ts`,
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
        url: `${baseUrl}/series/${username}/${password}/${item.series_id}.mp4`,
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

async function resolveChannels(sourceUrl: string): Promise<Channel[]> {
  const candidateUrls = buildCandidateUrls(sourceUrl);
  let lastError = "Falha ao buscar a lista M3U.";
  let lastTriedUrl = "";

  for (const url of candidateUrls) {
    lastTriedUrl = url;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

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

      const channels = parseM3U(responseText);
      if (channels.length > 0) return channels;
      lastError = `M3U sem itens reproduzíveis em ${url}.`;
    } catch (err: any) {
      lastError = err?.message || `Erro de rede ao buscar ${url}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  const failureContext = `${lastError}${lastTriedUrl ? ` | Última tentativa: ${lastTriedUrl}` : ""}`;
  console.warn(`M3U falhou: ${failureContext}. Tentando Xtream API...`);

  return buildChannelsFromXtream(sourceUrl);
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
    const sourceUrl = sanitizeUrl(process.env.IPTV_M3U_URL || DEFAULT_IPTV_URL);
    const channels = await resolveChannels(sourceUrl);
    res.status(200).json(channels);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to fetch channels",
      details: error?.message || "Erro desconhecido",
    });
  }
}
