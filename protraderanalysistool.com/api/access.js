const crypto = require('crypto');

const json = (res, status, body) => {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const db = async (table, method='GET', query='', body) => {
  const base = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !service) throw new Error('Server access database is not configured.');
  const response = await fetch(base.replace(/\/$/, '') + '/rest/v1/' + table + (query ? '?' + query : ''), {
    method,
    headers: {
      apikey: service,
      Authorization: 'Bearer ' + service,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=representation'
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  if (!response.ok) throw new Error('Access database request failed (' + response.status + ').');
  return text ? JSON.parse(text) : [];
};
const activeKey = async keyHash => {
  const rows = await db('access_keys', 'GET',
    'key_hash=eq.' + encodeURIComponent(keyHash) + '&revoked_at=is.null&select=id,label,expires_at&limit=1');
  if (!rows.length) return null;
  if (rows[0].expires_at && Date.parse(rows[0].expires_at) <= Date.now()) return null;
  return rows[0];
};
const adminAllowed = req => {
  const expected = process.env.ACCESS_ADMIN_KEY || '';
  const supplied = String(req.headers['x-admin-key'] || (req.body && req.body.adminKey) || '');
  return expected.length >= 24 && supplied.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '');
    if (action === 'validate') {
      const key = String(body.accessKey || '').trim().toUpperCase();
      if (!/^[A-Z0-9-]{12,80}$/.test(key)) return json(res, 401, { error: 'Invalid or revoked access key.' });
      const record = await activeKey(hash(key));
      if (!record) return json(res, 401, { error: 'Invalid, expired, or revoked access key.' });
      const sessionToken = randomToken();
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      await db('access_sessions', 'POST', '', {
        key_id: record.id, token_hash: hash(sessionToken), expires_at: expiresAt
      });
      return json(res, 200, { ok: true, sessionToken, expiresAt, user: { username: record.label || 'Authorized user' } });
    }
    if (action === 'session') {
      const token = String(body.sessionToken || '');
      if (token.length < 32) return json(res, 401, { valid: false });
      const rows = await db('access_sessions', 'GET',
        'token_hash=eq.' + hash(token) + '&revoked_at=is.null&expires_at=gt.' +
        encodeURIComponent(new Date().toISOString()) + '&select=id,key_id&limit=1');
      if (!rows.length) return json(res, 401, { valid: false });
      const keys = await db('access_keys', 'GET',
        'id=eq.' + encodeURIComponent(rows[0].key_id) + '&revoked_at=is.null&select=id,label,expires_at&limit=1');
      if (!keys.length || (keys[0].expires_at && Date.parse(keys[0].expires_at) <= Date.now())) {
        return json(res, 401, { valid: false });
      }
      return json(res, 200, { valid: true, user: { username: keys[0].label || 'Authorized user' } });
    }
    if (!['create', 'list', 'revoke'].includes(action)) return json(res, 400, { error: 'Unknown action.' });
    if (!adminAllowed(req)) return json(res, 403, { error: 'Admin authorization required.' });

    if (action === 'create') {
      const label = String(body.label || '').trim().slice(0, 100);
      const days = body.days === '' || body.days == null ? null : Number(body.days);
      if (!label) return json(res, 400, { error: 'Enter a user or key label.' });
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
        return json(res, 400, { error: 'Expiry must be between 1 and 3650 days, or blank for no expiry.' });
      }
      const accessKey = 'MT-' + crypto.randomBytes(18).toString('hex').toUpperCase();
      const expires_at = days === null ? null : new Date(Date.now() + days * 86400000).toISOString();
      const rows = await db('access_keys', 'POST', '', {
        label, key_hash: hash(accessKey), expires_at, created_by: 'admin'
      });
      return json(res, 200, { ok: true, accessKey, key: { id: rows[0].id, label, created_at: rows[0].created_at, expires_at } });
    }
    if (action === 'list') {
      const rows = await db('access_keys', 'GET',
        'select=id,label,created_at,expires_at,revoked_at&order=created_at.desc&limit=200');
      return json(res, 200, { keys: rows });
    }
    const id = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: 'Invalid key ID.' });
    const rows = await db('access_keys', 'PATCH', 'id=eq.' + encodeURIComponent(id) + '&revoked_at=is.null', { revoked_at: new Date().toISOString() });
    if (rows.length) {
      await db('access_sessions', 'PATCH', 'key_id=eq.' + encodeURIComponent(id) + '&revoked_at=is.null', { revoked_at: new Date().toISOString() });
    }
    return json(res, 200, { ok: true, revoked: rows.length > 0 });
  } catch (error) {
    console.error('Access API error:', error.message);
    return json(res, 500, { error: 'Access service unavailable. Check server environment and database setup.' });
  }
};
