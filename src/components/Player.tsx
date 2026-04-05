import React, { useState, useEffect } from 'react';
import ReactPlayer from 'react-player';
import { Play, List, Search, AlertCircle, Zap } from 'lucide-react';

interface Channel {
  name: string;
  url: string;
}

export default function Player() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const apiUrl = '/api/channels';

  useEffect(() => {
    loadChannels();
  }, []);

  const loadChannels = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Falha ao carregar canais do servidor.');
      }
      const data = await response.json();
      if (data.length === 0) throw new Error('Nenhum canal disponível no momento.');
      setChannels(data);
      const preferredGloboChannel = data.find((channel: Channel) =>
        channel.name.toLowerCase().includes('globo')
      );
      setCurrentChannel(preferredGloboChannel || data[0]);
    } catch (err: any) {
      setError(`Erro: ${err.message}. Verifique se sua lista está ativa ou tente novamente.`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredChannels = channels.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const PlayerComponent = ReactPlayer as any;

  return (
    <section id="player" className="py-20 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Canais em Tempo Real</h2>
          <p className="text-gray-400">Assista agora mesmo e comprove a qualidade da nossa transmissão.</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-black rounded-2xl overflow-hidden aspect-video border border-white/10 shadow-2xl relative group">
              {loading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-blue-500 bg-zinc-900">
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-400 animate-pulse">Carregando canais...</p>
                </div>
              ) : currentChannel ? (
                <PlayerComponent
                  url={currentChannel.url}
                  controls
                  width="100%"
                  height="100%"
                  playing
                  muted
                  config={{
                    file: {
                      forceHLS: true,
                      attributes: {
                        crossOrigin: 'anonymous'
                      }
                    }
                  }}
                  onError={(e: any) => {
                    console.error('Player Error:', e);
                    setError('Erro ao reproduzir este canal. Tente outro canal ou use um player externo.');
                  }}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-zinc-900">
                  <Play className="w-16 h-16 mb-4 opacity-20" />
                  <p>Selecione um canal na lista ao lado</p>
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
                Nossa lista oficial está carregada. Se algum canal não abrir, pode ser devido a restrições do navegador. 
                O player inicia no Globo quando disponível e começa sem áudio para permitir autoplay no navegador.
              </p>
            </div>
          </div>

          <div className="bg-zinc-900 border border-white/10 rounded-2xl flex flex-col h-[600px]">
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center gap-2 mb-4">
                <List className="w-5 h-5 text-blue-500" />
                <h3 className="font-bold">Lista de Canais</h3>
                <span className="ml-auto text-xs text-gray-500 bg-white/5 px-2 py-1 rounded">
                  {filteredChannels.length} canais
                </span>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Buscar canal..."
                  className="w-full bg-black border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
              {filteredChannels.length > 0 ? (
                filteredChannels.map((channel, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentChannel(channel)}
                    className={`w-full text-left p-3 rounded-lg text-sm transition-all mb-1 flex items-center gap-3 ${
                      currentChannel?.url === channel.url 
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                        : 'hover:bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${currentChannel?.url === channel.url ? 'bg-white' : 'bg-green-500'}`} />
                    <span className="truncate">{channel.name}</span>
                  </button>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-600">
                  <p className="text-sm">Nenhum canal carregado</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
