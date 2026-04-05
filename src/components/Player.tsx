import React, { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, List, Search, AlertCircle, Zap } from 'lucide-react';

interface Channel {
  name: string;
  url: string;
  group?: string;
  type?: 'live' | 'movie' | 'series' | 'unknown';
}

type ContentTab = 'all' | 'live' | 'movie' | 'series';

const CHANNEL_CACHE_KEY = 'iptv_channels_cache_v2';
const VISIBLE_PAGE_SIZE = 300;

const normalize = (text?: string) => (text || '').toLowerCase();

const inferTypeFromText = (channel: Channel): Channel['type'] => {
  if (channel.type && channel.type !== 'unknown') return channel.type;

  const haystack = `${normalize(channel.name)} ${normalize(channel.group)} ${normalize(channel.url)}`;

  if (haystack.includes('/series/') || haystack.includes('série') || haystack.includes('series') || haystack.includes('temporada') || haystack.includes('season')) {
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
  const [clientId, setClientId] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number>(0);
  const [showSubscribePopup, setShowSubscribePopup] = useState(false);
  const [timeLeftLabel, setTimeLeftLabel] = useState('');

  const apiUrl = '/api/channels';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const getOrCreateClientId = () => {
    const storageKey = 'iptv_client_id_v1';
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const generated = `client_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    localStorage.setItem(storageKey, generated);
    return generated;
  };

  const createSession = async (resolvedClientId: string) => {
    const plan = 'teste';
    const trialMinutes = 15;
    const url = `/api/session?clientId=${encodeURIComponent(resolvedClientId)}&plan=${plan}&trialMinutes=${trialMinutes}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Não foi possível iniciar sessão de teste.');
    }
    const data = await response.json();
    setSessionToken(String(data?.token || ''));
    setSessionExpiresAt(Number(data?.expiresAt || 0));
  };

  const setInitialChannel = (list: Channel[]) => {
    const preferredGloboChannel = list.find((channel) => normalize(channel.name).includes('globo'));
    setCurrentChannel((prev) => (prev && list.some((c) => c.url === prev.url) ? prev : (preferredGloboChannel || list[0] || null)));
  };

  useEffect(() => {
    const id = getOrCreateClientId();
    setClientId(id);
    createSession(id).catch((err) => {
      setError(err?.message || 'Falha ao iniciar sessão.');
    });

    try {
      const cached = localStorage.getItem(CHANNEL_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Channel[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalizedCache = normalizeChannels(parsed);
          setChannels(normalizedCache);
          setInitialChannel(normalizedCache);
        }
      }
    } catch (err) {
      console.warn('Não foi possível ler cache da lista.', err);
    }

    loadChannels();
  }, []);

  useEffect(() => {
    if (!sessionExpiresAt) return;

    const formatRemaining = (remainingMs: number) => {
      const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };

    const tick = () => {
      const remaining = sessionExpiresAt - Date.now();
      setTimeLeftLabel(formatRemaining(remaining));
      if (remaining <= 0) setShowSubscribePopup(true);
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [sessionExpiresAt]);

  const loadChannels = async (requestedType: ContentTab = "all") => {
    setLoading(true);
    setError('');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const targetUrl = `${apiUrl}?type=${requestedType}`;
      const response = await fetch(targetUrl, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);
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
        localStorage.setItem(CHANNEL_CACHE_KEY, JSON.stringify(deduped.slice(0, 5000)));
        return deduped;
      });
      setLoadedTypes((prev) => new Set(prev).add(requestedType));
    } catch (err: any) {
      const message = err?.name === 'AbortError' ? 'Timeout ao carregar lista do servidor.' : err.message;
      setError(`Erro: ${message}. Verifique se sua lista está ativa ou tente novamente.`);
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
  }, [currentChannel?.url]);

  const currentPlaybackCandidates = useMemo(
    () => (currentChannel ? buildPlayableCandidates(currentChannel.url) : []),
    [currentChannel],
  );

  const directPlaybackUrl = currentPlaybackCandidates[playbackCandidateIndex] || currentChannel?.url || '';
  const streamSessionId = currentChannel ? btoa(currentChannel.url).replace(/=/g, '') : '';
  const playbackUrl =
    directPlaybackUrl && clientId && sessionToken && streamSessionId
      ? `${toProxyUrl(directPlaybackUrl)}&token=${encodeURIComponent(sessionToken)}&clientId=${encodeURIComponent(clientId)}&sid=${encodeURIComponent(streamSessionId)}`
      : '';

  const handlePlaybackError = (reason?: string) => {
    if (playbackCandidateIndex + 1 < currentPlaybackCandidates.length) {
      setPlaybackCandidateIndex((prev) => prev + 1);
      setError('Tentando formato alternativo do mesmo item...');
      return;
    }

    setError(reason || 'Esse item falhou. Selecione outro canal manualmente.');
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackUrl || !directPlaybackUrl || showSubscribePopup) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const normalized = directPlaybackUrl.toLowerCase();
    const isHlsSource = normalized.includes('.m3u8') || normalized.includes('m3u8');

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
          handlePlaybackError('Erro no stream HLS. Tentando outra variação do mesmo item...');
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
  }, [playbackUrl, directPlaybackUrl, showSubscribePopup]);

  return (
    <section id="player" className="py-20 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Web Player M3U</h2>
          <p className="text-gray-400">A lista já entra carregada, abre tentando formatos alternativos e tem filtros para ao vivo, filmes e séries.</p>
          {sessionToken && (
            <p className="text-xs text-blue-400 mt-2">
              Modo teste controlado ativo • tempo restante: {timeLeftLabel || '--:--'}
            </p>
          )}
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-black rounded-2xl overflow-hidden aspect-video border border-white/10 shadow-2xl relative group">
              {loading && channels.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-blue-500 bg-zinc-900">
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-400 animate-pulse">Carregando lista M3U...</p>
                </div>
              ) : currentChannel ? (
                <video
                  ref={videoRef}
                  controls
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full bg-black"
                  onError={() => {
                    console.error('Video Element Error:', directPlaybackUrl);
                    handlePlaybackError();
                  }}
                />
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

          <div className="bg-zinc-900 border border-white/10 rounded-2xl flex flex-col h-[600px]">
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center gap-2 mb-4">
                <List className="w-5 h-5 text-blue-500" />
                <h3 className="font-bold">Lista M3U</h3>
                <span className="ml-auto text-xs text-gray-500 bg-white/5 px-2 py-1 rounded">
                  {filteredChannels.length} itens
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-3">
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
                      onClick={() => { setCurrentChannel(channel); setPlaybackCandidateIndex(0); setError(''); }}
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

      {showSubscribePopup && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl p-6 text-center">
            <h3 className="text-2xl font-bold mb-2">Tempo de teste encerrado</h3>
            <p className="text-gray-300 mb-6">
              Seu acesso de teste terminou. Clique abaixo para assinar e liberar canais, filmes e séries sem bloqueio.
            </p>
            <a
              href="#pricing"
              onClick={() => setShowSubscribePopup(false)}
              className="block w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl"
            >
              Quero Assinar Agora
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
