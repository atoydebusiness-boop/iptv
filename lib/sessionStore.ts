type PlanType = 'teste' | 'mensal' | 'trimestral' | 'anual';

interface ClientSession {
  token: string;
  clientId: string;
  plan: PlanType;
  expiresAt: number;
  createdAt: number;
}

interface ActiveStream {
  streamId: string;
  touchedAt: number;
}

const PLAN_LIMITS: Record<PlanType, number> = {
  teste: 1,
  mensal: 1,
  trimestral: 2,
  anual: 3,
};

const STREAM_HEARTBEAT_TTL_MS = 90_000;

const sessions = new Map<string, ClientSession>();
const activeStreamsByToken = new Map<string, Map<string, ActiveStream>>();

const cleanExpiredState = () => {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
      activeStreamsByToken.delete(token);
    }
  }

  for (const [token, streams] of activeStreamsByToken.entries()) {
    for (const [streamId, stream] of streams.entries()) {
      if (now - stream.touchedAt > STREAM_HEARTBEAT_TTL_MS) {
        streams.delete(streamId);
      }
    }
    if (streams.size === 0) activeStreamsByToken.delete(token);
  }
};

export const normalizePlan = (value?: string): PlanType => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'mensal' || normalized === 'trimestral' || normalized === 'anual') return normalized;
  return 'teste';
};

export const getPlanSessionLimit = (plan: PlanType): number => PLAN_LIMITS[plan] || 1;

export const createClientSession = (params: { clientId: string; plan?: string; trialMinutes?: number }) => {
  cleanExpiredState();
  const plan = normalizePlan(params.plan);
  const safeClientId = String(params.clientId || '').trim().slice(0, 120);
  if (!safeClientId) throw new Error('clientId obrigatório');

  const durationMs =
    plan === 'teste'
      ? Math.max(1, Math.min(Number(params.trialMinutes) || 10, 180)) * 60_000
      : 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const token = `${safeClientId}.${Math.random().toString(36).slice(2)}.${now.toString(36)}`;

  const session: ClientSession = {
    token,
    clientId: safeClientId,
    plan,
    createdAt: now,
    expiresAt: now + durationMs,
  };
  sessions.set(token, session);

  return {
    token: session.token,
    clientId: session.clientId,
    plan: session.plan,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    sessionLimit: getPlanSessionLimit(session.plan),
  };
};

export const validateClientSession = (params: { token?: string; clientId?: string }) => {
  cleanExpiredState();
  const token = String(params.token || '').trim();
  const clientId = String(params.clientId || '').trim();
  if (!token || !clientId) return { ok: false as const, reason: 'Credenciais de sessão ausentes.' };

  const session = sessions.get(token);
  if (!session) return { ok: false as const, reason: 'Token inválido ou expirado.' };
  if (session.clientId !== clientId) return { ok: false as const, reason: 'Sessão não pertence ao cliente.' };
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    activeStreamsByToken.delete(token);
    return { ok: false as const, reason: 'Sessão expirada.' };
  }

  return { ok: true as const, session };
};

export const touchStreamForSession = (params: { token: string; streamId: string }) => {
  cleanExpiredState();
  const streamId = String(params.streamId || '').trim();
  if (!streamId) {
    return { ok: true as const, activeStreams: 0, limit: 0, reason: 'streamId ausente' };
  }

  const session = sessions.get(params.token);
  if (!session) return { ok: false as const, activeStreams: 0, limit: 0, reason: 'Sessão inválida.' };

  const limit = getPlanSessionLimit(session.plan);
  const now = Date.now();
  const streams = activeStreamsByToken.get(params.token) || new Map<string, ActiveStream>();
  activeStreamsByToken.set(params.token, streams);

  for (const [existingId, stream] of streams.entries()) {
    if (now - stream.touchedAt > STREAM_HEARTBEAT_TTL_MS) streams.delete(existingId);
  }

  if (!streams.has(streamId) && streams.size >= limit) {
    return {
      ok: false as const,
      activeStreams: streams.size,
      limit,
      reason: `Limite de sessões simultâneas atingido para o plano ${session.plan}.`,
    };
  }

  streams.set(streamId, { streamId, touchedAt: now });
  return { ok: true as const, activeStreams: streams.size, limit };
};
