# CampusFlow / Study Sync — Complete Technical Audit

**Audit date:** 2026-11-01  
**Scope:** Static source, local migrations, package scripts, tests, and a local production build.  
**Production boundary:** No production Supabase connection, data, policies, secrets, or settings were queried or changed. Local migration files describe intended schema and policies; their application status and production contents are **NOT VERIFIED**.

## Executive summary

CampusFlow is a React/Vite single-page application with Supabase Auth, Postgres, private Storage, Vercel-style Node API functions, and Gemini-backed AI. It has substantial working source for student course/material workflows, a separate floating assistant and PDF Study Tools assistant, PYQs, mock tests, syllabus management, admin workflows, and user settings. The local test suite contains 95 tests and all passed. `npm run build` completed successfully, with a warning about large JavaScript chunks.

This is a source audit, not a deployment certification. The project has no live database evidence in this audit, and several features depend on migrations, RPCs, buckets, Auth settings, and environment variables that may or may not be present in a deployed Supabase project.

High-priority findings:

1. **Contact Us is UI-only.** `src/components/ContactUs/ContactUs.jsx` prevents submission and shows a success message but never calls the existing `/api/contact`. The message is not delivered despite UI copy implying secure submission. `api/contact.js` and `submit_contact_message` exist, but are disconnected from the form.
2. **Mock Test code expects a course column absent from local schema definitions.** `src/components/AdminDashboard/MockTestManagement.jsx` and `api/learning.js` select `courses.degree_id`. `supabase-migrations/20261031_phase1_academic_hub.sql` adds `branch_id`, `academic_cycle_id`, and `year_level` to `courses`, but not `degree_id`. The generator also reads `course.degree_id`. This is a static source/migration mismatch; whether production has an extra column is **NOT VERIFIED**.
3. **Local development omits two API routes.** `vite.config.js` maps `/api/ai`, `/api/admin`, `/api/learning`, `/api/index-book`, and `/api/ask-book`, but not `/api/contact` or `/api/syllabus-import`. The latter is used by the syllabus UI. Vercel-style `/api` files exist, but local development does not route those two endpoints through the Vite plugin.
4. **Teacher management controls are largely unavailable in the UI.** Secure server-side teacher approval/branch/suspension functions exist, but current admin screens present limited or disabled actions; teacher accounts do not receive a dedicated workspace in `src/App.jsx`.
5. **Production schema, RLS, Storage, function, key, and deployment configuration are unverified.** The local migrations are not proof that production has applied them.

## Status definitions

- **IMPLEMENTED:** Relevant application source and/or tested behavior exists locally. External service availability and production deployment remain unverified.
- **PARTIALLY IMPLEMENTED:** A meaningful workflow exists but has gaps, constraints, or disconnected pieces.
- **UI ONLY:** A visible interface exists without the required end-to-end backend behavior.
- **BACKEND ONLY:** An endpoint or server workflow exists without a complete user-facing flow.
- **NOT IMPLEMENTED:** No applicable implementation was found in the inspected source.
- **NOT VERIFIED:** Requires production database, provider, hosting, or runtime evidence not available within this read-only audit.

## 1. Architecture and project structure

### Stack and dependencies

From `package.json`:

- React 18.3 and React DOM; Vite 6 with `@vitejs/plugin-react`.
- `@supabase/supabase-js` for browser and server Supabase clients.
- Gemini integration is implemented with server-side HTTP calls (see `server/aiAssistant.js` and `api/ai.js` / `api/ask-book.js`); there is no second AI provider in the inspected request paths.
- `pdf2json` for server-side PDF text extraction.
- `react-markdown`, `remark-gfm`, `remark-breaks`, `remark-math`, `rehype-katex`, and KaTeX for AI response formatting and math.
- Mermaid 12 for diagrams.
- `lucide-react` for icons. CSS Modules and global CSS provide styling.
- Test command is `node --test`; build is `vite build`. Package engine declares Node `>=22.23.2`.

No package was installed during this audit.

### Entry points and navigation

- `index.html` loads `src/index.jsx`.
- `src/index.jsx` mounts the React application with theme context.
- `src/App.jsx` owns authentication/session state, role and academic-profile loading, active workspace section, navigation, page-derived AI context, and shared state passed to feature components. It is a single-page application with section state rather than a client-side router. Public URL path checks cover landing, login/signup, auth callback, terms, privacy, and contact.
- `src/components/AppShell/AppShell.jsx`, `Sidebar`, and `Navbar` provide the authenticated shell and responsive navigation.
- `src/context/ThemeContext.jsx`, `src/styles/global.css`, and CSS Modules implement theme/layout.
- `src/lib/` contains Supabase setup, auth redirects/callback handling, request construction, access checks, academic profile validation, course visibility, AI context/navigation, and API clients.
- `api/` contains serverless request handlers. `server/` contains shared server-side provider, retrieval, authorization, PDF, diagnostics, and test-generation helpers.
- `supabase-migrations/` contains local SQL proposals/history. This audit did not execute SQL.
- `tests/` contains Node built-in tests for helpers, migration contracts, rendering configuration, validation, and authorization behavior.

