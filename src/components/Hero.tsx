import React from 'react';
import { motion } from 'motion/react';
import { Play, CheckCircle2 } from 'lucide-react';

export default function Hero() {
  return (
    <section id="home" className="relative pt-32 pb-20 overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10 opacity-20">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-600 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-7xl mx-auto px-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="inline-block px-4 py-1.5 mb-6 text-sm font-medium text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-full">
            Streaming de Alta Qualidade 24/7
          </span>
          <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight">
            A Melhor Experiência de <br />
            <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              TV por Internet
            </span>
          </h1>
          <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Acesse milhares de canais, filmes e séries em qualquer dispositivo. 
            Estabilidade garantida e suporte especializado 24 horas por dia.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a 
              href="#player"
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white text-black px-8 py-4 rounded-2xl font-bold text-lg hover:bg-gray-200 transition-all hover:scale-105"
            >
              <Play className="w-5 h-5 fill-current" />
              Testar Agora
            </a>
            <a 
              href="#pricing"
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-white/10 transition-all"
            >
              Ver Planos
            </a>
          </div>

          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
            {[
              "4K Ultra HD",
              "Sem Travamentos",
              "Suporte 24h",
              "Ativação Imediata"
            ].map((feature, i) => (
              <div key={i} className="flex items-center justify-center gap-2 text-gray-400 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4 text-blue-500" />
                {feature}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
