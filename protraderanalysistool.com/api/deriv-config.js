module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.status(405).end(JSON.stringify({ error: 'Use GET.' }));
    return;
  }

  // Use the supplied updated identifier by default; Vercel can override it with DERIV_APP_ID.
  const appId = String(process.env.DERIV_APP_ID || '34EWiRFsKNgMMfSbjXawQ').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(appId)) {
    res.status(503).end(JSON.stringify({
      error: 'DERIV_APP_ID is missing or has an unsupported format. Check the App ID shown for your registered Deriv application.'
    }));
    return;
  }
  res.status(200).end(JSON.stringify({ appId }));
};
