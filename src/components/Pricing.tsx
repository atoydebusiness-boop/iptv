import React from 'react';
import { Check, MessageCircle, Smartphone, Monitor, Tv } from 'lucide-react';

const plans = [
  {
    name: "Mensal",
    price: "29,90",
    period: "/mês",
    features: ["Todos", "4K Ultra HD", "Canais + Filmes + Séries", "Suporte 24h"],
    recommended: false
  },
  {
    name: "Trimestral",
    price: "79,90",
    period: "/3 meses",
    features: ["2 Telas Simultâneas", "4K Ultra HD", "Canais + Filmes + Séries", "Suporte VIP 24h", "Desconto Especial"],
    recommended: true
  },
  {
    name: "Anual",
    price: "249,90",
    period: "/ano",
    features: ["2 Telas Simultâneas", "4K Ultra HD", "Canais + Filmes + Séries", "Suporte VIP 24h", "Melhor Custo Benefício"],
    recommended: false
  }
];

export default function Pricing() {
  const whatsappUrl = 'https://wa.me/5561993099265?text=Olá! Quero assinar agora, me passa os dados para pagamento.';

  return (
    <section id="pricing" className="py-20">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Escolha seu Plano</h2>
          <p className="text-gray-400">Ativação imediata após o envio do comprovante.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mb-20">
          {plans.map((plan, i) => (
            <div 
              key={i}
              className={`relative p-8 rounded-3xl border ${
                plan.recommended 
                  ? 'bg-blue-600 border-blue-400 shadow-2xl shadow-blue-600/20 scale-105 z-10' 
                  : 'bg-zinc-900 border-white/10'
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-white text-blue-600 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                  Mais Popular
                </span>
              )}
              <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-sm font-medium">R$</span>
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className="text-gray-400 text-sm">{plan.period}</span>
              </div>
              <ul className="space-y-4 mb-8">
                {plan.features.map((feature, j) => (
                  <li key={j} className="flex items-center gap-3 text-sm">
                    <Check className={`w-4 h-4 ${plan.recommended ? 'text-white' : 'text-blue-500'}`} />
                    <span className={plan.recommended ? 'text-blue-50' : 'text-gray-300'}>{feature}</span>
                  </li>
                ))}
              </ul>
              <a 
                href={`https://wa.me/5561993099265?text=Olá! Quero assinar o plano ${plan.name}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`w-full block text-center py-4 rounded-xl font-bold transition-all ${
                  plan.recommended 
                    ? 'bg-white text-blue-600 hover:bg-gray-100' 
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                Assinar Agora
              </a>
            </div>
          ))}
        </div>

        <div className="bg-zinc-900 border border-white/10 rounded-3xl p-8 md:p-12">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-3xl font-bold mb-6">Ativação via WhatsApp</h3>
              <p className="text-gray-400 mb-8 leading-relaxed">
                Removemos o QR Code e a chave PIX da página. Agora o pagamento e a ativação são tratados direto no WhatsApp para facilitar.
              </p>
              
              <div className="space-y-4">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-2xl transition-all"
                >
                  <MessageCircle className="w-5 h-5" />
                  Pedir no WhatsApp (61) 99309-9265
                </a>
                
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <div className="flex -space-x-2">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-zinc-900 flex items-center justify-center"><Smartphone className="w-4 h-4" /></div>
                    <div className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-zinc-900 flex items-center justify-center"><Tv className="w-4 h-4" /></div>
                    <div className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-zinc-900 flex items-center justify-center"><Monitor className="w-4 h-4" /></div>
                  </div>
                  <p>Compatível com todos os dispositivos</p>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col items-center justify-center p-8 bg-black/40 border border-white/10 rounded-2xl">
              <MessageCircle className="w-16 h-16 text-green-500 mb-4" />
              <p className="font-bold text-lg text-white">Pagamento direto no atendimento</p>
              <p className="text-gray-400 text-sm mt-2 text-center">
                Chama no WhatsApp e a equipe já te passa os dados de pagamento e libera seu acesso.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-16 bg-gradient-to-br from-zinc-900 to-indigo-950 border border-white/10 rounded-3xl p-8 md:p-12">
          <div className="text-center max-w-3xl mx-auto">
            <h3 className="text-3xl md:text-4xl font-bold mb-4">Sua Nova Experiência de TV Começa Aqui</h3>
            <p className="text-gray-300 mb-10">
              Assista com qualidade, estabilidade e praticidade em qualquer dispositivo.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-10">
            {[
              'Funciona em Smart TV, TV Box, celular e computador',
              'Interface moderna e fácil de usar',
              'Canais ao vivo, filmes e séries em um só lugar',
              'Qualidade HD e estabilidade',
              'Suporte rápido via WhatsApp',
            ].map((benefit) => (
              <div key={benefit} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                <Check className="w-4 h-4 text-blue-400 shrink-0" />
                <p className="text-sm text-gray-200">{benefit}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-10">
            {[
              { label: '+500', text: 'clientes ativos' },
              { label: '24h', text: 'funcionando sem parar' },
              { label: 'Alta', text: 'estabilidade' },
            ].map((proof) => (
              <div key={proof.text} className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-5 text-center">
                <p className="text-2xl font-bold text-blue-300">{proof.label}</p>
                <p className="text-sm text-gray-200">{proof.text}</p>
              </div>
            ))}
          </div>

          <div className="text-center">
            <p className="text-xl md:text-2xl font-bold mb-4">Quero Assinar Agora</p>
            <a
              href="https://wa.me/5561993099265?text=Olá%2C%20venho%20do%20site%20UltraStreamTV%20e%20quero%20assinar"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold text-lg py-4 px-8 rounded-2xl transition-all"
            >
              👉 Falar no WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
