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

  // API route to proxy and parse M3U
  app.get("/api/channels", async (req, res) => {
    // Changed output to m3u8 for better browser compatibility
    const m3uUrl = 'http://dnsnexplay.shop/get.php?username=98765683&password=49673688&type=m3u_plus&output=m3u8';
    
    try {
      console.log("Fetching M3U from IPTV server...");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const response = await fetch(m3uUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
          'Accept': '*/*'
        }
      });
      
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`IPTV Server returned ${response.status}`);
      
      const content = await response.text();
      console.log(`M3U fetched successfully (${content.length} bytes)`);
      
      if (!content.includes("#EXTM3U")) {
        throw new Error("Resposta inválida do provedor (não retornou M3U).");
      }

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
