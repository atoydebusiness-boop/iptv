/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import Player from './components/Player';
import ResellerBanner from './components/ResellerBanner';
import Pricing from './components/Pricing';
import WhatsAppButton from './components/WhatsAppButton';
import ConversionPopup from './components/ConversionPopup';
import UsageLockOverlay from './components/UsageLockOverlay';
import LegalPage from './components/LegalPage';
import { getAnonSessionId, trackEvent } from './lib/analytics';

export default function App() {
  const pathname = window.location.pathname.toLowerCase();
  const legalRouteMap: Record<string, 'terms' | 'privacy' | 'dmca'> = {
    '/termos-de-uso': 'terms',
    '/privacidade': 'privacy',
    '/dmca': 'dmca',
  };

  const legalPageType = legalRouteMap[pathname];

  useEffect(() => {
    const sessionId = getAnonSessionId();
    const route = pathname;
    fetch(`/api/test-started?sessionId=${encodeURIComponent(sessionId)}&route=${encodeURIComponent(route)}`, {
      method: 'GET',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {
      // não bloqueia UX
    });

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href*="wa.me"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      trackEvent('whatsapp_clicked', { route: window.location.pathname, itemType: 'unknown' });
    };

    window.addEventListener('click', onClick, { capture: true });
    return () => {
      window.removeEventListener('click', onClick, { capture: true });
    };
  }, []);

  if (legalPageType) {
    return <LegalPage type={legalPageType} />;
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-blue-500/30">
      <Header />
      <main>
        <Hero />
        <Player />
        <ResellerBanner />
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
            <a href="/termos-de-uso" className="hover:text-white transition-colors">Termos de Uso</a>
            <a href="/privacidade" className="hover:text-white transition-colors">Privacidade</a>
            <a href="/dmca" className="hover:text-white transition-colors">DMCA</a>
          </div>
        </div>
      </footer>

      <WhatsAppButton />
      <ConversionPopup />
      <UsageLockOverlay />
    </div>
  );
}
