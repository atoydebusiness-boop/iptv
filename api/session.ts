import { createClientSession } from '../lib/sessionStore';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const clientId = String(req.query?.clientId || '').trim();
    const plan = String(req.query?.plan || 'teste').trim();
    const trialMinutes = Number(req.query?.trialMinutes || 10);
    const session = createClientSession({ clientId, plan, trialMinutes });
    res.status(200).json(session);
  } catch (error: any) {
    res.status(400).json({
      error: 'Falha ao criar sessão',
      details: error?.message || 'Parâmetros inválidos.',
    });
  }
}
