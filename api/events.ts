const readBody = async (req: any) => {
  if (req.body && typeof req.body === 'object') return req.body;

  let raw = '';
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => resolve());
    req.on('error', reject);
  });

  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = await readBody(req);
  const logPayload = {
    event: body?.event || 'unknown_event',
    timestamp: body?.timestamp || new Date().toISOString(),
    route: body?.route || '/',
    itemType: body?.itemType || 'unknown',
    sessionId: body?.sessionId || 'anonymous',
  };

  console.info('[ultrastream_event]', JSON.stringify(logPayload));
  return res.status(200).json({ ok: true });
}
