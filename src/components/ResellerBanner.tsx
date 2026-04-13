import React from 'react';
import { TrendingUp } from 'lucide-react';

export default function ResellerBanner() {
  return (
    <section aria-label="Banner de Revenda UltraStream" className="py-10 bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4">
        <div className="rounded-3xl border border-blue-500/20 bg-gradient-to-br from-zinc-950 via-indigo-950/60 to-purple-950/40 shadow-[0_0_50px_rgba(79,70,229,0.20)] p-6 md:p-10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 lg:gap-10">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide bg-blue-500/15 text-blue-300 border border-blue-400/25 px-3 py-1 rounded-full mb-4">
                <TrendingUp className="w-3.5 h-3.5" />
                Renda Extra
              </span>
              <h3 className="text-2xl md:text-3xl font-bold mb-3">🚀 Seja um Revendedor UltraStream</h3>
              <p className="text-gray-200 mb-3 leading-relaxed">
                Ganhe dinheiro revendendo acessos com suporte completo, ativação rápida e estrutura pronta para começar.
              </p>
              <p className="text-gray-400 text-sm md:text-base">
                Ideal para quem quer vender e criar renda extra com um serviço digital de alta procura. <span className="text-blue-300">Comece hoje mesmo.</span>
              </p>
            </div>

            <div className="w-full lg:w-auto flex flex-col sm:flex-row lg:flex-col gap-3 lg:min-w-[260px]">
              <a
                href="https://wa.me/5561992011324?text=Olá%2C%20venho%20do%20site%20UltraStreamTV%20e%20quero%20ser%20revendedor"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-center bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-5 rounded-xl transition-colors"
              >
                👉 Quero Ser Revendedor
              </a>
              <a
                href="https://ryzeen.store/#/rs/pKDNoANWXl/OxLAEVALZ7"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-center bg-white/5 hover:bg-white/10 border border-white/15 text-gray-100 font-semibold py-3 px-5 rounded-xl transition-colors"
              >
                Conhecer Painel
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
