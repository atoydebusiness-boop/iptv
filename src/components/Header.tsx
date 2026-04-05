import React from 'react';
import { Play, Shield, Zap, Tv } from 'lucide-react';

export default function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-1.5 rounded-lg">
            <Tv className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            UltraStream
          </span>
        </div>
        
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
          <a href="#home" className="hover:text-white transition-colors">Início</a>
          <a href="#player" className="hover:text-white transition-colors">Testar</a>
          <a href="#pricing" className="hover:text-white transition-colors">Planos</a>
        </nav>

        <a 
          href="#pricing"
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-full text-sm font-semibold transition-all hover:scale-105 active:scale-95"
        >
          Assinar Agora
        </a>
      </div>
    </header>
  );
}
