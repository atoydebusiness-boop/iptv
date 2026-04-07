type EventName =
  | 'test_started'
  | 'content_clicked'
  | 'trial_popup_shown'
  | 'trial_blocked'
  | 'whatsapp_clicked';

type ItemType = 'live' | 'movie' | 'series' | 'unknown';

const SESSION_KEY = 'ultrastream_anon_session_id';

export const getAnonSessionId = () => {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;

  const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(SESSION_KEY, sessionId);
  return sessionId;
};

export const trackEvent = (event: EventName, options?: { route?: string; itemType?: ItemType }) => {
  if (typeof window === 'undefined') return;

  const payload = {
    event,
    route: options?.route || window.location.pathname,
    itemType: options?.itemType || 'unknown',
    sessionId: getAnonSessionId(),
    timestamp: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/events', body);
    return;
  }

  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // não bloqueia UX
  });
};
