import React, { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, List, Search, AlertCircle, Zap } from 'lucide-react';

interface Channel {
  name: string;
  url: string;
  group?: string;
  type?: 'live' | 'movie' | 'series' | 'unknown';
}

interface SeriesEpisode {
  id: string;
  episode_num?: number;
  title: string;
  container_extension: string;
  url: string;
}

interface SeriesDetails {
  seriesId: string;
  seasons: string[];
  episodesBySeason: Record<string, SeriesEpisode[]>;
}

type ContentTab = 'all' | 'live' | 'movie' | 'series';

const CHANNEL_CACHE_KEY = 'iptv_channels_cache_v2';
const VISIBLE_PAGE_SIZE = 300;
const VOD_BROWSER_EXTENSIONS = new Set(['mp4', 'webm', 'ogg', 'm4v', 'mov']);

const normalize = (text?: string) => (text || '').toLowerCase();

const inferTypeFromText = (channel: Channel): Channel['type'] => {
  if (channel.type && channel.type !== 'unknown') return channel.type;

  const haystack = `${normalize(channel.name)} ${normalize(channel.group)} ${normalize(channel.url)}`;

  if (haystack.includes('/series/') || haystack.includes('série') || haystack.includes('series') || haystack.includes('temporada') || haystack.includes('season') || haystack.includes('tv shows')) {
    return 'series';
  }
  if (haystack.includes('/movie/') || haystack.includes('filme') || haystack.includes('movie') || haystack.includes('vod')) {
    return 'movie';
  }
  if (haystack.includes('/live/') || haystack.includes('tv') || haystack.includes('canal') || haystack.includes('ao vivo') || haystack.includes('live')) {
    return 'live';
  }

  return 'unknown';
};

const normalizeChannels = (items: Channel[]): Channel[] =>
  items.map((item) => ({ ...item, type: inferTypeFromText(item) }));

const toProxyUrl = (url: string) => {
  if (url.startsWith('/api/stream?url=')) return url;
  return `/api/stream?url=${encodeURIComponent(url)}`;
};

const extractExtension = (url: string) => {
  const withoutQuery = url.split('?')[0];
  const match = withoutQuery.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() || 'sem_extensao';
};

const canPlayHlsNatively = () => {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('video');
  return probe.canPlayType('application/vnd.apple.mpegurl') !== '';
};

const isBrowserCompatibleVodUrl = (url: string) => {
  const ext = extractExtension(url);
  if (VOD_BROWSER_EXTENSIONS.has(ext)) return true;
  if (ext === 'm3u8') return canPlayHlsNatively();
  return false;
};

const extractSeriesId = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('series_id')?.trim() || '';
  } catch {
    return '';
  }
};

const buildPlayableCandidates = (url: string) => {
  const candidates = new Set<string>();
  const normalized = normalize(url);

  const addWithProtocolVariants = (input: string) => {
    candidates.add(input);
    if (input.startsWith('http://')) {
      candidates.add(input.replace('http://', 'https://'));
    }
  };

  addWithProtocolVariants(url);

  if (normalized.includes('.ts')) {
    addWithProtocolVariants(url.replace(/\.ts(\?.*)?$/i, '.m3u8$1'));
  }

  if (normalized.includes('.m3u8')) {
    addWithProtocolVariants(url.replace(/\.m3u8(\?.*)?$/i, '.ts$1'));
  }

  if (normalized.includes('/live/')) {
    addWithProtocolVariants(url.replace(/\.ts(\?.*)?$/i, '.m3u8$1'));
  }

  if (normalized.includes('/movie/') || normalized.includes('/series/')) {
    const withExt = (ext: string) => {
      if (/\.[a-z0-9]+(\?.*)?$/i.test(url)) {
        addWithProtocolVariants(url.replace(/\.[a-z0-9]+(\?.*)?$/i, `.${ext}$1`));
      } else {
        addWithProtocolVariants(`${url}.${ext}`);
      }
    };

    withExt('m3u8');
    withExt('mp4');
    withExt('ts');
  }

  return [...candidates];
};

