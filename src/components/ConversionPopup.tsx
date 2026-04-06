import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';

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
  const [open, setOpen] = useState(false);
  const [clickCount, setClickCount] = useState(0);
  const [canTrigger, setCanTrigger] = useState(false);
  const storageKey = useMemo(() => getSessionStorageKey(), []);

  const closePopup = () => {
    localStorage.setItem(storageKey, '1');
    setOpen(false);
    setCanTrigger(false);
  };

  useEffect(() => {
    const alreadySeen = localStorage.getItem(storageKey) === '1';
    if (alreadySeen) return;

    setCanTrigger(true);
    const delayMs = 24000;
    const timerId = window.setTimeout(() => {
      setOpen(true);
    }, delayMs);

    const onClick = () => {
      setClickCount((prev) => prev + 1);
    };

    window.addEventListener('click', onClick, { capture: true });
    return () => {
      clearTimeout(timerId);
      window.removeEventListener('click', onClick, { capture: true });
    };
  }, [storageKey]);

  useEffect(() => {
    if (!canTrigger || open) return;
    if (clickCount >= 2) {
      setOpen(true);
    }
  }, [clickCount, canTrigger, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg rounded-3xl border border-white/15 bg-gradient-to-br from-zinc-950 via-zinc-900 to-indigo-950 shadow-2xl p-6 md:p-8 animate-in fade-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={closePopup}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
          aria-label="Fechar popup"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-2xl md:text-3xl font-bold mb-3">🔥 Libere Tudo Agora</h3>
        <p className="text-gray-300 leading-relaxed mb-6">
          Você está usando o modo teste do UltraStream.
          <br />
          Assine agora e tenha acesso completo a canais, filmes e séries com qualidade e estabilidade.
        </p>

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
