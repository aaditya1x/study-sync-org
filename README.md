# Study Sync

Study Sync is a React + Vite study dashboard. This package has a clean project root, working Vite scripts, and the Supabase JavaScript client dependency prepared.

## Run on Windows (recommended)

1. Extract the ZIP completely to a normal folder (for example `Downloads\CampusFlow-Ready`).
2. Open the extracted `CampusFlow-Ready` folder. You should see `package.json`, `index.html`, `src`, and `RUN-CAMPUSFLOW.bat` together.
3. Double-click `RUN-CAMPUSFLOW.bat`. On the first run it installs dependencies, then starts Vite.
4. Open the URL printed in the terminal, usually `http://localhost:5173/`.
5. Keep the terminal window open while using the site. Press `Ctrl+C` in that window to stop it.

## Run through VS Code

Open the folder containing `package.json` (not a parent folder and not `src`). In Terminal > New Terminal run:

```powershell
npm install
npm run dev
```

## Supabase setup

Supabase Auth and private Storage uploads are wired into the app. Study materials and profile photos are saved to private Supabase Storage buckets; the app creates signed URLs for downloads. Text-based PDFs are indexed into private, user-scoped chunks so AI Study Tools can answer questions with page references. Scanned PDFs need OCR and are not supported for Q&A yet.

1. Copy `.env.example` to `.env` in the same folder as `package.json`, or update your existing `.env` there.
2. In your Supabase project, open **Connect** and copy the Project URL and publishable key into `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Never put a secret or `service_role` key in frontend code.
4. Run [`supabase-read-only-audit.sql`](./supabase-read-only-audit.sql) in the intended Supabase project. It reports public table columns, whether RLS is enabled/forced, the two bucket configurations and all existing table/Storage policy expressions. A missing bucket has no row; the expected buckets are private (`public = false`) with limits of 52,428,800 bytes (study materials) and 2,097,152 bytes (profile photos). Review broad existing policies as well as their `qual` and `with_check` expressions.
5. Review [`supabase-migrations/20261029_existing-project-repair.sql`](./supabase-migrations/20261029_existing-project-repair.sql), then run it manually only after reviewing the audit output. It adds `is_indexed` if absent, creates missing private buckets, changes an existing `study-materials` bucket to private without deleting its objects, adds owner-folder Storage policies and owner-scoped table policies, and installs restrictive owner guards. It removes only the specifically named broad/obsolete policies when their definitions match the migration's checks. A wrong existing bucket size or public `profile-photos` bucket stops the migration for manual review. Do not run the older [`supabase-setup.sql`](./supabase-setup.sql) against an existing project.
6. In Authentication > URL Configuration, add your local app URL (usually `http://localhost:5173`) to the allowed redirect URLs.
7. To use AI and PDF indexing locally, set `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY` in `.env`. Never give the secret key a `VITE_` prefix.
8. Restart Vite after changing `.env`.

The local Vite server serves `/api/ai`, `/api/index-book`, and `/api/ask-book`. In production, set those server-only variables in your hosting provider's function environment. Profile photo object paths are saved in the signed-in user's Supabase Auth `user_metadata.avatar_path`; this project does not depend on a `public.profiles` table for the photo.

Tasks and courses use Postgres tables separately from Storage. File content is stored in the private buckets, with short-lived signed links for downloads.

## Build check

```powershell
npm run build
```
