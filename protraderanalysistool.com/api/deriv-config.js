module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.status(405).end(JSON.stringify({ error: 'Use GET.' }));
    return;
  }
  const appId = String(process.env.DERIV_APP_ID || '').trim();
  if (!/^\d+$/.test(appId)) {
    res.status(503).end(JSON.stringify({
      error: 'DERIV_APP_ID is missing or invalid. Add your numeric Deriv App ID in Vercel Environment Variables and redeploy.'
    }));
    return;
  }
  res.status(200).end(JSON.stringify({ appId }));
};