export default function Player() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<ContentTab>('all');
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const [playbackCandidateIndex, setPlaybackCandidateIndex] = useState(0);
  const [loadedTypes, setLoadedTypes] = useState<Set<ContentTab>>(new Set(['all']));
  const [vodPlaybackFailed, setVodPlaybackFailed] = useState(false);
  const [vodFailureReason, setVodFailureReason] = useState('');
  const [seriesCache, setSeriesCache] = useState<Record<string, SeriesDetails>>({});
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState('');
  const [listNotice, setListNotice] = useState('');
  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedEpisodeId, setSelectedEpisodeId] = useState('');
  const lastValidChannelsRef = useRef<Channel[]>([]);

  const apiUrl = '/api/channels';
  const seriesApiUrl = '/api/series';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const loadSeriesDetails = async (seriesChannel: Channel) => {
    const seriesId = extractSeriesId(seriesChannel.url);
    console.info('[DIAG] Série selecionada', { seriesId, url: seriesChannel.url });
    if (!seriesId) {
      setSeriesError('Não foi possível identificar series_id desta série.');
      return;
    }

    if (seriesCache[seriesChannel.url]) {
      const cached = seriesCache[seriesChannel.url];
      const firstSeason = cached.seasons[0] || '';
      setSelectedSeason(firstSeason);
      setSelectedEpisodeId(cached.episodesBySeason[firstSeason]?.[0]?.id || '');
      setSeriesError('');
      return;
    }

    setSeriesLoading(true);
    setSeriesError('');
    try {
      const response = await fetch(`${seriesApiUrl}?url=${encodeURIComponent(seriesChannel.url)}`, { cache: 'no-store' });
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(raw || 'Falha ao carregar episódios da série.');
      }
      const details = (await response.json()) as SeriesDetails;
      setSeriesCache((prev) => ({ ...prev, [seriesChannel.url]: details }));
      const firstSeason = details.seasons[0] || '';
      setSelectedSeason(firstSeason);
      setSelectedEpisodeId(details.episodesBySeason[firstSeason]?.[0]?.id || '');
    } catch (err: any) {
      setSeriesError(err?.message || 'Erro ao carregar série.');
    } finally {
      setSeriesLoading(false);
    }
  };

  const setInitialChannel = (list: Channel[]) => {
    const preferredGloboChannel = list.find((channel) => normalize(channel.name).includes('globo'));
    setCurrentChannel((prev) => (prev && list.some((c) => c.url === prev.url) ? prev : (preferredGloboChannel || list[0] || null)));
  };

  useEffect(() => {
    try {
      const cached = localStorage.getItem(CHANNEL_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Channel[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalizedCache = normalizeChannels(parsed);
          setChannels(normalizedCache);
          setInitialChannel(normalizedCache);
          lastValidChannelsRef.current = normalizedCache;
        }
      }
    } catch (err) {
      console.warn('Não foi possível ler cache da lista.', err);
    }

    loadChannels();
  }, []);

  const loadChannels = async (requestedType: ContentTab = "all") => {
    const MAX_ATTEMPTS = 2;
    const REQUEST_TIMEOUT_MS = 12000;
    const RETRY_DELAY_MS = 700;

    setLoading(true);
    setError('');
    setListNotice('');
    try {
      const targetUrl = `${apiUrl}?type=${requestedType}`;
      let response: Response | null = null;
      let lastFetchError: any = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          response = await fetch(targetUrl, { cache: 'no-store', signal: controller.signal });
          if (response.ok) break;
          lastFetchError = new Error(`HTTP ${response.status}`);
        } catch (fetchErr: any) {
          lastFetchError = fetchErr;
        } finally {
          clearTimeout(timeout);
        }

        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }

      if (!response) {
        throw lastFetchError || new Error('Falha ao carregar lista do servidor.');
      }

      if (!response.ok) {
        const errorRaw = await response.text();
        let errorMessage = 'Falha ao carregar lista do servidor.';
        try {
          const parsedError = JSON.parse(errorRaw);
          errorMessage = parsedError.details || parsedError.error || errorMessage;
        } catch {
          errorMessage = (errorRaw || errorMessage).replace(/\s+/g, ' ').slice(0, 220);
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Nenhum item disponível no momento.');
      }

      const normalizedData = normalizeChannels(data);
      setChannels((prev) => {
        const merged = requestedType === 'all' ? normalizedData : [...prev, ...normalizedData];
        const deduped = Array.from(new Map(merged.map((item) => [item.url, item])).values());
        setInitialChannel(deduped);
        lastValidChannelsRef.current = deduped;
        localStorage.setItem(CHANNEL_CACHE_KEY, JSON.stringify(deduped.slice(0, 5000)));
        return deduped;
      });
      setLoadedTypes((prev) => new Set(prev).add(requestedType));
    } catch (err: any) {
      const message = err?.name === 'AbortError' ? 'Timeout ao carregar lista do servidor.' : err.message;
      const cachedList = lastValidChannelsRef.current;
      if (cachedList.length > 0) {
        setChannels((prev) => (prev.length > 0 ? prev : cachedList));
        setInitialChannel(cachedList);
        setListNotice('A lista demorou para responder. Exibindo dados anteriores.');
        setError('');
      } else {
        setError(`Erro: ${message}. Verifique se sua lista está ativa ou tente novamente.`);
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const searchNormalized = normalize(searchTerm.trim());

  useEffect(() => {
    if (activeTab !== 'all' && !loadedTypes.has(activeTab)) {
      loadChannels(activeTab);
    }
  }, [activeTab]);

  const filteredChannels = useMemo(() => {
    return channels.filter((channel) => {
      const matchesSearch =
        !searchNormalized ||
        normalize(channel.name).includes(searchNormalized) ||
        normalize(channel.group).includes(searchNormalized);
      const matchesTab = activeTab === 'all' ? true : channel.type === activeTab;
      return matchesSearch && matchesTab;
    });
  }, [channels, searchNormalized, activeTab]);

  useEffect(() => {
    setVisibleCount(VISIBLE_PAGE_SIZE);
  }, [searchNormalized, activeTab]);

  const visibleChannels = useMemo(
    () => filteredChannels.slice(0, visibleCount),
    [filteredChannels, visibleCount],
  );

  useEffect(() => {
    setPlaybackCandidateIndex(0);
    setVodPlaybackFailed(false);
    setVodFailureReason('');
    if (currentChannel?.type === 'series') {
      loadSeriesDetails(currentChannel);
    } else {
      setSeriesError('');
      setSelectedSeason('');
      setSelectedEpisodeId('');
    }
  }, [currentChannel?.url]);

  const selectedSeriesDetails = currentChannel?.type === 'series' ? seriesCache[currentChannel.url] : undefined;
  const selectedSeasonEpisodes =
    selectedSeriesDetails && selectedSeason ? selectedSeriesDetails.episodesBySeason[selectedSeason] || [] : [];
  const selectedEpisode =
    selectedSeasonEpisodes.find((episode) => episode.id === selectedEpisodeId) || selectedSeasonEpisodes[0];

  const currentPlaybackCandidates = useMemo(() => {
    if (!currentChannel) return [];
    if (currentChannel.type === 'live') return buildPlayableCandidates(currentChannel.url);
    if (currentChannel.type === 'series') return selectedEpisode ? [selectedEpisode.url] : [];
    return [currentChannel.url];
  }, [currentChannel, selectedEpisode]);

  const directPlaybackUrl = currentPlaybackCandidates[playbackCandidateIndex] || currentChannel?.url || '';
  const playbackUrl = directPlaybackUrl ? toProxyUrl(directPlaybackUrl) : '';
  const currentExtension = extractExtension(directPlaybackUrl || currentChannel?.url || '');
  const canTryInternalVod =
    !!currentChannel &&
    currentChannel.type !== 'live' &&
    !!directPlaybackUrl &&
    isBrowserCompatibleVodUrl(directPlaybackUrl) &&
    !vodPlaybackFailed;

  useEffect(() => {
    if (channels.length === 0) return;
    const typeCounts = channels.reduce(
      (acc, item) => {
        const type = item.type || 'unknown';
        if (type === 'live') acc.live += 1;
        else if (type === 'movie') acc.movie += 1;
        else if (type === 'series') acc.series += 1;
        return acc;
      },
      { live: 0, movie: 0, series: 0 },
    );

    const groups = Array.from(
      new Set(
        channels
          .map((item) => item.group?.trim())
          .filter((group): group is string => Boolean(group)),
      ),
    ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    console.info('[DIAG] Totais da lista', {
      total: channels.length,
      byType: typeCounts,
      groupTitles: groups,
    });
  }, [channels]);

  const jumpToNextChannel = () => {
    if (!currentChannel || filteredChannels.length === 0) return;
    const currentIndex = filteredChannels.findIndex((item) => item.url === currentChannel.url);
    const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    if (nextIndex < filteredChannels.length) {
      setCurrentChannel(filteredChannels[nextIndex]);
      setPlaybackCandidateIndex(0);
    }
  };

  const handlePlaybackError = (reason?: string) => {
    const isVodLike = currentChannel?.type === 'movie' || currentChannel?.type === 'series';
    console.warn('[DIAG] Falha de reprodução', {
      channel: currentChannel?.name,
      type: currentChannel?.type || 'unknown',
      reason: reason || 'sem_mensagem',
      candidateIndex: playbackCandidateIndex,
      candidatesTotal: currentPlaybackCandidates.length,
    });

    if (playbackCandidateIndex + 1 < currentPlaybackCandidates.length) {
      setPlaybackCandidateIndex((prev) => prev + 1);
      setError('Tentando formato alternativo do mesmo item...');
      return;
    }

    if (isVodLike) {
      setError(reason || 'Não foi possível reproduzir este item. Tente outro filme/série da lista.');
      return;
    }

    jumpToNextChannel();
    setError(reason || 'Esse item falhou. Trocamos automaticamente para o próximo da lista.');
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackUrl || !directPlaybackUrl || currentChannel?.type !== 'live') return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const normalized = directPlaybackUrl.toLowerCase();
    const isHlsSource = normalized.includes('.m3u8') || normalized.includes('m3u8');
    const strategy = isHlsSource && Hls.isSupported() ? 'hls.js' : 'video-src-direto';

    console.info('[DIAG] Estratégia de player', {
      strategy,
      channel: currentChannel?.name,
      type: currentChannel?.type || 'unknown',
      candidateIndex: playbackCandidateIndex,
      directPlaybackUrl,
      playbackUrl,
    });

    const playVideo = () => {
      video
        .play()
        .catch(() => {
          // autoplay pode falhar dependendo do navegador/política.
        });
    };

    if (isHlsSource && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsRef.current = hls;
      hls.loadSource(playbackUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        playVideo();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          handlePlaybackError('Erro no stream HLS. Tentando próximo item...');
        }
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    video.src = playbackUrl;
    playVideo();

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [playbackUrl, directPlaybackUrl, currentChannel?.type]);

  useEffect(() => {
    if (!currentChannel || currentChannel.type === 'live') return;
    const targetUrl = currentChannel.type === 'series' ? selectedEpisode?.url || '' : currentChannel.url;
    const strategy = targetUrl
      ? (isBrowserCompatibleVodUrl(targetUrl) ? 'vod:video-interno' : 'vod:nova-aba-direta')
      : 'series:aguardando-episodio';
    console.info('[DIAG] Estratégia de player', {
      strategy,
      channel: currentChannel.name,
      type: currentChannel.type,
      url: targetUrl || currentChannel.url,
      extension: extractExtension(targetUrl || currentChannel.url),
    });
    if (strategy === 'vod:nova-aba-direta') {
      setVodFailureReason('Origem/extensão não compatível com reprodução interna no navegador.');
    }
  }, [currentChannel, selectedEpisode?.id]);

  return (
    <section id="player" className="py-20 bg-zinc-950 overflow-x-hidden">
      <div className="max-w-7xl mx-auto px-4 w-full">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Web Player M3U</h2>
          <p className="text-gray-400">A lista já entra carregada, abre tentando formatos alternativos e tem filtros para ao vivo, filmes e séries.</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6 lg:gap-8 items-start">
          <div className="lg:col-span-2 space-y-4 md:space-y-6 min-w-0">
            <div className="bg-black rounded-2xl overflow-hidden aspect-video w-full border border-white/10 shadow-2xl relative group">
              {loading && channels.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-blue-500 bg-zinc-900">
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-400 animate-pulse">Carregando lista M3U...</p>
                </div>
              ) : currentChannel ? (
                currentChannel.type === 'live' ? (
                  <video
                    ref={videoRef}
                    controls
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full bg-black"
                    onLoadedData={() => {
                      setError('');
                    }}
                    onError={() => {
                      console.error('Video Element Error:', directPlaybackUrl);
                      handlePlaybackError();
                    }}
                  />
                ) : canTryInternalVod ? (
                  <video
                    key={directPlaybackUrl}
                    controls
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full bg-black"
                    src={directPlaybackUrl}
                    onLoadedData={() => {
                      setError('');
                      setVodFailureReason('');
                    }}
                    onError={() => {
                      const reason = 'Erro de carregamento no <video> para VOD.';
                      console.warn('[DIAG] Falha de reprodução', {
                        type: currentChannel.type,
                        url: directPlaybackUrl || currentChannel.url,
                        extension: currentExtension,
                        reason,
                      });
                      setVodPlaybackFailed(true);
                      setVodFailureReason(reason);
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900 text-center px-4">
                    <p className="text-sm text-gray-300">
                      {vodFailureReason || 'Esta origem não permite reprodução interna no navegador.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => window.open(directPlaybackUrl || currentChannel.url, '_blank', 'noopener,noreferrer')}
                      className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 transition-colors"
                    >
                      Abrir em nova aba
                    </button>
                  </div>
                )
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-zinc-900">
                  <Play className="w-16 h-16 mb-4 opacity-20" />
                  <p>Selecione um item na lista ao lado</p>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {listNotice && (
              <div className="flex items-center gap-2 p-3 bg-white/5 border border-white/10 text-gray-300 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0 text-yellow-400" />
                <p className="text-xs md:text-sm">{listNotice}</p>
              </div>
            )}

            {currentChannel && currentChannel.type !== 'live' && (vodPlaybackFailed || !isBrowserCompatibleVodUrl(directPlaybackUrl || currentChannel.url)) && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-white/5 border border-white/10 rounded-xl gap-3 min-w-0">
                <p className="text-xs text-gray-400 truncate min-w-0">
                  Fallback ativo para {currentChannel.type === 'series' ? 'série' : 'filme'}.
                </p>
                <button
                  type="button"
                  onClick={() => window.open(directPlaybackUrl || currentChannel.url, '_blank', 'noopener,noreferrer')}
                  className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 transition-colors"
                >
                  Abrir em nova aba
                </button>
              </div>
            )}

            {currentChannel?.type === 'series' && (
              <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-4">
                <h4 className="font-semibold text-sm">Temporadas e episódios</h4>
                {seriesLoading && <p className="text-xs text-gray-400">Carregando temporadas...</p>}
                {seriesError && <p className="text-xs text-red-400">{seriesError}</p>}
                {!seriesLoading && !seriesError && selectedSeriesDetails && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {selectedSeriesDetails.seasons.map((season) => (
                        <button
                          key={season}
                          type="button"
                          onClick={() => {
                            setSelectedSeason(season);
                            const firstEpisode = selectedSeriesDetails.episodesBySeason[season]?.[0];
                            setSelectedEpisodeId(firstEpisode?.id || '');
                          }}
                          className={`text-xs px-3 py-1 rounded ${
                            selectedSeason === season ? 'bg-blue-600 text-white' : 'bg-black text-gray-300 hover:bg-white/10'
                          }`}
                        >
                          Temporada {season}
                        </button>
                      ))}
                    </div>
                    <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                      {(selectedSeriesDetails.episodesBySeason[selectedSeason] || []).map((episode) => (
                        <button
                          key={episode.id}
                          type="button"
                          onClick={() => {
                            setSelectedEpisodeId(episode.id);
                            setVodPlaybackFailed(false);
                            setVodFailureReason('');
                            console.info('[DIAG] Episódio selecionado', {
                              seriesId: selectedSeriesDetails.seriesId,
                              season: selectedSeason,
                              episodeId: episode.id,
                              episodeNum: episode.episode_num,
                              url: episode.url,
                              extension: episode.container_extension,
                            });
                          }}
                          className={`w-full text-left text-xs p-2 rounded border ${
                            selectedEpisodeId === episode.id
                              ? 'border-blue-500 bg-blue-600/20 text-white'
                              : 'border-white/10 bg-black/60 text-gray-300 hover:bg-white/10'
                          }`}
                        >
                          Ep. {episode.episode_num || '-'} — {episode.title}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="p-6 bg-blue-600/10 border border-blue-500/20 rounded-2xl">
              <h4 className="font-bold mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-500" />
                Dica de Performance
              </h4>
              <p className="text-sm text-gray-400 leading-relaxed">
                Para evitar travamentos com listas gigantes, a interface renderiza em blocos e carrega mais itens ao rolar.
              </p>
            </div>
          </div>

          <div className="bg-zinc-900 border border-white/10 rounded-2xl flex flex-col h-[55vh] min-h-[420px] lg:h-[600px] min-w-0 overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center gap-2 mb-4">
                <List className="w-5 h-5 text-blue-500" />
                <h3 className="font-bold">Lista M3U</h3>
                <span className="ml-auto text-xs text-gray-500 bg-white/5 px-2 py-1 rounded">
                  {filteredChannels.length} itens
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {([
                  { id: 'all', label: 'Tudo' },
                  { id: 'live', label: 'Ao vivo' },
                  { id: 'movie', label: 'Filmes' },
                  { id: 'series', label: 'Séries' },
                ] as Array<{ id: ContentTab; label: string }>).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); setError(''); }}
                    className={`text-xs py-2 rounded-lg transition-colors ${
                      activeTab === tab.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-black text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Buscar item..."
                  className="w-full bg-black border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div
              className="flex-1 overflow-y-auto p-2 custom-scrollbar"
              onScroll={(e) => {
                const target = e.currentTarget;
                const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 120;
                if (nearBottom && visibleCount < filteredChannels.length) {
                  setVisibleCount((prev) => Math.min(prev + VISIBLE_PAGE_SIZE, filteredChannels.length));
                }
              }}
            >
              {visibleChannels.length > 0 ? (
                <>
                  {visibleChannels.map((channel, i) => (
                    <button
                      key={`${channel.url}-${i}`}
                      onClick={() => {
                        console.info('[DIAG] Item selecionado', {
                          name: channel.name,
                          type: channel.type || 'unknown',
                          url: channel.url,
                          extension: extractExtension(channel.url),
                        });
                        setCurrentChannel(channel);
                        setPlaybackCandidateIndex(0);
                        setError('');
                      }}
                      className={`w-full text-left p-3 rounded-lg text-sm transition-all mb-1 flex items-center gap-3 ${
                        currentChannel?.url === channel.url
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                          : 'hover:bg-white/5 text-gray-400 hover:text-white'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full ${currentChannel?.url === channel.url ? 'bg-white' : 'bg-green-500'}`} />
                      <div className="min-w-0 flex-1">
                        <span className="truncate block">{channel.name}</span>
                        {channel.group && (
                          <span className="text-[11px] text-gray-500 truncate block">{channel.group}</span>
                        )}
                      </div>
                    </button>
                  ))}

                  {visibleChannels.length < filteredChannels.length && (
                    <div className="text-center text-xs text-gray-500 py-3">
                      Mostrando {visibleChannels.length} de {filteredChannels.length}. Role para carregar mais.
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-600">
                  <p className="text-sm">Nenhum item encontrado para esse filtro</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
