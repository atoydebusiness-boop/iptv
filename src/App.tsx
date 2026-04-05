/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import Player from './components/Player';
import Pricing from './components/Pricing';
import WhatsAppButton from './components/WhatsAppButton';

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-blue-500/30">
      <Header />
      <main>
        <Hero />
        <Player />
        <Pricing />
      </main>
      
      <footer className="py-12 border-t border-white/10 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="bg-blue-600 p-1 rounded">
              <span className="font-bold text-xs">US</span>
            </div>
            <span className="font-bold tracking-tight">UltraStream</span>
          </div>
          <p className="text-gray-500 text-sm mb-4">
            © 2026 UltraStream IPTV. Todos os direitos reservados.
          </p>
          <div className="flex justify-center gap-6 text-xs text-gray-600">
            <a href="#" className="hover:text-white transition-colors">Termos de Uso</a>
            <a href="#" className="hover:text-white transition-colors">Privacidade</a>
            <a href="#" className="hover:text-white transition-colors">DMCA</a>
          </div>
        </div>
      </footer>

      <WhatsAppButton />
    </div>
  );
}
