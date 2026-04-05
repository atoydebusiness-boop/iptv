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
    "http://dnsnexplay.shop/get.php?username=66645868&password=56348969&type=m3u_plus&output=mpegts";

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
        const outputs = output
          ? [output, "mpegts", "ts", "m3u8"]
          : ["mpegts", "ts", "m3u8"];

        for (const protocol of ["http:", "https:"]) {
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

  // API route to proxy and parse M3U
  app.get("/api/channels", async (req, res) => {
    try {
      console.log("Fetching M3U from IPTV server...");
      const candidateUrls = buildCandidateUrls();
      let lastError = "Falha ao buscar a lista M3U.";
      let lastTriedUrl = "";
      let content = "";

      for (const url of candidateUrls) {
        lastTriedUrl = url;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

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
      if (!content) throw new Error(`${lastError}${lastTriedUrl ? ` Última tentativa: ${lastTriedUrl}` : ""}`);

      const channels = parseM3U(content);
      if (channels.length === 0) {
        throw new Error("Lista retornada sem itens reproduzíveis.");
      }
      console.log(`Parsed ${channels.length} channels`);
      
      res.json(channels);
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
