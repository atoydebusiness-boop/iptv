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

  const buildCandidateUrls = () => {
    const customUrl = process.env.IPTV_M3U_URL?.trim();
    if (customUrl) return [customUrl];

    const base = "dnsnexplay.shop/get.php?username=98765683&password=49673688&type=m3u_plus";
    return [
      `https://${base}&output=m3u8`,
      `https://${base}&output=ts`,
      `http://${base}&output=m3u8`,
      `http://${base}&output=ts`,
    ];
  };

  const isLikelyNotFoundPage = (content: string) => {
    const normalized = content.toLowerCase();
    return normalized.includes("not_found") || normalized.includes("the page could not be found");
  };

  // API route to proxy and parse M3U
  app.get("/api/channels", async (req, res) => {
    try {
      console.log("Fetching M3U from IPTV server...");
      const candidateUrls = buildCandidateUrls();
      let lastError = "Falha ao buscar a lista M3U.";
      let content = "";

      for (const url of candidateUrls) {
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
            lastError = `IPTV Server returned ${response.status}`;
            continue;
          }
          if (isLikelyNotFoundPage(responseText)) {
            lastError = "Servidor respondeu página NOT_FOUND para a URL da lista.";
            continue;
          }
          if (!responseText.includes("#EXTM3U")) {
            lastError = "Resposta inválida do provedor (não retornou M3U).";
            continue;
          }

          content = responseText;
          console.log(`M3U fetched successfully from ${url} (${content.length} bytes)`);
          break;
        } catch (fetchError: any) {
          clearTimeout(timeout);
          lastError = fetchError?.message || "Erro de rede ao buscar M3U.";
        }
      }
      if (!content) throw new Error(lastError);

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
