export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const sessionId = String(req.query?.sessionId || 'anonymous');
  const route = String(req.query?.route || '/');
  const timestamp = new Date().toISOString();

  console.info(
    '[ultrastream_event]',
    JSON.stringify({
      event: 'test_started',
      timestamp,
      route,
      itemType: 'unknown',
      sessionId,
    }),
  );

  return res.status(200).json({ ok: true, event: 'test_started' });
}
