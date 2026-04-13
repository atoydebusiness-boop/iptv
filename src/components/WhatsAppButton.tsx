import React from 'react';
import { MessageCircle } from 'lucide-react';

export default function WhatsAppButton() {
  return (
    <a
      href="https://wa.me/5561992011324?text=Olá%2C%20venho%20do%20site%20UltraStreamTV%20e%20quero%20assinar"
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-50 bg-green-500 hover:bg-green-600 text-white p-4 rounded-full shadow-2xl shadow-green-500/40 transition-all hover:scale-110 active:scale-95 group"
    >
      <MessageCircle className="w-7 h-7" />
      <span className="absolute right-full mr-4 top-1/2 -translate-y-1/2 bg-black/80 backdrop-blur-md text-white text-xs font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        Falar no WhatsApp
      </span>
    </a>
  );
}
