import React, { useEffect, useState } from 'react';

const WHATSAPP_URL = 'https://wa.me/5561993099265?text=Olá%2C%20venho%20do%20site%20UltraStreamTV%20e%20quero%20assinar';

export default function UsageLockOverlay() {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const timeoutMs = 4 * 60 * 1000;
    const timerId = window.setTimeout(() => {
      setLocked(true);
    }, timeoutMs);

    return () => {
      clearTimeout(timerId);
    };
  }, []);

  if (!locked) return null;

  return (
    <div className="fixed inset-0 z-[75] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-zinc-950/95 p-6 md:p-8 text-center shadow-2xl">
        <h3 className="text-2xl md:text-3xl font-bold mb-3">Seu teste terminou.</h3>
        <p className="text-gray-300 mb-6">
          Assine para continuar assistindo sem limites.
        </p>
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 transition-colors"
        >
          👉 Assinar Agora
        </a>
      </div>
    </div>
  );
}
