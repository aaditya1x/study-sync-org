# Smart Study Sync — Project Feature Audit

**Audit type:** Static source and migration review  
**Scope:** `CampusFlow-Ready` React/Vite application, `api/`, `server/`, Supabase SQL files, environment-variable names, deployment files and project documentation.  
**Database access:** No live Supabase session was available. SQL below describes repository migrations and intended policy behavior only; it does not establish that any migration or policy is active in a deployed project.  
**Code changes:** None. This audit created this report only.

## 1. Executive summary

The repository contains a substantial React study workspace connected to Supabase Auth, Postgres and private Storage, plus four server API handlers. It includes email and Google authentication flows, degree/branch onboarding, course and material workflows, per-user tasks and chapter progress, PDF indexing and AI generation, and a Super Admin console. There is no separate router: the main app switches client-side panels by a selected navigation ID.

Static source evidence shows many implemented paths, but most depend on Supabase, Gemini, configured Storage buckets, and manually applied migrations. Those integrations cannot be called operational from this repository alone. A migration file or README assertion is not evidence of live database state.

Most significant findings:

- The student “Curriculum” page does not query `academic_units`, `academic_chapters`, or `academic_topics`. Its shared academic curriculum content is limited to fixed DCRUST links and shared courses/files. `ChapterTracker` is a separate per-user tracker.
- Course views are scoped in React to the selected branch. The selected academic cycle, year, and semester are not automatically applied to the visible course list. Those fields are optional and have manual filters. A local migration adds a restrictive database course-read policy, but its application is unverified.
- The Academic Hub allocation form permits empty degree and branch values even though the onboarding page requires both. The database profile columns are nullable. A user may therefore clear an allocation after onboarding from that form.
- Personal task mutations are stored per user in `localStorage` and synchronized to `user_app_data`. The sync implementation exists, but the status props passed by `App.jsx` do not match the prop names read by `TasksPanel`, so its cloud-sync status text is not shown.
- The AI feature is a prompt-and-response tool with summarize, explain, and quiz modes, plus PDF question answering. It is not a conversational chat: it has no message history or multi-turn thread.
- Super Admin operations have an authenticated server endpoint and role checks in source. Teacher branch checks and student ownership rules are described in local RLS migrations, but must be verified against the live project's policies and migration history.
- No test runner or test script is configured. `src/test-supabase.jsx` is an unreferenced connection-check component, not an automated test suite.

### Status definitions used

- **FULLY WORKING:** A self-contained client-side behavior and its local persistence/state path are present in source. This is not a claim of production runtime verification.
- **PARTIALLY WORKING:** A related implementation exists, but the named capability is incomplete or does not reach the relevant data model.
- **UI ONLY:** A screen can save/display configuration, but the application does not consume it to change behavior.
- **NOT IMPLEMENTED:** No user-facing implementation for that capability was found.
- **NEEDS TESTING:** Source and integration code exist, but an external service, live schema/policy, browser behavior, or role-specific runtime is required to verify it.

## 2. Complete feature inventory and status

There are **68 inventory entries** below. Rows distinguish a user-visible workflow from its supporting backend capability when those are not the same feature.

