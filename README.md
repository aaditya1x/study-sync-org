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

PDF indexing uses `pdf2json` for page-preserving text extraction without native canvas bindings. The project requires Node.js `>=22.23.2` for the Vercel function runtime.

1. Copy `.env.example` to `.env` in the same folder as `package.json`, or update your existing `.env` there.
2. In your Supabase project, open **Connect** and copy the Project URL and publishable key into `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Never put a secret or `service_role` key in frontend code.
4. Run [`supabase-read-only-audit.sql`](./supabase-read-only-audit.sql) in the intended Supabase project. It reports public table columns, whether RLS is enabled/forced, the two bucket configurations and all existing table/Storage policy expressions. A missing bucket has no row; the expected buckets are private (`public = false`) with limits of 52,428,800 bytes (study materials) and 2,097,152 bytes (profile photos). Review broad existing policies as well as their `qual` and `with_check` expressions.
5. Review [`supabase-migrations/20261029_existing-project-repair.sql`](./supabase-migrations/20261029_existing-project-repair.sql), then run it manually only after reviewing the audit output. It adds `is_indexed` if absent, creates missing private buckets, changes an existing `study-materials` bucket to private without deleting its objects, adds owner-folder Storage policies and owner-scoped table policies, and installs restrictive owner guards. It removes only the specifically named broad/obsolete policies when their definitions match the migration's checks. A wrong existing bucket size or public `profile-photos` bucket stops the migration for manual review. Do not run the older [`supabase-setup.sql`](./supabase-setup.sql) against an existing project.
6. Run [`supabase-migrations/20261029_material_course_relationship.sql`](./supabase-migrations/20261029_material_course_relationship.sql) if its `course_id`/`is_shared` schema and ownership preflights match your audit.
7. Review and manually run [`supabase-migrations/20261029_study_materials_student_sharing.sql`](./supabase-migrations/20261029_study_materials_student_sharing.sql). It makes academic course fields and shared material metadata/files available to authenticated students, retains owner-only course/material mutations, allows unassigned materials, and keeps course progress/material counters out of authenticated column reads. It validates the expected 50 MiB `study-materials` bucket and makes it private in the same transaction as its access policies. New uploads require uploader-folder paths; legacy paths are retained when a matching Storage object exists and its `owner_id` matches the metadata `user_id`. Making the bucket private disables existing public object URLs, but leaves stored objects intact. This app uses short-lived signed download URLs. If it reports an unrecognized restrictive policy, inspect the audit output and resolve that policy before retrying. Do not run `20261029_existing-project-repair.sql` again afterward; it reinstalls owner-only course guards.
8. Verify with two registered accounts: A uploads a PDF (shared by default); B sees it in Study Materials and the shared course/syllabus view, opens/downloads it, and cannot delete it; A can delete it. Repeat with a shared course and a linked file. Confirm B cannot read A's task/profile data and the course `progress`/`materials` columns are not selectable. This repository does not grant an admin exception; material deletion is uploader-only.
9. In Authentication > URL Configuration, add your local app URL (usually `http://localhost:5173`) to the allowed redirect URLs.
10. To use AI and PDF indexing locally, set `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY` in `.env`. Never give the secret key a `VITE_` prefix.
11. Restart Vite after changing `.env`.

The local Vite server serves `/api/ai`, `/api/index-book`, and `/api/ask-book`. In production, set those server-only variables in your hosting provider's function environment. Profile photo object paths are saved in the signed-in user's Supabase Auth `user_metadata.avatar_path`; this project does not depend on a `public.profiles` table for the photo.

## Deploy API routes to Vercel

The root `api/` directory contains Vercel Node.js Functions: `api/ai.js` serves `/api/ai`, `api/index-book.js` serves `/api/index-book`, and `api/ask-book.js` serves `/api/ask-book`. The Vite middleware in `vite.config.js` is only for local development; it does not deploy these functions. Keep the Vercel project root set to this repository folder so Vercel detects `api/` alongside `package.json`.

In Vercel **Project Settings → Environment Variables**, add these server variables for Production (and Preview too if you test preview deployments):

- `SUPABASE_URL` — the Project URL from Supabase.
- `SUPABASE_PUBLISHABLE_KEY` — the project's publishable key from Supabase API Keys.
- `SUPABASE_SECRET_KEY` — a server-only secret key from Supabase API Keys. The older `SUPABASE_SERVICE_ROLE_KEY` is also accepted by the routes, but do not expose either key to the browser.
- `GEMINI_API_KEY` — the key from Google AI Studio for the Gemini API.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` separately for the frontend build. Never prefix the Gemini or Supabase secret key with `VITE_`. After changing Vercel variables, create a new deployment; existing deployments do not receive environment variable changes. The API routes report missing variable names, without values, in the response and Vercel Function Logs.

Tasks and courses use Postgres tables separately from Storage. File content is stored in the private buckets, with short-lived signed links for downloads.

## Build check

```powershell
npm run build
```
