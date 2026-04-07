import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { trackEvent } from '../lib/analytics';

const WHATSAPP_URL = 'https://wa.me/5561993099265?text=Olá%2C%20venho%20do%20site%20UltraStreamTV%20e%20quero%20assinar';
const SESSION_ID_KEY = 'ultrastream_session_id';
const POPUP_SEEN_PREFIX = 'ultrastream_popup_seen_';

const getSessionStorageKey = () => {
  const existing = sessionStorage.getItem(SESSION_ID_KEY);
  if (existing) return `${POPUP_SEEN_PREFIX}${existing}`;

  const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  return `${POPUP_SEEN_PREFIX}${sessionId}`;
};

export default function ConversionPopup() {
  const [stage, setStage] = useState<'five' | 'fifteen' | null>(null);
  const storageKey = useMemo(() => getSessionStorageKey(), []);
  const fiveMinuteSeenKey = `${storageKey}_five`;
  const fifteenMinuteSeenKey = `${storageKey}_fifteen`;

  const closePopup = () => {
    if (stage === 'five') {
      localStorage.setItem(fiveMinuteSeenKey, '1');
    }
    if (stage === 'fifteen') {
      localStorage.setItem(fifteenMinuteSeenKey, '1');
    }
    setStage(null);
  };

  useEffect(() => {
    const showFiveMinutePrompt = () => {
      if (localStorage.getItem(fiveMinuteSeenKey) === '1') return;
      setStage('five');
      trackEvent('trial_popup_shown', { route: window.location.pathname, itemType: 'unknown' });
    };

    const showFifteenMinutePrompt = () => {
      if (localStorage.getItem(fifteenMinuteSeenKey) === '1') return;
      setStage('fifteen');
      trackEvent('trial_popup_shown', { route: window.location.pathname, itemType: 'unknown' });
    };

    const fiveMinuteTimerId = window.setTimeout(showFiveMinutePrompt, 5 * 60 * 1000);
    const fifteenMinuteTimerId = window.setTimeout(showFifteenMinutePrompt, 15 * 60 * 1000);

    return () => {
      clearTimeout(fiveMinuteTimerId);
      clearTimeout(fifteenMinuteTimerId);
    };
  }, [fiveMinuteSeenKey, fifteenMinuteSeenKey]);

  if (!stage) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[80] w-[calc(100%-2rem)] max-w-md">
      <div className={`relative rounded-2xl border bg-gradient-to-br from-zinc-950 via-zinc-900 to-indigo-950 shadow-2xl p-5 md:p-6 animate-in fade-in slide-in-from-bottom-3 duration-200 ${
        stage === 'fifteen' ? 'border-blue-400/40' : 'border-white/15'
      }`}>
        <button
          type="button"
          onClick={closePopup}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
          aria-label="Fechar popup"
        >
          <X className="w-5 h-5" />
        </button>

        {stage === 'five' ? (
          <>
            <h3 className="text-xl md:text-2xl font-bold mb-3">🔥 Gostando do UltraStream?</h3>
            <p className="text-gray-300 leading-relaxed mb-5">
              Continue com acesso completo e sem interrupções quando quiser.
            </p>
          </>
        ) : (
          <>
            <h3 className="text-xl md:text-2xl font-bold mb-3">Você já testou bastante.</h3>
            <p className="text-gray-300 leading-relaxed mb-5">
              Libere acesso completo para continuar sem limitações.
            </p>
          </>
        )}

        <div className="flex flex-col gap-3">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 transition-colors"
          >
            <MessageCircle className="w-5 h-5" />
            👉 Assinar via WhatsApp
          </a>
          <button
            type="button"
            onClick={closePopup}
            className="w-full rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-gray-100 py-3 px-4 transition-colors"
          >
            Continuar testando
          </button>
        </div>
      </div>
    </div>
  );
}
