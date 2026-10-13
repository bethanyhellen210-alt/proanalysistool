module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.status(405).end(JSON.stringify({ error: 'Use GET.' }));
    return;
  }

  // Deriv's legacy v3 WebSocket API uses a numeric registered App ID.
  const appId = String(process.env.DERIV_APP_ID || '').trim();
  if (!/^\d+$/.test(appId)) {
    res.status(503).end(JSON.stringify({
      error: 'A numeric Deriv App ID is required for the v3 WebSocket feed. The mixed-format value is not accepted here. Copy the numeric App ID from your registered application at api.deriv.com/dashboard and set DERIV_APP_ID in Vercel.'
    }));
    return;
  }
  res.status(200).end(JSON.stringify({ appId }));
};