### API routes and local development

Serverless handlers found: `/api/admin` (`api/admin.js`), `/api/ai` (`api/ai.js`), `/api/ask-book` (`api/ask-book.js`), `/api/contact` (`api/contact.js`), `/api/index-book` (`api/index-book.js`), `/api/learning` (`api/learning.js`), and `/api/syllabus-import` (`api/syllabus-import.js`).

`vite.config.js` adds a local middleware for only `/api/ai`, `/api/admin`, `/api/learning`, `/api/index-book`, and `/api/ask-book`. It reads POST bodies, enforces a 256 KiB limit, parses with `parseAIRequestBody`, and dispatches to the handler. Its generic request parse helper is used for all these mapped POST routes. `/api/contact` and `/api/syllabus-import` are not in this route map, so their frontend requests do not reach the corresponding local functions under this plugin. Vercel-style deployment discovers the `api/` functions separately; production hosting behavior was not exercised.

`vercel.json` rewrites selected public paths (`/auth/*`, `/terms`, `/privacy`, `/contact`, `/login`, `/signup`) to `index.html`. It does not establish Supabase function availability or migration state. README deployment instructions and route descriptions do not fully match the current source routing; treat documentation as needing refresh.

### Supabase configuration and deployment

`src/lib/supabase.js` initializes the browser client from `VITE_SUPABASE_URL` and the publishable/anon key. The client code should contain only the public key. Server modules use server environment variables and the secret/service-role key for privileged operations. Never provide a service-role key as a `VITE_` variable. Local docs mention `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, and optional `GEMINI_WEB_GROUNDING_FREE_TIER_ONLY`; actual deployment values and key rotation status are **NOT VERIFIED**. No `.env` values were read.

The apparent target is Vercel serverless APIs plus a static Vite build and Supabase Auth/Postgres/Storage. This is based on the `api/` layout and `vercel.json`; actual hosting provider/project settings, domains, redirects, and secrets are **NOT VERIFIED**.

## 2. Complete feature inventory and user workflows

### Authentication, registration, recovery, and profile

| Feature | Status | Workflow and implementation |
|---|---|---|
| Email/password sign-in and registration | IMPLEMENTED | `src/components/Login/Login.jsx` and `src/App.jsx` call Supabase Auth. Signup/recovery redirects are built by `src/lib/authRedirect.js`; PKCE callback handling is in `src/lib/authCallback.js`. Tests cover redirect and callback decisions, not a live provider round trip. |
| Email verification and password recovery | PARTIALLY IMPLEMENTED | Auth redirects/callbacks and recovery flow exist; delivery templates, SMTP, confirmation requirements, and deployed redirect allow-list are Supabase project settings and **NOT VERIFIED**. |
| Google OAuth | PARTIALLY IMPLEMENTED | The auth UI initiates Supabase OAuth (inspect `Login.jsx`); Google provider credentials, callback URL configuration, and real sign-in are external and **NOT VERIFIED**. |
| Academic profile and allocation | IMPLEMENTED | `AcademicProfile.jsx` and `AcademicHub.jsx` load degree/branch catalogs and upsert the signed-in user's own `academic_profiles` row. `workspaceAccess.js` gates student entry until degree and branch are set; Super Admin bypasses that gate. Cycle/year/semester are also represented. RLS/runtime deployment is **NOT VERIFIED**. |
| Profile/contact identity edits | PARTIALLY IMPLEMENTED | Academic allocation and profile-photo controls exist. There is no general UI for changing Auth email or a complete personal-information profile in the inspected settings screens. |

### Academic workspace and learning content

| Feature | Status | Workflow and implementation |
|---|---|---|
| Dashboard | IMPLEMENTED | `src/App.jsx` composes dashboard cards/summary from loaded courses, tasks, materials, and progress state. Much summary data is application-derived rather than a separate analytics service. |
| Academic Hub/catalog | IMPLEMENTED | `AcademicHub.jsx` manages a user's allocation; `AcademicCatalogAdmin.jsx` exposes academic catalogs to Super Admin. Backend and policies are defined across `api/admin.js` and local migrations. Production schema and policies are **NOT VERIFIED**. |
| Courses/subjects | IMPLEMENTED | `CourseLibrary.jsx` lists, filters, creates, edits, archives/deletes course records according to role and course scope. `src/lib/courseVisibility.js` supports direct branch and shared branch mappings; `api/admin.js` and SQL/RLS provide corresponding controls. Branch mapping depends on migration `20261108_shared_subject_branch_visibility.sql`; actual application is **NOT VERIFIED**. |
| Units, chapters, topics, syllabus | IMPLEMENTED | `SyllabusLibrary.jsx` shows `academic_units`, `academic_chapters`, `academic_topics`, and per-user `academic_topic_progress`. Admins manage syllabus outline; student completion is personal. Syllabus-import API can parse an uploaded PDF into pending review data and Super Admin can publish. PDF parsing is text-based (no OCR); parsing output requires review. |
| Official syllabus sources | PARTIALLY IMPLEMENTED | `academic_syllabus_sources`/`academic-syllabi` support verified source documents for question generation. The source document is private and has Super Admin management. Any external official curriculum links or complete source verification are not equivalent to an authoritative live integration. Migration `20261109_academic_syllabus_import.sql` is a local dependency; applied state is **NOT VERIFIED**. |
| Study materials | IMPLEMENTED | `MaterialsPanel.jsx` supports upload, listing, preview/download, metadata edits/deletion, course association, and explicit sharing. `fileValidation.js` checks supported file types and file signatures; Storage is expected to be private `study-materials` with signed URLs. Sharing also depends on course/branch visibility and SQL policies. Live bucket configuration/RLS is **NOT VERIFIED**. |
| Materials sharing and visibility | PARTIALLY IMPLEMENTED | Owner-controlled sharing and branch/course scope are present. Local migrations define policies. No production proof establishes which policies are currently active. Incorrect/missing local migration order can make browser queries fail. |
| PDF indexing | IMPLEMENTED | `MaterialsPanel.jsx` calls `/api/index-book`. `api/index-book.js` checks authentication/ownership and storage path, downloads the private PDF server-side, verifies file signature/size, extracts text with `pdf2json`, splits it into chunks, stores `book_chunks`, and updates index status. Scanned image PDFs are not OCRed. Chunk replacement is not a single transaction, so interruption during re-indexing may leave incomplete indexing. |
| Indexed PDF search/retrieval | IMPLEMENTED | `IndexedDocumentPicker.jsx`, `src/lib/indexedPdfDocuments.js`, `server/documentRetrieval.js`, and `server/aiAssistant.js` list authorized indexed documents and retrieve owner/path-scoped chunks. Search is lexical/term matching rather than vector embedding retrieval. |
| Tasks | PARTIALLY IMPLEMENTED | `TasksPanel.jsx` supports task CRUD and completion. `src/App.jsx` stores per-user task state locally and syncs through `user_app_data`; this is not a dedicated task table. There is a prop mismatch: App passes `taskSyncStatus`/`taskSyncError` in shared props, while `TasksPanel` declares `syncStatus`/`syncError`. Unless a wrapper remaps them, the synchronization status/error indicator receives defaults and may not show the actual state. |
| Assignments | IMPLEMENTED | `AcademicAssignments.jsx` reads course-scoped `academic_assignments`; Super Admin/admin management uses `/api/admin`. Teacher/student access depends on policies and role scope from local migrations. Runtime policy status is **NOT VERIFIED**. |
| Announcements | PARTIALLY IMPLEMENTED | Admin-side creation/management exists in `api/admin.js` and admin dashboard. A complete student announcement inbox/acknowledgment workflow was not found. |
| Progress tracking/report | PARTIALLY IMPLEMENTED | `ChapterTracker.jsx` records personal course chapter/topic completion; `ProgressReport.jsx` summarizes tasks, courses, course topics, and materials. It is a study activity report, not a gradebook or verified assessment-grade system. Academic topic completion additionally uses `academic_topic_progress`. |
| Contact Us | UI ONLY (submission) / BACKEND ONLY (endpoint) | `ContactUs.jsx` currently calls `preventDefault()` and displays a success-style Hinglish message without calling the API. `api/contact.js` validates public submissions and calls `submit_contact_message` with rate limiting expected from migration 06; `learning.js` exposes Super Admin inbox/status actions. The present form does not deliver messages. The API is also absent from the local Vite route table. |

### Previous Year Questions (PYQs)

| Feature | Status | Workflow and implementation |
|---|---|---|
| PYQ list and filters | IMPLEMENTED (source) / NOT VERIFIED (live access) | `PreviousYearQuestions.jsx` reads paper metadata from `previous_year_papers`; filter values for year, semester, course/unit and search are applied in the client. `All` avoids a selected-value constraint in the UI. Student visibility is ultimately controlled by RLS. |
| Super Admin upload | IMPLEMENTED (source) | UI requires Super Admin and captures PDF plus degree/branch/cycle/course/semester/year/unit metadata. It uploads to private `previous-year-papers`, inserts the row, and exposes verification/publication/archive/delete controls. Uploaded record values and actual bucket/policies are **NOT VERIFIED**. |
| Student eligibility and private file download | PARTIALLY IMPLEMENTED | Local migrations define verified+published and academic-allocation read guards for metadata and private Storage. Branch mapping variation is handled by migration 08 and an additional targeted migration 11 in the repository. The migration 11 policy file exists locally but is not evidence of application. Storage access is distinct from row visibility and uses signed/private access. Do not infer production access from frontend behavior. |
| PYQ provenance | IMPLEMENTED | PYQs are represented separately from generated practice questions and mock tests. The feature does not itself verify correctness of a paper beyond admin verification state. |

### Mock Tests and question bank

| Feature | Status | Workflow and implementation |
|---|---|---|
| Student test listing | IMPLEMENTED (source) / NOT VERIFIED (schema) | `MockTests.jsx` calls `src/lib/learningApi.js` to `/api/learning`. Server checks identity/profile and allocation, then lists published tests. Exact functionality depends on migrations `20261106` and `20261110` (local definitions only). |
| Test attempts, timer, answers, scoring | IMPLEMENTED (source) / NOT VERIFIED (RPC) | `MockTests.jsx` starts, saves, and submits attempts through `api/learning.js` and `server/learningTools.js`; SQL RPCs keep keys/scoring server-side. Backend validates attempt ownership and submission, and result data should only be returned to its owner. Exact installed function/schema status is unknown. |
| Super Admin question bank and test builder | PARTIALLY IMPLEMENTED | `MockTestManagement.jsx` provides question, generator, review/approval, test config, published tests, and results views. Server admin operations are checked in `api/learning.js`. There is a local schema mismatch around `courses.degree_id` (see findings). |
| AI question generation | PARTIALLY IMPLEMENTED | `server/mockTestGenerator.js` and `api/learning.js` call the existing Gemini integration with selected course/unit/topic and verified syllabus source text. Generated questions remain drafts and are not verified/published automatically. Admin review is required. If source content is missing, generation should not assert verified sourcing. |
| Analytics | PARTIALLY IMPLEMENTED | `api/learning.js` aggregates attempts/scores and results for admin. Completeness and query performance depend on table indexes and production data; live analytics behavior is **NOT VERIFIED**. |
| Tests and answers security | PARTIALLY IMPLEMENTED / NOT VERIFIED | Source and migration tests verify server action scoping and key omission from student listing. Actual RLS, RPC grants, and DB state are **NOT VERIFIED**. Any missing function or migration can produce endpoint errors. |

### AI experiences

| Feature | Status | Workflow and implementation |
|---|---|---|
| Floating Ask AI | IMPLEMENTED | `FloatingAIAssistant.jsx` is mounted in authenticated `App.jsx` for the workspace. It has no PDF picker. It submits the conversation and page context to `/api/ai`; it can offer navigation to known sections through `src/lib/aiNavigation.js`. It does not execute data-changing actions. |
| Current page and authorized user context | PARTIALLY IMPLEMENTED | `src/lib/aiPageContext.js` and `App.jsx` build bounded summaries from the data already visible/loaded in the user's session. This is not arbitrary access to all application tables. User-specific authorization depends on frontend queries/RLS and server validation. It does not supply every feature's complete underlying data. |
| Dedicated AI Study Tools | IMPLEMENTED | `AIStudyTools.jsx` is a separate section. It offers general AI when no PDF is selected, plus indexed PDF selection/search, single/multiple document Q&A, summarization, explanation, and quiz actions. PDF requests go through `/api/ask-book`; general requests go through `/api/ai`. |
| Gemini model and provider | IMPLEMENTED (source) / NOT VERIFIED (runtime) | `server/aiAssistant.js` makes server-side calls to Gemini using `GEMINI_API_KEY`. The source uses Gemini models including `gemini-3.5-flash-lite` for normal response generation and `gemini-2.5-flash-lite` for optional grounded search. Model availability, API key validity, region, quotas, and whether provider names/models remain accepted are external and **NOT VERIFIED**. No alternate provider or paid fallback was found in the inspected code. |
| PDF context and privacy | IMPLEMENTED (source) / NOT VERIFIED (RLS) | `api/ask-book.js` and `api/ai.js` verify the bearer user and indexed document rows through an authenticated Supabase client; privileged chunk reads are constrained by user owner and storage path. Unauthorized document paths fail closed. PDF content is sent to Gemini only after retrieval authorization. This static design does not verify deployed policies or key handling. |
| General AI retrieval | PARTIALLY IMPLEMENTED | `/api/ai` can discover a bounded number of the authenticated user's own indexed PDFs for relevant chat retrieval. Retrieval is lexical and bounded; it is not a universal query interface across all database features. Page/course/task/progress context is provided as visible summarized state. |
| Internet search | PARTIALLY IMPLEMENTED | Gemini Google Search grounding can be invoked only when `GEMINI_WEB_GROUNDING_FREE_TIER_ONLY=true`. Search is not a separate search provider integration. A UI toggle alone does not enable it; the environment flag is required. Search availability, actual free-tier entitlement/limits, and provider billing settings are **NOT VERIFIED**. No paid fallback is intentionally implemented in the inspected route. |
| Reference books | PARTIALLY IMPLEMENTED | No separate curated academic-book corpus or book catalog/retriever was found. The AI categorizes retrieved web results by source/title/host heuristics, so a “Reference Books” category does not prove that a specific textbook was retrieved. User-uploaded books may be indexed as PDFs and retrieved through the PDF workflow. Copyright/open access verification is not established by the heuristics. |
| Markdown, tables, code, math | IMPLEMENTED (source/tests) | `AIResponseMarkdown.jsx` uses React Markdown with GFM, line breaks, math, and KaTeX. Raw HTML is not enabled; links are rendered safely; images are disabled. Tests cover Markdown/KaTeX safety and usage in both assistant UIs. |
| Mermaid diagrams | IMPLEMENTED (source/tests) | `MermaidDiagram.jsx` renders diagrams with strict Mermaid security settings, safe SVG output, and expand controls. Tests assert strict configuration and expand behavior. Production browser accessibility/performance is not separately E2E tested. |
| Language selection | IMPLEMENTED (source) | AI Study Tools exposes Auto Detect, English, Hindi, and Hinglish through request validation and prompts. Quality/consistent language behavior requires live Gemini tests, not covered by local deterministic tests. |
| AI quota/errors | PARTIALLY IMPLEMENTED | API layer maps malformed input, auth, inaccessible documents, provider/proxy non-JSON responses, quota/rate limit, and provider errors to useful status/messages. No separate application-level per-user quota ledger was found; provider quotas remain external. |
| AI action safety | IMPLEMENTED (limited scope) | Floating AI suggests section navigation but has no mutating action endpoint in its workflow. No AI-driven data writes requiring confirmation were found. |

## 3. Role and permission audit

Role resolution is centralized in `src/lib/workspaceAccess.js` and `src/App.jsx`: Super Admin is derived from `academic_staff.role`; regular academic staff resolve as teacher; users without staff role resolve as student. The browser uses these checks to gate navigation and controls. Server endpoints also validate the bearer token and role for privileged operations. Frontend visibility is not the security boundary; Supabase RLS/RPC and server authorization must agree.

| Resource/action | Student | Teacher | Super Admin | Enforcement evidence / caveat |
|---|---|---|---|---|
| Sign in, own auth/profile | Own account | Own account | Own account | Supabase Auth; own `academic_profiles` in frontend and local policy definitions. Live policies **NOT VERIFIED**. |
| View academic catalogs/courses | Allocation-visible courses | Assigned/visible courses | All/manage | `courseVisibility.js`, server admin routes, local `20261103`/`20261108` policies. Actual RLS **NOT VERIFIED**. |
| Create/edit personal course/topics | Source allows own personal/course-scoped actions according to existing component checks | Limited by course assignment; no dedicated teacher course workspace | Manage academic catalog | `CourseLibrary.jsx`, APIs/RPCs/policies. Verify applied migration state before deployment. |
| Syllabus and topic completion | View authorized outline; update own completion | Assigned-course permissions depend on UI/policy | Manage/publish outline and sources | `SyllabusLibrary.jsx`, `academic_topic_progress`, `/api/syllabus-import`; local migration definitions only. |
| Study materials | View own and explicitly shared/authorized materials; upload and manage own | Similar owner/shared scope; no broad admin rights | Manage permitted academic materials/admin scope | `MaterialsPanel.jsx`, `study-materials` bucket, `study_materials` RLS and sharing migration. Live storage/RLS **NOT VERIFIED**. |
| Indexed PDF/AI context | Own and accessible shared/indexed PDFs | Own and accessible shared/indexed PDFs | Authorized admin material and source scope | Authenticated lookup and owner/path-filtered chunks in APIs. Service-key correctness and policies **NOT VERIFIED**. |
| Tasks/progress | Own tasks and topic completion | Own state; no student-grade privilege | Admin dashboard aggregates only where defined | Tasks use per-user `user_app_data`; progress report is local/derived. |
| Assignments/announcements | Read allocation-visible assignments; announcement workflow limited | Assignment management depends on assignment/admin scopes; no full teacher workspace | Create/manage | `AcademicAssignments.jsx`, `api/admin.js`, local RLS. Recipient announcements incomplete. |
| PYQ | Read verified/published papers allowed for allocation; private file read should match | No Super Admin upload rights; teacher view depends on policy/allocation | Upload, verify, publish, archive, delete | `PreviousYearQuestions.jsx`; local policies `20261107`/`08`/`11`. No teacher upload role in UI. Production policy/storage state **NOT VERIFIED**. |
| Mock tests | Read published eligible tests; create own attempt; answers/results own only | No question approval/publishing privilege | Manage questions/configs, generate drafts, review/approve/publish, view aggregate results | `api/learning.js`, `server/learningTools.js`, local migrations 06/10. Exact live schema/RPC security **NOT VERIFIED**. |
| Contact inbox | Submit intended to be public, but current UI does not send | No inbox management | Read/change status through learning API | `api/contact.js`, `/api/learning` admin actions; current form is disconnected. |
| Admin dashboard/users/catalog | No | No Super Admin dashboard | Role and academic administration, subject to server action allowlist | `api/admin.js`, `server/teacherApprovalApi.js`, audit/RPC definitions. Some UI controls disabled. |

### Admin/teacher limitations

- `api/admin.js` verifies active Super Admin for privileged catalog/user actions and uses explicit action/table allowlists.
- `server/teacherApprovalApi.js` validates verified bearer identity, active status, current Super Admin role, target/branch inputs, and authenticated RPC usage. This is stronger than trusting a client-supplied actor ID.
- Promotion of arbitrary users to Teacher/Super Admin is not exposed as an unrestricted UI action. Teacher approval/branch assignment endpoint code exists, but `TeacherManagement` currently has limited/disabled operational controls.
- `UserManagement` does not expose all server functions. Suspension/restore functionality exists in backend/RPC coordination, but UI is incomplete/disabled. Do not treat endpoint existence as a complete operations workflow.
- Teachers have no clearly separate teacher portal or teacher-specific top-level dashboard in `App.jsx`; their visible workspace largely overlaps student sections, constrained by role checks.

## 4. Database dependency map and local migrations

The following is derived from source and SQL files only. It is not a verified production inventory.

| Feature | Tables, storage, functions referenced in source/local migrations |
|---|---|
| Core/auth | Supabase Auth `auth.users`; `courses`; `study_materials`; `user_app_data`; `storage.objects`; `storage.buckets` |
| Academic catalog/profile | `academic_degrees`, `academic_branches`, `academic_cycles`, `academic_profiles`, `academic_staff`, `academic_staff_branches` |
| Course/chapter progress | `course_chapters`, `course_topics`, `academic_units`, `academic_chapters`, `academic_topics`, `academic_topic_progress` |
| Admin and assignments | `platform_audit_logs`, `platform_user_status`, `academic_announcements`, `academic_settings`, `academic_assignments` |
| Shared subject visibility | `course_branch_visibility`; RPC `set_course_branch_visibility` |
| PDF indexing and AI | `study-materials` private bucket; `book_chunks`; optional `academic-syllabi` and `academic_syllabus_sources` |
| PYQs | `previous_year_papers`; `previous-year-papers` private bucket |
| Mock tests | `mock_test_configs`, `mock_test_questions`, `mock_test_attempts`; RPCs `save_mock_test_answer`, `submit_mock_test_attempt`; later marks/scoring definitions in migration 10 |
| Contact | `contact_messages`, `contact_rate_limits`; RPC `submit_contact_message` |
| User photos | `profile-photos` bucket and Auth user metadata path |

Functions referenced/defined in local migrations include `is_current_user_active()`, `is_super_admin()`, `is_assigned_teacher(...)`, `can_manage_academic_course(...)`, `can_manage_personal_course(...)`, `admin_task_count(...)`, `log_academic_admin_change(...)`, `set_platform_user_role(...)`, `approve_teacher_with_branches(...)`, `set_teacher_branches(...)`, `set_platform_user_suspension(...)`, `set_course_branch_visibility(...)`, `save_mock_test_answer(...)`, `submit_mock_test_attempt(...)`, `submit_contact_message(...)`, and syllabus source verification helpers. Other helper SQL may be in the earlier legacy `supabase-setup.sql`; that file is not an instruction to rerun on an existing project.

### Local migration dependency order (not execution advice)

Repository includes migrations dated 20261029–20261111. Broadly they layer existing-project repair/material course sharing; personal course progress; academic hub/profile; admin hardening and role/RPC policies; profile scoping; atomic teacher approval; assessment/PYQ/contact; PYQ allocation; shared branch visibility; syllabus sources/import; mock-test marks; and targeted PYQ mapping visibility. There is also a 20261105 teacher suspension draft and a relationship rollback file. Migration naming/order does not establish application status. Do not blindly rerun these files: some drop/recreate policies, constraints, or functions and may change live behavior.

Specific dependencies to confirm before deployment:

- Assessment and PYQ schema/functions from `20261106_learning_assessment_and_papers.sql`.
- PYQ allocation/storage policies from `20261107_previous_year_papers_allocation_scope.sql` and branch-mapping policies from `20261108_shared_subject_branch_visibility.sql` or the narrowly targeted `20261111_pyq_branch_mapping_visibility.sql`.
- Syllabus source tables/bucket/RPCs from `20261109_academic_syllabus_import.sql`.
- `marks_per_question` and scoring changes from `20261110_mock_test_marks.sql`.
- `course_branch_visibility` mapping rows: schema existence does not mean any subjects are mapped to branches.
- Buckets are private and configured with the intended mime/size policies; local source expects names including `study-materials`, `profile-photos`, `previous-year-papers`, and `academic-syllabi`.

**Database/RLS/storage production status: NOT VERIFIED.** No live query, Supabase CLI operation, SQL execution, policy inspection, or Storage access was performed. No migration should be considered applied based on this report.

## 5. Security audit

### Positive implementation evidence

- Browser client setup is in `src/lib/supabase.js`; privileged key use is confined by source design to server functions/helpers. No service-role key was found in frontend code paths reviewed. Environment values were not read.
- Admin, learning, AI, indexing, syllabus, and teacher-approval routes use bearer-token verification or active user checks; admin actions have server-side Super Admin checks, not only hidden UI buttons.
- AI PDF retrieval first uses the authenticated Supabase client to identify accessible document rows. Elevated chunk access is constrained by owner and storage path before text is passed to Gemini.
- Mock test question listing is designed to omit answer keys; save/submit operations validate attempt owner and use server-side scoring RPCs. RLS/RPC installation remains unverified.
- PYQ Storage is intended to remain private; metadata publication and object access are separate. Local policies avoid adding student object-write privileges.
- Markdown renderer does not enable raw HTML, disables images, and uses safe link handling. Mermaid is configured with strict security settings.
- File validation and backend PDF signature/size checks are present for materials/indexing and other uploaded PDFs.
- Input validators bound AI history, selected paths/doc counts, page context, academic profile, mock generation, and teacher-branch actions.

### Risks and limitations

1. **Live RLS cannot be inferred.** Local policies can be unapplied, partially applied, replaced manually, or conflict. This applies to every table and Storage bucket.
2. **Service-key blast radius:** server code necessarily uses elevated access for some operations. Confirm production secret storage, no client exposure, restricted function deployment, and that every service-role query includes explicit ownership/allocation filters.
3. **Course degree mismatch:** Mock Test UI/API select `courses.degree_id`, not created by local academic hub migration. This can cause admin/test generation failures if production schema matches local migrations. A manual extra column could exist, but this is **NOT VERIFIED**.
4. **Storage consistency:** Upload/delete operations may span Storage and Postgres without a transaction. Failures can leave orphaned rows/files. Private access remains essential; do not compensate for missing read policies by making buckets public.
5. **Syllabus parser:** text extraction cannot reliably handle scans, tables, or complex layouts. Admin review is necessary; parsing does not prove source accuracy.
6. **AI prompt injection:** retrieved PDF/web text is untrusted input. It should not be treated as instructions or as authorization. The server has no mutation tool in the floating workflow, which limits impact.
7. **External research labels:** host/title heuristics do not establish a book's legal availability, source quality, or that a full book was consulted. UI should not imply that without retrieved evidence.
8. **No automated browser/security E2E suite:** Node tests exercise helper contracts, not real Supabase RLS, OAuth, file access, concurrent attempts, or Gemini quota/runtime behavior.
9. **Contact flow:** current form claims success without delivery; public API rate limiting depends on migration/RPC state.
10. **Local route gaps:** contact and syllabus-import endpoints aren't mounted by Vite middleware.

## 6. Test and static verification

Executed locally without production credentials or database calls:

- `npm.cmd test` — **PASS**, 95 tests, 0 failed, 0 skipped. Tests cover profile validation, AI payload/context, PDF selection and retrieval authorization, Markdown/KaTeX/Mermaid safety, redirects, contact UI behavior, branch visibility contract, learning access/question generation, PYQ policies/migration contracts, file validation, syllabus import, teacher approval, and workspace gating.
- `npm.cmd run build` — **PASS** using Vite 6.4.5; 4,124 modules transformed; built successfully in approximately 24.9 seconds.
- Build emitted a chunk-size warning: several chunks exceed 500 kB, including Mermaid-related assets and an approximately 1.48 MB ELK chunk (uncompressed). Dynamic splitting is already partly used, but further lazy-loading/tree-shaking should be reviewed to reduce initial download and mobile cost.
- The first build attempt was denied when sandboxed esbuild tried to read a parent directory. The same read-only build was rerun with filesystem permission and passed. No application source files were changed.
- `git status` showed no tracked changes before report creation. Build artifacts under ignored `dist/` may be regenerated by the build; this audit did not alter source code.

No live API, Supabase, OAuth, Storage, Gemini, quota, or user-journey integration tests were run. The test suite uses local deterministic fakes/contracts and cannot prove production deployment status.

## 7. Findings: bugs, incomplete workflows, and performance

### Confirmed from local source

| Severity | Finding | Evidence |
|---|---|---|
| High | Contact form reports success but sends no request. | `src/components/ContactUs/ContactUs.jsx` only prevents default and sets status; backend exists at `api/contact.js`. Current behavior is explicitly UI-only. |
| High | Mock Test code reads `courses.degree_id` although the local migration does not add it. | `src/components/AdminDashboard/MockTestManagement.jsx` initial select and filter; `api/learning.js` generator select; `20261031_phase1_academic_hub.sql` course columns. Verify schema before trusting Mock Test admin/generator. |
| Medium | Vite local API plugin lacks two existing API functions. | `vite.config.js` route table lacks `/api/contact` and `/api/syllabus-import`; consumers exist in `ContactUs` API helper and `SyllabusLibrary.jsx`. Contact currently does not use it, but syllabus import will not reach the server in local Vite mode. |
| Medium | Task sync status props do not match. | `App.jsx` passes `taskSyncStatus/taskSyncError`; `TasksPanel.jsx` expects `syncStatus/syncError`. Confirm component wiring, but passed defaults mean task sync state may not render. |
| Medium | Admin actions/UI coverage trails backend. | Secure teacher approval/suspension endpoints and RPCs exist, but UI has disabled/limited controls. No standalone teacher workspace. |
| Medium | Search/retrieval is lexical, not semantic. | `server/documentRetrieval.js` uses token/term matching and bounded chunks; no vector embedding lookup was found. |
| Medium | Reported progress is activity completion, not grades. | `ProgressReport.jsx`, `ChapterTracker.jsx`, local progress tables; separate from mock-test score history. |
| Low | Large production bundles. | Successful Vite build warns about chunks >500 kB, including AI Markdown/Mermaid and ELK. May slow startup on mobile. |
| Low | Existing audit/docs are stale in areas. | `PROJECT_FEATURE_AUDIT.md` and README route/feature claims differ from current code. Update docs as a separate maintenance task. |

### Not established by this audit

- Which database migrations, RPCs, triggers, tables, policies, and Storage bucket rules are present in production.
- Whether any current student has a valid allocation or any paper, test, or syllabus source is published.
- Whether provider keys, free-tier Google Search grounding, OAuth, SMTP, Vercel functions, redirects, and production build variables are correctly set.
- Whether Gemini models used in source are enabled for the configured API key and account.
- Actual runtime performance, accessibility across devices, and production error rates.

## 8. Deployment considerations

Before deployment, an authorized operator should compare each local migration against production schema/policies and an explicit migration history. Do not run the legacy `supabase-setup.sql` against an existing project or blindly replay policy-replacement migrations. Confirm migrations and RPC grants by read-only catalog diagnostics first, then prepare a reviewed migration plan if needed.

Also verify:

- Vercel/serverless runtime supports the declared Node engine and all `/api/*` handlers are deployed.
- Vite local development maps every API endpoint that developers need, notably syllabus import and contact if that backend is intended to be used.
- Server-only Gemini/Supabase secrets are configured only in server environment; browser bundle contains publishable key only.
- Supabase Auth provider, Google credentials, email templates, redirect allow-list, and public URL are configured.
- Private bucket policies and allocation rules match the local intended rules; test both metadata and object download as eligible and ineligible accounts.
- Required migrations/RPCs/buckets exist for course allocation, PDF indexing, PYQ, mock tests, contact submission, syllabus imports, and admin audit.
- `courses.degree_id` mismatch is resolved against actual schema before Mock Test management/generation is used.
- Large chunks and accessibility/mobile flows are reviewed with a deployed preview.
- Contact submission UX matches actual delivery behavior; current form is misleading if users expect a ticket/message to arrive.
- Gemini model availability and grounding quota/cost settings are verified for the actual account. The source attempts to gate search to an explicitly named free-tier flag, but no provider billing/account state was inspected.

## Appendix: key source paths

- App/auth/navigation: `src/index.jsx`, `src/App.jsx`, `src/lib/workspaceAccess.js`, `src/lib/authRedirect.js`, `src/lib/authCallback.js`, `src/lib/supabase.js`
- Admin and approvals: `src/components/AdminDashboard/AdminDashboard.jsx`, `src/components/AdminDashboard/MockTestManagement.jsx`, `api/admin.js`, `server/teacherApprovalApi.js`
- AI: `src/components/AIStudyTools/AIStudyTools.jsx`, `FloatingAIAssistant.jsx`, `IndexedDocumentPicker.jsx`, `AIResponseMarkdown.jsx`, `MermaidDiagram.jsx`, `src/lib/aiRequest.js`, `src/lib/aiPageContext.js`, `api/ai.js`, `api/ask-book.js`, `api/index-book.js`, `server/aiAssistant.js`, `server/documentRetrieval.js`
- Learning: `src/components/MockTests/MockTests.jsx`, `src/lib/learningApi.js`, `api/learning.js`, `server/learningTools.js`, `server/mockTestGenerator.js`
- Courses/materials/syllabus: `src/components/CourseLibrary/CourseLibrary.jsx`, `MaterialsPanel/MaterialsPanel.jsx`, `MaterialsPanel/fileValidation.js`, `SyllabusLibrary/SyllabusLibrary.jsx`, `AcademicAssignments/AcademicAssignments.jsx`, `server/syllabusPdf.js`, `api/syllabus-import.js`
- PYQ/contact/progress: `src/components/PreviousYearQuestions/PreviousYearQuestions.jsx`, `src/components/ContactUs/ContactUs.jsx`, `api/contact.js`, `src/components/ProgressReport/ProgressReport.jsx`, `src/components/ChapterTracker/ChapterTracker.jsx`
- Local SQL definitions: `supabase-migrations/20261029_*` through `supabase-migrations/20261111_*`; these are repository artifacts, not production evidence.
- Configuration: `package.json`, `vite.config.js`, `vercel.json`, `README.md`.
