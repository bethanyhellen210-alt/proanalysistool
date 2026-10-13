const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const json = (res, status, body) => {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

const getDb = () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Neon database is not configured. Set DATABASE_URL in Vercel.');
  return neon(url);
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
    const sql = getDb();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '');

    if (action === 'validate') {
      const key = String(body.accessKey || '').trim().toUpperCase();
      if (!/^[A-Z0-9-]{12,80}$/.test(key)) {
        return json(res, 401, { error: 'Invalid or revoked access key.' });
      }
      const rows = await sql`
        SELECT id, label, expires_at
        FROM access_keys
        WHERE key_hash = ${hash(key)} AND revoked_at IS NULL
        LIMIT 1
      `;
      const record = rows[0];
      if (!record || (record.expires_at && Date.parse(record.expires_at) <= Date.now())) {
        return json(res, 401, { error: 'Invalid, expired, or revoked access key.' });
      }
      const sessionToken = randomToken();
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      await sql`
        INSERT INTO access_sessions (key_id, token_hash, expires_at)
        VALUES (${record.id}, ${hash(sessionToken)}, ${expiresAt})
      `;
      return json(res, 200, {
        ok: true, sessionToken, expiresAt,
        user: { username: record.label || 'Authorized user' }
      });
    }

    if (action === 'session') {
      const token = String(body.sessionToken || '');
      if (token.length < 32) return json(res, 401, { valid: false });
      const rows = await sql`
        SELECT s.id, s.expires_at AS session_expires_at, k.label
        FROM access_sessions s
        JOIN access_keys k ON k.id = s.key_id
        WHERE s.token_hash = ${hash(token)}
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
          AND k.revoked_at IS NULL
          AND (k.expires_at IS NULL OR k.expires_at > NOW())
        LIMIT 1
      `;
      if (!rows.length) return json(res, 401, { valid: false });
      return json(res, 200, {
        valid: true,
        expiresAt: rows[0].session_expires_at,
        user: { username: rows[0].label || 'Authorized user' }
      });
    }

    if (!['create', 'list', 'revoke'].includes(action)) {
      return json(res, 400, { error: 'Unknown action.' });
    }
    const configuredAdminKey = process.env.ACCESS_ADMIN_KEY || '';
    if (configuredAdminKey.length < 24) {
      return json(res, 503, {
        error: 'Admin key is not configured correctly in Vercel. Set ACCESS_ADMIN_KEY to at least 24 characters and redeploy.'
      });
    }
    if (!adminAllowed(req)) {
      return json(res, 403, {
        error: 'Admin key does not match ACCESS_ADMIN_KEY for this deployment. Check the exact value and redeploy.'
      });
    }

    if (action === 'create') {
      const label = String(body.label || '').trim().slice(0, 100);
      const days = body.days === '' || body.days == null ? null : Number(body.days);
      if (!label) return json(res, 400, { error: 'Enter a user or key label.' });
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
        return json(res, 400, { error: 'Expiry must be between 1 and 3650 days, or blank for no expiry.' });
      }
      const accessKey = 'MT-' + crypto.randomBytes(18).toString('hex').toUpperCase();
      const expiresAt = days === null ? null : new Date(Date.now() + days * 86400000).toISOString();
      const rows = await sql`
        INSERT INTO access_keys (label, key_hash, expires_at, created_by)
        VALUES (${label}, ${hash(accessKey)}, ${expiresAt}, 'admin')
        RETURNING id, label, created_at, expires_at
      `;
      return json(res, 200, { ok: true, accessKey, key: rows[0] });
    }

    if (action === 'list') {
      const rows = await sql`
        SELECT id, label, created_at, expires_at, revoked_at
        FROM access_keys
        ORDER BY created_at DESC
        LIMIT 200
      `;
      return json(res, 200, { keys: rows });
    }

    const id = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: 'Invalid key ID.' });
    const rows = await sql`
      UPDATE access_keys
      SET revoked_at = NOW()
      WHERE id = ${id}::uuid AND revoked_at IS NULL
      RETURNING id
    `;
    if (rows.length) {
      await sql`
        UPDATE access_sessions
        SET revoked_at = NOW()
        WHERE key_id = ${id}::uuid AND revoked_at IS NULL
      `;
    }
    return json(res, 200, { ok: true, revoked: rows.length > 0 });
  } catch (error) {
    const raw = String(error && error.message || 'Unknown server error');
    console.error('Access API error:', raw.slice(0, 500));
    let diagnostic = 'Database request failed. Check DATABASE_URL, table setup, and Neon database status.';
    if (/DATABASE_URL/.test(raw)) diagnostic = raw;
    else if (/relation .* does not exist|access_keys|access_sessions/i.test(raw)) {
      diagnostic = 'Neon tables are missing. Run neon-access-keys.sql in the Neon SQL Editor.';
    } else if (/password authentication failed|connection string|endpoint/i.test(raw)) {
      diagnostic = 'Neon rejected DATABASE_URL. Copy the connection string from the correct Neon project.';
    }
    return json(res, 500, {
      error: 'Access service unavailable. Check server environment and database setup.',
      diagnostic
    });
  }
};
