# Access-key setup with Neon PostgreSQL

The access-key API uses Neon PostgreSQL. Supabase is no longer used by `api/access.js`.

## 1. Create a Neon database

1. Open https://neon.tech and create a project.
2. Open the project's SQL Editor.
3. Run the full contents of `neon-access-keys.sql` from this folder.

## 2. Configure Vercel

In **Vercel → Project → Settings → Environment Variables**, add these variables for Production (and Preview if you test previews):

- `DATABASE_URL`: copy the Neon connection string from the same Neon project. Keep the full connection string private.
- `ACCESS_ADMIN_KEY`: a private random secret of at least 24 characters. Keep the same value you enter on the admin page.

Set the Vercel project's Root Directory to `protraderanalysistool.com`. The `package.json` in that folder installs the Neon serverless driver and `api/access.js` deploys as `/api/access`.

Save the variables and redeploy the project.

## 3. Test

Open `https://YOUR-DEPLOYED-HOST/admin.html`, enter the configured admin key, and create a test access key. Test that key in the normal login screen, then test listing and revoking it in the admin page.

## Existing Supabase data

Switching databases does not automatically copy existing keys or sessions. The database stores access-key hashes, not the original keys. If you need to preserve existing users, export/import the existing rows from both tables into Neon before switching the live deployment. Existing sessions may be allowed to expire and users can be issued new keys if you do not migrate them.

## Security

Never put `DATABASE_URL` or `ACCESS_ADMIN_KEY` in frontend JavaScript or commit them to GitHub. They must remain server-side Vercel environment variables. Do not share them in chat.
