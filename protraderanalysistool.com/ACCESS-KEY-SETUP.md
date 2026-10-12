# Individual access-key setup

The login now checks keys on the server. Keys are stored as SHA-256 hashes, can expire, and can be revoked; active sessions are invalidated when their key is revoked. Do not put the Supabase service-role key or the admin key in frontend files.

## 1. Create the database tables

1. Open the Supabase project used for this deployment.
2. Open **SQL Editor** and create a new query.
3. Copy all contents of `supabase-access-keys.sql` from this folder, run it, and confirm it succeeds.

## 2. Configure server secrets

Add these as server-side environment variables/secrets in the hosting project:

- `SUPABASE_URL`: the Supabase project URL, for example `https://YOUR_PROJECT_REF.supabase.co`.
- `SUPABASE_SECRET_KEY`: the project's new `sb_secret_...` key (recommended), OR `SUPABASE_SERVICE_ROLE_KEY`: the legacy `service_role` key. Set only one if possible. Never expose either as a public frontend variable.
- `ACCESS_ADMIN_KEY`: a randomly generated secret at least 24 characters long. Keep it private.

For Vercel, add the variables under **Project → Settings → Environment Variables**, for Production and Preview as appropriate, then redeploy. Set the Vercel project root to `protraderanalysistool.com` so `api/access.js` is deployed as the `/api/access` function.

For the included Python server, add the same secrets in the hosting provider's server environment and restart the app.

## 3. Issue and revoke keys

Open `https://YOUR-DEPLOYED-HOST/admin.html`, enter the `ACCESS_ADMIN_KEY`, and issue a key with a user label and optional expiry in days. Copy the key when it is first displayed; the raw key is not stored and cannot be shown again.

Use **Revoke** to disable a key and invalidate its active sessions. Users must sign in with a newly issued key to regain access.

## Notes

- The existing analysis UI and market-data logic remain in place.
- The server returns generic errors to visitors; server logs contain the technical error.
- Database schema and server secrets must be configured before login can succeed. There is intentionally no hardcoded fallback key.
