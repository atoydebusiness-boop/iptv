import React from 'react';

type LegalPageType = 'terms' | 'privacy' | 'dmca';

interface LegalPageProps {
  type: LegalPageType;
}

const contentByType: Record<LegalPageType, { title: string; sections: Array<{ heading: string; body: string }> }> = {
  terms: {
    title: 'Termos de Uso',
    sections: [
      {
        heading: '1. Aceitação dos Termos',
        body:
          'Ao acessar e utilizar a plataforma UltraStream IPTV, você concorda com estes Termos de Uso e com a legislação aplicável.',
      },
      {
        heading: '2. Uso Permitido',
        body:
          'O serviço deve ser utilizado apenas para finalidades lícitas. É proibido usar a plataforma para atividades fraudulentas, abusivas ou que violem direitos de terceiros.',
      },
      {
        heading: '3. Conta e Acesso',
        body:
          'Você é responsável por manter suas credenciais de acesso seguras e por toda atividade realizada em sua conta.',
      },
      {
        heading: '4. Limitação de Responsabilidade',
        body:
          'A UltraStream envida esforços para manter estabilidade e qualidade, porém não garante disponibilidade ininterrupta do serviço em todos os momentos.',
      },
      {
        heading: '5. Alterações',
        body:
          'Podemos atualizar estes Termos de Uso periodicamente. A versão mais recente estará sempre disponível nesta página.',
      },
    ],
  },
  privacy: {
    title: 'Política de Privacidade',
    sections: [
      {
        heading: '1. Dados Coletados',
        body:
          'Podemos coletar dados de navegação, identificadores de sessão e informações fornecidas por você em contatos de suporte e atendimento.',
      },
      {
        heading: '2. Finalidade',
        body:
          'Os dados são utilizados para melhorar a experiência na plataforma, manter segurança, oferecer suporte e analisar desempenho do serviço.',
      },
      {
        heading: '3. Compartilhamento',
        body:
          'Não comercializamos seus dados pessoais. Podemos compartilhar informações apenas quando necessário para operação técnica ou por obrigação legal.',
      },
      {
        heading: '4. Segurança',
        body:
          'Adotamos medidas técnicas e administrativas razoáveis para proteger dados contra acesso não autorizado, alteração ou destruição.',
      },
      {
        heading: '5. Seus Direitos',
        body:
          'Você pode solicitar atualização, correção ou exclusão de dados, conforme legislação aplicável, pelos canais oficiais de atendimento.',
      },
    ],
  },
  dmca: {
    title: 'Política DMCA',
    sections: [
      {
        heading: '1. Respeito a Direitos Autorais',
        body:
          'A UltraStream respeita a propriedade intelectual e responde a notificações válidas de infração de direitos autorais.',
      },
      {
        heading: '2. Como Notificar',
        body:
          'Envie uma notificação contendo identificação da obra protegida, URL específica, dados de contato e declaração de boa-fé.',
      },
      {
        heading: '3. Ações Após Notificação',
        body:
          'Após análise preliminar, poderemos remover ou restringir o conteúdo questionado e notificar as partes envolvidas quando aplicável.',
      },
      {
        heading: '4. Contra-Notificação',
        body:
          'Caso você acredite que o conteúdo foi removido por engano, poderá enviar contra-notificação com as informações exigidas por lei.',
      },
      {
        heading: '5. Contato',
        body:
          'Para assuntos de DMCA, utilize o canal oficial de suporte via WhatsApp indicado no site.',
      },
    ],
  },
};

export default function LegalPage({ type }: LegalPageProps) {
  const content = contentByType[type];

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-4 py-12 md:py-16">
        <a href="/" className="inline-flex items-center text-sm text-blue-400 hover:text-blue-300 transition-colors mb-8">
          ← Voltar para página inicial
        </a>

        <h1 className="text-3xl md:text-4xl font-bold mb-8">{content.title}</h1>

        <div className="space-y-8">
          {content.sections.map((section) => (
            <section key={section.heading} className="rounded-xl border border-white/10 bg-zinc-900/60 p-5 md:p-6">
              <h2 className="text-lg md:text-xl font-semibold mb-3">{section.heading}</h2>
              <p className="text-zinc-300 leading-relaxed">{section.body}</p>
            </section>
          ))}
        </div>

        <p className="text-xs text-zinc-500 mt-10">
          Última atualização: 8 de abril de 2026.
        </p>
      </div>
    </div>
  );
}