| # | Feature | Status | Evidence and limitations |
|---:|---|---|---|
| 1 | Email registration | NEEDS TESTING | `Login.jsx` calls Supabase `signUp`, validates name/email/password and requires a terms checkbox. Requires configured Supabase Auth and email settings. |
| 2 | Email/password sign-in | NEEDS TESTING | Calls `signInWithPassword`; runtime depends on Supabase Auth and confirmed account policy. |
| 3 | Google sign-in | NEEDS TESTING | Calls `signInWithOAuth({ provider: "google" })`; provider credentials and redirect allowlist are external. |
| 4 | Confirmation and resend | NEEDS TESTING | Verification state and `auth.resend` exist. Actual delivery/template behavior is external. |
| 5 | Forgot password and reset | NEEDS TESTING | `resetPasswordForEmail` and `updateUser({ password })` flows exist; email template and callback configuration are required. |
| 6 | Auth callback/session recovery | NEEDS TESTING | App handles callback code, recovery query/hash, session exchange and password recovery state. No live OAuth/recovery round-trip was tested. |
| 7 | Sign-out and token/session refresh | NEEDS TESTING | Sign-out and Supabase persistent/refresh-token options are wired; runtime/browser session behavior was not tested. |
| 8 | Account identity in the shell | NEEDS TESTING | Name is derived from Auth metadata/email and passed to the Navbar. No live Auth profile was available. |
| 9 | Edit personal name/email profile | NOT IMPLEMENTED | Settings supports photo and appearance, but no personal name/email editing form was found. |
| 10 | Profile picture upload, signed display and removal | NEEDS TESTING | Settings uploads to `profile-photos`, records `avatar_path` in Auth metadata, creates signed URLs and removes the old object. Requires bucket and Storage policies. |
| 11 | Required degree/branch onboarding | NEEDS TESTING | App queries `academic_profiles` after login and routes a missing/incomplete profile to `AcademicProfile`; saving upserts the user's profile. Requires catalog rows and applied RLS. |
| 12 | Degree options from academic catalog | NEEDS TESTING | Loads non-archived `academic_degrees`; actual options depend on live rows. |
| 13 | Branch options constrained to selected degree | NEEDS TESTING | Loads `academic_branches` and filters by `degree_id`; the composite FK in migrations also expresses the intended relationship. |
| 14 | Academic cycle, year and semester selection | NEEDS TESTING | Academic Hub exposes optional `academic_cycle_id`, `year_level`, and `semester`; these are not part of the required onboarding form. Needs schema/catalog/runtime verification. |
| 15 | Change academic profile | NEEDS TESTING | Settings has My Academic Profile for degree/branch; Academic Hub also saves cycle/year/semester. The Academic Hub fields are not required, so it can save a blank degree/branch after onboarding. |
| 16 | Main personalized dashboard | NEEDS TESTING | Dashboard is rendered after profile lookup and includes course/material/task panels. Its data depends on remote queries and local task state. |
| 17 | Dashboard statistics | NEEDS TESTING | Counts are derived from current courses, materials, tasks and completion state; correctness depends on their data loading. |
| 18 | Recent activity and quick actions | NEEDS TESTING | Activity is assembled client-side from materials, courses and tasks; quick actions navigate to existing panels. No browser interaction was tested. |
| 19 | In-app panel navigation | FULLY WORKING | Sidebar IDs update `active`; `App.jsx` renders the matching panel. This is client-side state navigation, not URL-addressable page routing. |
| 20 | Client-side workspace search | FULLY WORKING | Search builds results from loaded courses, materials and tasks and navigates to a selected result. It is not a server-wide search. |
| 21 | Student/personal course creation | NEEDS TESTING | `CourseLibrary` inserts into `courses` with the authenticated user as owner and can associate profile branch/cycle/year. Requires the expected columns/policies. |
| 22 | Course edit and delete | NEEDS TESTING | Owner checks guard UI mutations; Supabase update/delete queries use `owner_id`. Database constraints and cascades are migration-dependent. |
| 23 | Course list scoped to selected branch | NEEDS TESTING | App filters course state to owner-created courses plus the selected branch. The local `20261103_academic_profile_scoping.sql` adds restrictive RLS, but must be applied to provide server-side scope. |
| 24 | Course filtering by semester/year/cycle | NEEDS TESTING | Manual filters exist in CourseLibrary. Profile semester/year/cycle are not automatically selected as mandatory filters; all options initially show for the selected branch. |
| 25 | Personal chapters and topics | NEEDS TESTING | `ChapterTracker` creates/edits/deletes chapters and topics in `course_chapters`/`course_topics` for the current user. Requires the progress migration and RLS. |
| 26 | Chapter/topic completion progress | NEEDS TESTING | Topic completion toggles `is_completed`/`completed_at`; progress is aggregated into reports. Runtime persistence was not verified. |
| 27 | Super Admin degree/branch/cycle catalog management | NEEDS TESTING | `AcademicCatalogAdmin` performs CRUD against the catalog tables. SQL RLS restricts writes to Super Admin after the later RBAC migration. |
| 28 | Academic units/chapters/topics backend and Admin editing | NEEDS TESTING | AdminDashboard and `/api/admin` can create/list/archive these rows; migration policies permit Super Admin and assigned-branch teacher management. Teacher UI is absent (see #68). |
| 29 | Student browse of normalized academic curriculum | PARTIALLY WORKING | No student query of `academic_units`, `academic_chapters`, or `academic_topics` was found. The “Curriculum” page displays courses, shared files and external syllabus links instead. |
| 30 | Official syllabus links | PARTIALLY WORKING | `SyllabusLibrary.jsx` contains fixed DCRUST URLs/programme entries. Links are not loaded from Supabase, not derived from profile, and current external availability was not checked. |
| 31 | Study-material file upload | NEEDS TESTING | MaterialsPanel uploads files to `study-materials` and inserts metadata. Bucket, size, storage-path policy and metadata schema must match. |
| 32 | Link material to a course | NEEDS TESTING | Upload/edit workflow writes `study_materials.course_id`; a dedicated migration adds the relationship. Requires that migration and correct FK behavior. |
| 33 | Browse, preview and download materials | NEEDS TESTING | Loads metadata and creates 1-hour signed URLs; shared records may be read/opened according to policies. Requires private bucket policies and real objects. |
| 34 | Share/unshare a user's material | NEEDS TESTING | Owner-only update toggles `is_shared`; sharing visibility is policy-controlled. |
| 35 | Delete own material and file | NEEDS TESTING | Deletes owner metadata then removes the Storage object. If file cleanup fails, the UI reports that the DB row was already removed; an orphaned object may remain. |
| 36 | Dedicated notes editor/storage | NOT IMPLEMENTED | No note model/editor or notes-specific API was found. “Notes” wording refers to AI prompt input and material/library workflows. |
| 37 | Personal task create/edit/complete/delete | FULLY WORKING | Task mutations exist in TasksPanel and use `usePersistentState` with a per-user localStorage key. Cloud synchronization is a separate integration (#39). |
| 38 | Task filters, search and due dates | NEEDS TESTING | All/to-do/completed filters, text search, course association and overdue labels exist. Local date/browser behavior was not exercised. |
| 39 | Task cloud sync to `user_app_data` | NEEDS TESTING | App loads `data_key="tasks"` and upserts JSON by `(user_id,data_key)`; requires table, grants and owner policies. |
| 40 | Visible cloud-sync status in TasksPanel | PARTIALLY WORKING | App passes `taskSyncStatus`/`taskSyncError`; TasksPanel reads `syncStatus`/`syncError`. Sync can run, but its status label is not connected under those prop names. |
| 41 | Student academic assignment list | NEEDS TESTING | `AcademicAssignments` queries active `academic_assignments` by the visible course IDs. Requires the RBAC/content migration and applicable RLS. |
| 42 | Admin academic assignment create/archive | NEEDS TESTING | Admin form posts to `/api/admin`; API allowlists assignment fields and archives with `archived_at`. Requires server secret and migration. |
| 43 | Progress reports | NEEDS TESTING | Reports combine tasks, courses, material counts and personal chapter progress. Their source data and computations were not exercised in a browser. |
| 44 | Generate study output from pasted notes | NEEDS TESTING | AIStudyTools sends text to `/api/ai`; handler validates/authenticates and calls Gemini. Needs server environment, valid session, network and provider access. |
| 45 | AI summarize, explain and quiz modes | NEEDS TESTING | Three prompt modes are implemented in client and API. No model response was run. |
| 46 | Index text-based PDFs | NEEDS TESTING | `/api/index-book` verifies user-owned material, downloads private object, parses pages with `pdf2json`, chunks and stores text. Needs service secret, bucket, schema and Vercel/local API runtime. |
| 47 | Ask questions about an indexed PDF | NEEDS TESTING | `/api/ask-book` verifies own/shared material, selects lexical-match chunks and calls Gemini with page citations. No semantic embeddings are used; provider and DB behavior untested. |
| 48 | Multi-turn AI chat and conversation history | NOT IMPLEMENTED | The AI interface has one textarea and one response; it does not retain a message thread or send conversation history. |
| 49 | Super Admin dashboard overview | NEEDS TESTING | `/api/admin` aggregates Auth user count and DB metrics; requires active RBAC migration and server-only secret. |
| 50 | Admin user listing/search/pagination | NEEDS TESTING | Lists Auth users plus roles, academic profiles and suspension status; front-end filters and pages results. Requires privileged API configuration. |
| 51 | Role assignment | NEEDS TESTING | Super Admin can set student/teacher/Super Admin using API and `set_platform_user_role`; self-change and last-Super-Admin removal are guarded in SQL function. |
| 52 | Suspend and restore student | NEEDS TESTING | Admin API updates Auth ban and `platform_user_status`; active-user helper/policies are intended to block access. Partial failure between Auth and DB writes needs operational testing/recovery. |
| 53 | Assign teachers to branches | NEEDS TESTING | Super Admin UI posts `teacher_branch`; API validates teacher role and writes `academic_staff_branches`. Policies/functions use these assignments. |
| 54 | Admin course/subject create and archive | NEEDS TESTING | Admin API allowlists course fields and archives records; actual RLS/schema and report behavior need verification. |
| 55 | Admin academic curriculum content management | NEEDS TESTING | Admin UI supports units/chapters/topics list/create/archive; teacher access is not exposed in a teacher-facing panel. |
| 56 | Admin shared-resource sharing/archive | NEEDS TESTING | API only administers existing shared-resource rows for these operations; it does not provide a general file upload flow in the Admin endpoint. |
| 57 | Announcement creation, audience and archive | NEEDS TESTING | Admin forms/API support audience, publish timestamp and archive. Requires `academic_announcements` table/RLS. |
| 58 | Student/teacher announcement inbox or feed | NOT IMPLEMENTED | Migration has a published-announcement SELECT policy, but no frontend query or announcement display component was found. |
| 59 | Administrative audit-log viewing | NEEDS TESTING | Admin API lists audit rows; SQL has audit table, direct-mutation triggers and API audit writes. Active triggers/policies are unverified. |
| 60 | Store platform settings as JSON | NEEDS TESTING | Super Admin endpoint can upsert/list keys in `platform_settings`; requires migration and server configuration. |
| 61 | Apply platform settings to application behavior | UI ONLY | Settings can be stored and displayed, but no consumer of `platform_settings` was found in the client behavior. |
| 62 | Role/ownership/RLS enforcement | NEEDS TESTING | Local migrations define owner policies, active-user guards, Super Admin and assigned-teacher helpers. Live grants, permissive/restrictive policy composition and applied migration order are unknown. |
| 63 | Authenticated API authorization | NEEDS TESTING | AI/PDF handlers validate bearer tokens; Admin additionally checks `academic_staff.role === "super_admin"` and suspension. Needs deployed configuration/runtime testing. |
| 64 | Private Storage access and ownership | NEEDS TESTING | Migration files specify private buckets, owner-folder mutation and authenticated shared reads; actual bucket visibility/policies and legacy object ownership are unverified. |
| 65 | Permanent user/account deletion | NOT IMPLEMENTED | No user delete/purge control or server workflow exists. Admin documentation explicitly describes suspension/retention and says permanent deletion is not implemented. |
| 66 | Theme selection (light/dark/palettes/system) | NEEDS TESTING | ThemeContext persists the selected value and global tokens define palettes. Visual correctness and native-control behavior have not been tested in a browser. |
| 67 | Mobile/responsive layout and navigation drawer | NEEDS TESTING | CSS breakpoints and mobile sidebar overlay/drawer exist. Device/browser interaction was not exercised. |
| 68 | Teacher-facing workspace/content workflow | NOT IMPLEMENTED | Teachers can be provisioned and branch-assigned, and SQL grants assigned-branch data operations; the app only exposes AdminDashboard to `super_admin`. No teacher-specific course/curriculum/assignment management UI was found. |

### Inventory totals

| Status | Count |
|---|---:|
| FULLY WORKING (source-level client behavior) | 3 |
| PARTIALLY WORKING | 3 |
| UI ONLY | 1 |
| NOT IMPLEMENTED | 6 |
| NEEDS TESTING | 55 |
| **Total inventory entries** | **68** |

“Fully working” here means the described self-contained client behavior is implemented in source. No live production workflow is represented as verified.

## 3. Student features

- **Authentication and onboarding:** After a Supabase session, App reads the user's `academic_profiles` row. Missing degree/branch routes to the onboarding form. Degree and branch lists come from `academic_degrees`/`academic_branches`; the user row is upserted with `user_id`. Failure to read the profile is shown as an error rather than treated as a new profile.
- **Academic profile:** Settings exposes “My Academic Profile” for degree/branch. Academic Hub additionally exposes cycle, year and semester. Degree/branch can be cleared in Academic Hub because those selects are not required; that conflicts with the onboarding gate's intended invariant.
- **Courses/subjects:** CourseLibrary reads `courses`, supports personal create/edit/delete, search and manual semester/branch/cycle/year filters. App's visible course list is scoped by selected branch plus the user's own courses. Profile cycle/year/semester are not automatically applied.
- **Curriculum and progress:** ChapterTracker uses `course_chapters` and `course_topics` as personal progress rows. This should not be confused with Admin-managed `academic_units`/`academic_chapters`/`academic_topics`; the student curriculum screen does not load those academic tables.
- **Materials:** Students upload files to the shared library; metadata records include owner, storage path, optional course, sharing/index flags and file metadata. Preview/download uses short-lived signed URLs. UI deletion removes the row then the user's object.
- **Tasks and assignments:** Personal tasks are localStorage-backed and synchronized as JSON in `user_app_data`. A separate academic-assignment component queries assignments for currently visible course IDs. Personal tasks are not the same entity/table as academic assignments.
- **Reports:** ProgressReport computes task completion and per-course personal chapter progress. It is not an institutional gradebook or an academic transcript.
- **Resources:** SyllabusLibrary includes shared files/courses and external DCRUST programme links. Those fixed links are not personalized from the academic profile.

## 4. Teacher features

The database design includes `academic_staff` roles, `academic_staff_branches` assignments, helper functions such as `is_assigned_teacher` and policies that allow assigned teachers to manage branch-associated courses/curriculum/assignments while preventing catalog/role administration. These are migration-defined capabilities, not proof of production enforcement.

The UI supports Super Admins assigning/removing teacher branches. In the main app, role lookup only adds the Admin panel for Super Admin. Teachers otherwise receive the student navigation, and no teacher-specific editor/review workflow is present. Thus the assignment and backend policy code exists, but a usable teacher workflow is not implemented.

## 5. Admin and Super Admin features

AdminDashboard has Overview, User Management, Academic Catalog, Courses & Subjects, Units/Topics, Assignments, Shared Resources, Teacher Assignments, Announcements, Security/Audit and Platform Settings panels. `adminRequest` posts a bearer token to `/api/admin`.

The API verifies the token with Supabase Auth, checks the caller's staff role using a server-side client and rejects non-Super-Admins. It uses an allowlist of entities/fields, and the SQL role-change RPC checks the actor, prevents self-role changes, serializes role changes and protects the last Super Admin. Student suspension is restricted to student accounts and paired with an Auth ban and status-table row.

Most Admin operations create/archive/update rather than permanently delete. Catalog removal in the direct AdminCatalog UI is a database `delete` that is expected to fail when foreign-key references exist. There is no permanent account deletion action. Announcements can be authored, but no app screen displays them to recipients. Platform settings are persisted as JSON but do not change application behavior.

All of these operations still need staging verification: migrations may be unapplied, and server environment variables may be missing.

## 6. AI capabilities

### Notes mode

The user pastes text into one textarea and selects Summarize, Explain or Quiz. `/api/ai` validates mode and input, requires an authenticated user, checks active-account status, then sends a prompt to Gemini. It returns one text response. Notes are not stored in a chat history by the frontend.

### PDF mode

MaterialsPanel can call `/api/index-book` for PDFs. Server code verifies ownership, downloads from private Storage, rejects files over 50 MiB, extracts page text with `pdf2json`, chunks it and writes `book_chunks`. Image-only/scanned PDFs fail due to missing OCR. `/api/ask-book` searches chunks using lexical term matches, returns up to eight excerpts to Gemini and asks it to cite pages. The local SQL setup also defines `search_book_chunks`, but the endpoint uses its own JavaScript search instead of that RPC.

This is a prompt/response study tool, not an interactive multi-turn chat or a general model with course/profile grounding. Provider model/key validity, rate limits and output quality are runtime concerns.

## 7. Backend and database architecture

### Technology and client architecture

- React 18 with Vite 6, JavaScript JSX, CSS Modules and global CSS tokens.
- `src/index.jsx` mounts `App` inside `ThemeProvider` and imports global styles.
- `App.jsx` owns top-level panel selection, auth session, academic profile, task/course/material state, role, dashboard statistics and toast state.
- Reusable UI lives under `src/components/`; local persistence is in `src/hooks/usePersistentState.js`.
- Supabase client creation is centralized in `src/lib/supabase.js`. Browser code uses the publishable/anon key only.
- Admin API requests are wrapped by `src/lib/adminApi.js`.
- API handlers are `api/ai.js`, `api/index-book.js`, `api/ask-book.js`, and `api/admin.js`; shared server helpers live in `server/`.
- Local Vite middleware maps the API paths in `vite.config.js`. Production expects the Vercel `api/` functions. `vercel.json` includes the `/auth/*` SPA rewrite.

### Tables and relationships referenced by app/migrations

This list is based on query strings and checked-in SQL, not a live introspection:

- Existing/base application: `courses`, `study_materials`, `user_app_data`, `book_chunks`.
- Course/material relation: `study_materials.course_id` references `courses.id` (the relationship migration provides preflighted FK behavior); course academic allocation adds `branch_id`, `academic_cycle_id`, `year_level` and uses existing `semester`.
- Academic allocation: `academic_degrees` → `academic_branches`; `academic_profiles` references Auth user, degree, branch/degree pair, academic cycle, optional year/semester.
- Personal progress: `course_chapters` references course and Auth user; `course_topics` references chapter and Auth user. Both are intended to cascade on parent deletion.
- Shared academic curriculum/assignments: `academic_units.course_id` → course; `academic_chapters.unit_id` → unit; `academic_topics.chapter_id` → chapter; `academic_assignments.course_id` → course.
- Staff/RBAC: `academic_staff.user_id` → Auth user; `academic_staff_branches` joins staff to branches; `platform_user_status` tracks suspension.
- Platform administration: `platform_audit_logs`, `academic_announcements`, `platform_settings`.
- Storage buckets named in code/docs: `study-materials` and `profile-photos`; expected private with 50 MiB and 2 MiB limits respectively.
- `profiles` appears in the read-only audit query's inspection candidates, but the app's profile-photo path uses Auth `user_metadata.avatar_path`; no client query of `public.profiles` was found.

### Environment variable names

Names observed in `.env.example`, docs and source (no values reproduced):

- Browser/build: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`.
- Server: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`.

The secret/service-role key is read in server files only in the checked-in source; it is not referenced as a `VITE_*` variable. Deployment configuration must still be inspected before asserting that no secret has been misconfigured outside the repository.

### SQL files and migration state

Migrations cover existing-project repair and Storage policies, course/material relationship, shared study materials, personal chapter progress, academic catalog/profile, hardening, Super Admin/RBAC and `20261103_academic_profile_scoping.sql`. `supabase-setup.sql` is a bootstrap/legacy setup; README explicitly warns not to run it against an existing project. There is also a relationship rollback SQL file.

The RBAC operations guide says migrations are reviewed/applied manually. The newest course-scope migration itself says apply after the RBAC migration and is deliberately unapplied. No production SQL was run and no migration-history table was queried. Never treat the policies below as active until confirmed in the target project's `pg_policies`, grants, bucket configuration and schema.

## 8. Security and permissions audit

### Positive implementation evidence

- Browser Supabase initialization uses the publishable/anon key; privileged endpoint clients use a server-side secret variable.
- `/api/admin` authenticates the incoming bearer token and checks Super Admin status and suspension on every privileged request.
- API admin entity/field allowlists constrain writes. Role assignment is delegated to a service-role-only RPC.
- AI/PDF routes authenticate the user and call `is_current_user_active`; PDF indexing verifies material ownership before using the service client to download/index.
- Migrations enable RLS on academic, profile, progress, staff and platform tables; define user-owned profile/task/progress policies; define private Storage buckets/owner-folder policies; and define teacher branch checks.
- No `disable row level security` statement was found in the checked-in migrations.
- SQL audit helper is read-only and reports schema, policy, grants, bucket and object ownership metadata without changing state.

### Caveats and risks to verify

1. **Deployment state is unknown.** Verify actual migration application order, role grants, table RLS flags, policies and Storage bucket settings. Especially verify `20261103_academic_profile_scoping.sql`; without its restrictive course read policy, a previous shared-course SELECT policy in older SQL is broad to authenticated users.
2. **Client filtering is not authorization.** Branch filtering in `App.jsx` improves display but cannot secure direct REST calls. The restrictive RLS migration must be active and tested with student, assigned teacher, unassigned teacher and Super Admin identities.
3. **Student academic filtering is incomplete.** Server/client scope is branch-level; selected cycle/year/semester are optional/manual and are not automatically enforced as profile filters.
4. **Suspension is a multi-system operation.** The API changes Auth ban and DB status separately; failures between those operations can leave one side changed. Exercise and document recovery for partial failure.
5. **Storage/file deletion is not atomic with metadata deletion.** Material deletion removes metadata then object. A failed Storage cleanup can leave an orphaned object.
6. **Teacher policy code lacks a teacher UI.** Direct database protections and admin branch assignment need role-specific probes; the current UI does not expose teacher authoring workflows.
7. **No live secret/configuration scan was possible.** The repository source does not show a frontend service-role key, but deployment variables and hosting logs were not inspected.
8. **External service limits and abuse controls need review.** AI endpoints enforce input sizes and timeouts but the source shows no per-user rate limiter or spend quota.

## 9. Actual user journeys and gaps

### A. New student: registration → login → onboarding → dashboard

1. Signup sends email/password/name to Supabase Auth and requests a confirmation redirect.
2. When Auth returns a session (or after callback exchange), App loads academic profile.
3. Missing degree/branch opens onboarding. Degree/branch choices come from the existing catalog.
4. Save upserts the Auth user's academic profile; App then renders the dashboard.

**Gap/test:** Email-confirmation behavior depends on Auth settings. Verify signup with confirmation required and disabled, plus Google first-login. Confirm profile read/write RLS and the existing catalog. Academic Hub can later clear required fields.

### B. Existing student: login → dashboard → courses → materials → tasks → progress

1. Auth session is established and profile is loaded; completed degree/branch opens the shell.
2. Dashboard course/material children load Supabase rows; tasks load from `user_app_data` with localStorage fallback.
3. Courses page has personal academic allocation, courses, manual filters and personal chapter/topic progress.
4. Materials page uploads/downloads shared files and associates optional courses.
5. Tasks page mutates local tasks; sync effect attempts to upsert to Supabase.
6. Progress report derives task/chapter progress.

**Gaps/test:** Course profile matching is not automatic for cycle/year/semester. Confirm owner vs shared rows, Storage access, material-course FK, chapter/topic policies, cloud task merge/save, and task-sync indicator prop mismatch. “Curriculum” is not a viewer for the Admin academic unit/topic tree.

### C. AI Study Tools → prompt → response

1. User selects notes or PDF source and a summarize/explain/quiz mode.
2. Notes go to `/api/ai`; PDF questions go to `/api/ask-book` after a PDF has been indexed.
3. Server validates bearer token and active status, calls Gemini and returns one response.

**Gap/test:** Server env, auth/RPC, Gemini model/key and response handling need integration tests. Scanned PDF OCR and chat history are absent. There is no conversation thread.

### D. Super Admin → dashboard → users/academic/content

1. App reads the caller's `academic_staff.role` and shows Admin only for `super_admin`.
2. Admin UI calls `/api/admin`; server checks Auth token, role and suspension.
3. API lists users/content and handles role, suspension, catalog/content changes, archive, branch assignments, announcements and settings; SQL function/triggers/policies provide additional checks/logging.

**Gap/test:** Requires applied RBAC migrations, provisioned Super Admin, server URL/publishable/secret keys and matching schema. Verify self-change and last-admin protection, suspension partial failures, archive visibility and audit entries. No permanent user deletion exists.

### E. Teacher workflow

1. Super Admin can set a user to teacher and assign branches.
2. SQL helper/policy code intends to let that teacher access assigned-branch course/curriculum/assignment rows only.
3. Main app does not expose teacher-specific content management; Admin route is Super Admin-only.

**Result:** provisioning and branch assignment are implemented in source; teacher workflow is incomplete at the application layer and requires direct RLS testing.

## 10. Mobile and UI/UX assessment

- There is a responsive mobile navigation drawer with overlay/escape close behavior, plus CSS breakpoints across major panels.
- ThemeContext supports light, dark, system and named palettes, persisted in localStorage. A prior theme-color pass centralized many tokens and improved AI textarea/focus states, but this static audit did not visually evaluate every palette/component combination.
- No automated accessibility, browser visual regression, reduced-motion, keyboard-only or screen-reader tests are configured. Some interface elements are dense, and the task sync state issue affects visible feedback.
- Mobile layout and theme correctness remain **NEEDS TESTING** on real viewport sizes and at least one browser with dark/light/system preference changes.

## 11. Bugs, incomplete items and missing integrations

### Confirmed from source

- TasksPanel receives `taskSyncStatus`/`taskSyncError` through the shared prop object, but reads `syncStatus`/`syncError`; visible sync status/error is therefore not wired.
- Academic Hub allocation selectors are not required and can upsert null degree/branch after the onboarding gate.
- No academic-table reads for normalized student curriculum tables were found; current student curriculum/syllabus experience is different from the Admin academic curriculum feature.
- Academic profile cycle/year/semester do not automatically scope course listings.
- Admin announcement UI/API exists, but there is no recipient-facing announcement component/query.
- Platform settings UI/API stores JSON but client code does not consume those settings.
- Teacher-specific content workspace is absent.
- `src/test-supabase.jsx` is not imported by App and is not an automated test.

### External/runtime unknowns

- Whether migrations match the live schema; whether RLS/grants compose correctly; whether buckets exist/private policies are correct.
- Whether Supabase Auth callbacks, confirmation templates and Google provider settings work in deployed domains.
- Whether Gemini configuration/model access, API timeout/rate behavior and PDF parsing work in the deployed Node runtime.
- Whether Vercel environment variables and functions are configured and whether deployment root includes `api/`.

## 12. Missing features

- Editable personal identity fields (such as name/email) in Settings.
- Dedicated notes editor and persistent note entity.
- A student-facing normalized academic curriculum browser.
- Recipient-facing announcements inbox/feed.
- Teacher course/curriculum/assignment workspace.
- Multi-turn AI chat and saved conversations.
- Permanent user deletion/purge/retention workflow.
- Product behavior that consumes platform settings.
- Automatically enforced profile cycle/year/semester filtering in student course views.
- Automated test suite and end-to-end role/workflow tests.

## 13. Recommended improvements

1. Fix the `TasksPanel` sync prop names and make cloud/local sync status explicit; test offline and conflict behavior.
2. Require degree and branch in every profile save path and add a database constraint only after reviewing existing null rows and migration compatibility.
3. Add profile-aware default course predicates for cycle/year/semester where those fields are set, and keep server RLS authoritative.
4. Build student curriculum queries against the existing unit/chapter/topic hierarchy and ensure selected-branch visibility; keep per-user progress separate.
5. Add a teacher-facing interface using assigned branch data and test that unauthorized branch IDs are rejected by direct API/database calls.
6. Add announcement delivery UI and decide which platform settings keys are supported/consumed.
7. Add automated component/API tests and non-production Supabase integration tests; do not rely on `test-supabase.jsx` as a suite.
8. Harden operational consistency for Auth ban/status changes and material metadata/object deletion, with retries or repair jobs.
9. Add AI rate limits/quotas, structured observability and PDF reindex rollback/atomicity strategy.
10. Define an institution-approved retention policy before implementing account purge.

## 14. Priority roadmap

### P0 — Validate security and core data flows

- Run the read-only audit SQL in the intended non-production Supabase project and compare exact columns, FKs, RLS, grants, Storage policies and bucket limits.
- Apply only reviewed migrations in dependency order in staging; explicitly verify `20261103_academic_profile_scoping.sql`.
- Test student, teacher assigned/unassigned and Super Admin data access by both UI and direct REST requests.
- Fix required degree/branch clearing and task-sync status wiring.
- Test Auth callback, task sync, file ownership/deletion, PDF indexing and suspension/restore.

### P1 — Complete academic workflows

- Connect the student Curriculum page to academic unit/chapter/topic tables.
- Apply profile cycle/year/semester defaults and server-side constraints consistently.
- Build teacher workflows within assigned branches.
- Add published announcements to the appropriate user surfaces.

### P2 — Complete product capabilities and operations

- Decide whether dedicated notes and conversational AI are in scope; implement storage/history only with clear ownership and privacy handling.
- Give platform settings a typed schema and actual application consumers, or remove unsupported settings UI.
- Define account retention/purge workflow, audit requirements and recovery path.
- Add browser/viewport/accessibility regression checks and API/integration test coverage.

## 15. Audit execution and final counts

- **Automated tests run:** None. The package scripts include `dev`, `build` and `preview`, but no `test`/lint/e2e command. This was a documentation-only static audit.
- **Live Supabase or Gemini calls:** None.
- **Production migrations applied:** None.
- **Total features discovered:** 68 inventory entries.
- **FULLY WORKING:** 3 (self-contained client-side navigation, loaded-data search and local task CRUD/persistence, by source inspection only).
- **PARTIALLY WORKING:** 3.
- **UI ONLY:** 1.
- **NOT IMPLEMENTED:** 6.
- **NEEDS TESTING:** 55.

No passwords, tokens, API-key values or other secret values are included in this report.
