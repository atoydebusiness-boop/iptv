import React, { useState } from 'react';
import { Check, Copy, Smartphone, Monitor, Tv, Laptop } from 'lucide-react';

const plans = [
  {
    name: "Mensal",
    price: "29,90",
    period: "/mês",
    features: ["1 Tela Simultânea", "4K Ultra HD", "Canais + Filmes + Séries", "Suporte 24h"],
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
    features: ["3 Telas Simultâneas", "4K Ultra HD", "Canais + Filmes + Séries", "Suporte VIP 24h", "Melhor Custo Benefício"],
    recommended: false
  }
];

export default function Pricing() {
  const [copied, setCopied] = useState(false);
  const pixKey = "33504313000136";

  const copyPix = () => {
    navigator.clipboard.writeText(pixKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
              <h3 className="text-3xl font-bold mb-6">Pagamento via PIX</h3>
              <p className="text-gray-400 mb-8 leading-relaxed">
                Para agilizar sua ativação, realize o pagamento via PIX e envie o comprovante 
                para nosso WhatsApp. Nossa equipe fará a liberação em poucos minutos.
              </p>
              
              <div className="space-y-4">
                <div className="bg-black/50 border border-white/10 p-4 rounded-2xl flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-bold mb-1">Chave PIX (CNPJ)</p>
                    <p className="font-mono text-lg">{pixKey}</p>
                  </div>
                  <button 
                    onClick={copyPix}
                    className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all text-blue-400"
                    title="Copiar Chave"
                  >
                    {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
                
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
            
            <div className="flex flex-col items-center justify-center p-8 bg-white rounded-2xl">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${pixKey}`} 
                alt="QR Code PIX"
                className="w-48 h-48 mb-4"
              />
              <p className="text-black font-bold text-sm">Escaneie para pagar</p>
              <p className="text-gray-500 text-xs mt-1">UltraStream Services LTDA</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
