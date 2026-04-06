interface RawEpisode {
  id?: string | number;
  episode_num?: number;
  title?: string;
  container_extension?: string;
}

type EpisodesPayload = Record<string, RawEpisode[] | undefined> | RawEpisode[];

const STREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const normalizeEpisodes = (episodes: EpisodesPayload | undefined) => {
  const normalized: Record<string, RawEpisode[]> = {};
  if (!episodes) return normalized;

  if (Array.isArray(episodes)) {
    normalized['1'] = episodes;
    return normalized;
  }

  for (const [season, list] of Object.entries(episodes)) {
    if (!Array.isArray(list)) continue;
    normalized[season] = list;
  }
  return normalized;
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const raw = typeof req.query?.url === 'string' ? req.query.url : '';
  const sourceUrl = decodeURIComponent(raw || '').trim();

  if (!/^https?:\/\//i.test(sourceUrl)) {
    res.status(400).json({ error: 'Invalid series URL' });
    return;
  }

  try {
    const parsed = new URL(sourceUrl);
    const username = parsed.searchParams.get('username') || '';
    const password = parsed.searchParams.get('password') || '';
    const seriesId = parsed.searchParams.get('series_id') || '';

    if (!username || !password || !seriesId) {
      throw new Error('URL de série sem credenciais ou series_id.');
    }

    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': STREAM_UA,
        Accept: 'application/json,text/plain,*/*',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`Series info retornou ${response.status}`);
    }

    const payload = JSON.parse((await response.text()).trim()) as {
      episodes?: EpisodesPayload;
    };

    const episodesBySeasonRaw = normalizeEpisodes(payload.episodes);
    const seasons = Object.keys(episodesBySeasonRaw).sort((a, b) => Number(a) - Number(b));
    const baseUrl = `${parsed.protocol}//${parsed.host}`;

    const episodesBySeason: Record<string, Array<{
      id: string;
      episode_num?: number;
      title: string;
      container_extension: string;
      url: string;
    }>> = {};

    for (const season of seasons) {
      const list = episodesBySeasonRaw[season] || [];
      episodesBySeason[season] = list
        .filter((episode) => episode?.id)
        .map((episode) => {
          const id = String(episode.id);
          const ext = (episode.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
          return {
            id,
            episode_num: episode.episode_num,
            title: episode.title?.trim() || `Episódio ${episode.episode_num || id}`,
            container_extension: ext,
            url: `${baseUrl}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(id)}.${ext}`,
          };
        });
    }

    res.status(200).json({
      seriesId,
      seasons,
      episodesBySeason,
    });
  } catch (error: any) {
    res.status(502).json({
      error: 'Failed to fetch series info',
      details: error?.message || 'Unknown error',
    });
  }
}
