# Smart Study Sync — Implementation Roadmap

**Purpose:** Evolve the current React + Vite + Supabase application into a college-level LMS and AI study workspace while preserving existing student data, auth, materials, progress and role controls.  
**Planning only:** This document proposes work. It does not implement code, change schema, apply migrations, or alter Supabase/deployment configuration.

## Planning principles

1. Treat `PROJECT_FEATURE_AUDIT.md` as a static source audit, not proof of deployed schema or policy state. Begin each data phase by comparing the live non-production project with `supabase-read-only-audit.sql` and reviewed migration files.
2. Reuse the current React/Vite application, Supabase Auth, Postgres/RLS, private Storage, Vercel API functions, and Gemini integration. Do not add a second auth system, another database, or a new paid AI vendor.
3. Keep existing data models where they already fit: `courses`, `academic_profiles`, `academic_units`/`academic_chapters`/`academic_topics`, `academic_assignments`, `course_chapters`/`course_topics`, `study_materials`, `user_app_data`, and `book_chunks`.
4. Separate shared academic content from student-owned progress and personal content. A profile change must not delete, rewrite, or reassign personal tasks, notes, materials or progress.
5. Keep authorization in RLS and server-side checks. Client-side filtering is presentation logic only.
6. Build in small migrations that are additive and preflighted. Each migration needs a rollback/recovery note and non-production verification before production consideration.
7. Add automated tests at the same time as each critical path. The repo currently has no test runner; a Vite-compatible test setup is a development dependency, not a new runtime service.

## Current baseline to preserve

### Already present in source

- Email/password registration and sign-in, Google OAuth call, confirmation/resend, password recovery, callback handling and sign-out via Supabase Auth.
- Degree/branch onboarding and academic profile editing; the profile schema also has optional cycle/year/semester fields and the Academic Hub exposes those controls.
- Student dashboard, client-side navigation/search, course CRUD, personal chapter/topic progress, material upload and sharing, personal tasks, progress report, theme selection and a responsive navigation drawer.
- PDF text indexing and one-shot Gemini summarize/explain/quiz and PDF question-answering APIs.
- Super Admin API/UI, role change RPC, user suspension, teacher branch assignment UI, academic catalog/content CRUD, announcement authoring, audit display and settings storage.
- Local SQL files specify academic tables, RBAC, Storage rules and RLS. Their deployed status is unknown.

### Known gaps to address rather than duplicate

- Academic Hub can currently save empty degree/branch values. Task sync state props are mismatched, so the UI does not display sync status.
- Course views are branch-scoped in app state, but cycle/year/semester are not automatic profile filters. The local RLS course-scope migration must be verified before relying on it.
- Student “Curriculum” is not connected to normalized academic unit/chapter/topic records. Personal chapter tracking is a separate feature and should remain separate.
- There is no teacher-specific workspace, student announcement feed, assignment submission workflow, persistent notes editor, multi-turn AI conversation history or permanent user purge workflow.
- Platform settings can be stored but are not consumed by application behavior.

## Phase dependency overview

```text
Security/schema verification gate
          |
          v
Phase 1 Core academic system
       |              \
       v               v
Phase 3 Teacher     Phase 2 AI workspace
       |               |
       +-------> Phase 4 Student experience
                         |
                         v
              Phase 5 Admin/security completion
                         |
                         v
              Phase 6 production readiness
```

Security verification is a gate before feature development, and security work continues inside every phase. Phase 5 is the completion/operations phase; its role and RLS foundations must be verified before Phase 3 teacher access is enabled. Phase 2 can proceed after Phase 1 ownership and academic relationships are stable. Phase 4 depends on Phase 1 and teacher-created assignments/announcements from Phase 3.

## Phase 1 — Core academic system

**Priority: Critical**  
**Objective:** Make academic identity mandatory and authoritative, show students only the academic content matching their profile, and make personal task data reliably available across sessions.

### Existing components to reuse

- `src/components/AcademicProfile/AcademicProfile.jsx` for onboarding and profile selection.
- `src/components/AcademicHub/AcademicHub.jsx` and `AcademicCatalogAdmin.jsx` for allocation/catalog UI.
- `src/components/CourseLibrary/CourseLibrary.jsx` for course CRUD and filters.
- `src/components/ChapterTracker/ChapterTracker.jsx` and `src/components/ProgressReport/ProgressReport.jsx` for personal progress.
- `src/components/TasksPanel/TasksPanel.jsx`, `src/hooks/usePersistentState.js`, `App.jsx` task load/save effects and `user_app_data` for task persistence.
- Tables: `academic_profiles`, `academic_degrees`, `academic_branches`, `academic_cycles`, `courses`, `course_chapters`, `course_topics`, `user_app_data`.

### Major work and requirements

| Work item | Existing functionality | New development / database | Frontend and API | RLS/security | Acceptance criteria | Priority |
|---|---|---|---|---|---|---|
| Academic profile validation | Onboarding requires degree and branch; profile row uses `degree_id`, `branch_id`, optional cycle/year/semester. | Preflight existing null/invalid profiles. Plan an additive constraint only after data cleanup and confirming the intended required fields. Keep composite branch/degree integrity. | Use one shared validation path for onboarding, Settings and Academic Hub saves. Show a recoverable catalog/profile load error; never treat a read failure as an empty profile. | Own-row read/write only; database must reject branch/degree mismatch. Catalog writes remain Super Admin-only. | A new account cannot reach the dashboard without a valid degree and branch. Every profile edit preserves a valid pair; API/REST attempts to save an invalid pair are rejected. | Critical |
| Year/semester/cycle filtering | `academic_profiles` and courses have cycle/year/semester data; Academic Hub has optional selectors; CourseLibrary has manual filters. | Reuse existing columns. Do not create a parallel academic-term model. Confirm supported year/semester ranges and cycle semantics with the institution before locking validation. Add/adjust indexes only after query-plan evidence. | Apply profile defaults to dashboard, Courses, Curriculum and Assignments. Keep user-adjustable filters and a clear “all terms in my profile” behavior. Refresh academic data after profile change. | RLS should enforce branch authorization. Add term restrictions in RLS only if institutional privacy requires them; client filters alone are never authorization. | With a profile containing branch/cycle/year/semester, default views exclude mismatched course and assignment records. Clearing optional filters has explicit behavior and does not expose another branch. | Critical |
| Normalized student curriculum | Admin CRUD and tables `academic_units`, `academic_chapters`, `academic_topics` exist in source/migrations. Student `ChapterTracker` stores per-user progress separately. | Reuse existing normalized tables. Add no second curriculum hierarchy. Add indexes on parent IDs if not already present and needed by measured queries. | Create student curriculum views/components that query academic units → chapters → topics for scoped courses. Link to, but do not replace, personal completion records. | Student read only for active curriculum of authorized courses. Super Admin and assigned teachers manage only permitted courses. Validate parent-course scope on writes. | A student sees the correct units/topics for their profile; a teacher cannot edit a non-assigned branch; personal completion remains after curriculum refresh. | Critical |
| Course and subject management | CourseLibrary supports owner-managed course create/edit/delete; Admin API supports shared course create/archive; `courses` has academic allocation fields. | Preserve the existing `courses` table and distinguish personal courses (`owner_id`) from institution-managed courses using existing fields/policies. Only add a discriminator if current schema cannot unambiguously express the distinction after audit. | Make course selectors consistently use profile-scoped courses. Provide clear personal vs shared presentation and an academic assignment context. | Apply and verify course SELECT RLS before relying on `20261103_academic_profile_scoping.sql`. Students read own courses and matching branch courses; teacher reads assigned branch only; Super Admin has admin access. | Direct database requests enforce the same scope as UI. Course edit/delete is limited to permitted owner/admin actions and does not delete unrelated personal materials/progress. | Critical |
| Reliable personal task sync | Task CRUD and `user_app_data` JSON sync exist; localStorage fallback exists. Visible sync status has a prop-name mismatch. | Reuse `user_app_data` and `data_key="tasks"`; do not duplicate tasks in another table in this phase. Define conflict behavior before changing the JSON format. | Fix `syncStatus`/`syncError` wiring, loading state, retry and offline feedback. Avoid overwriting newer cloud state during initial load. Keep local tasks available if cloud sync fails. | Strict `user_id = auth.uid()` policy for select/insert/update/delete. Validate owner in every upsert. | Create/edit/complete/delete on device A survives reload and appears after login on device B. Offline changes are retained and a failed sync is visible and recoverable. | Critical |

### Phase 1 deliverables

- Reviewed schema preflight and an additive migration plan, if the live schema needs changes.
- Profile validation shared by login onboarding, Settings and Academic Hub.
- Profile-filtered course, curriculum and assignment query helpers.
- Correct task sync status and deterministic load/save/retry behavior.
- Automated tests for profile validation, query scoping and sync state, plus RLS tests against a staging Supabase project.

### Dependencies

This is the base for Phases 2–4. Before implementation, verify migration order and the live schema. Phase 3 teacher workflow must wait for branch policy tests. Do not bulk-edit course allocation data until a reviewed backfill plan exists.

## Phase 2 — AI Study Workspace

**Priority: High**  
**Objective:** Extend the current stateless AI tools into a user-owned workspace with notes and optional saved conversations, while preserving the existing Gemini/PDF path and avoiding a second AI provider.

### Existing components to reuse

- `src/components/AIStudyTools/AIStudyTools.jsx` and its summarize/explain/quiz modes.
- `api/ai.js`, `api/index-book.js`, `api/ask-book.js`, `server/userAccess.js`, `server/apiDiagnostics.js`.
- `study_materials`, `book_chunks`, private `study-materials` bucket, `pdf2json`, short-lived signed URLs.

### Major work and requirements

| Work item | Existing functionality | New development / database | Frontend and API | RLS/security | Acceptance criteria | Priority |
|---|---|---|---|---|---|---|
| Multi-turn assistant | `/api/ai` accepts one prompt and returns one response. PDF Q&A has lexical retrieval and cited pages. | No new provider. Add an owned conversation/message model only if saved history is enabled; keep prompt/context size limits and retention policy. | Add conversation list, message thread, streaming only if supported cleanly by current Vercel runtime, cancel/retry and clear-thread controls. Extend API input with conversation ID/history; server loads history rather than trusting arbitrary client-supplied roles. | Verify conversation ownership server-side and RLS by `user_id`. Strip/validate client message roles, cap turns/tokens, do not let retrieved note/PDF text override system instructions. | Replies use prior turns in the same conversation; another user cannot list/read/send to it; limits/timeouts return visible errors; existing one-shot modes still work. | High |
| Conversation history | No history persistence exists. | Proposed `ai_conversations` and `ai_messages` tables (or one carefully versioned JSON representation after size/concurrency review). Foreign keys, owner ID, timestamps, model/mode metadata and retention fields need review. | Add create/list/archive conversation APIs. Persist user and assistant turns only after ownership and request completion rules are clear. | Own-row RLS; server verifies conversation owner on every request. Never use service-role access without checking the caller's ownership. | Refresh restores the user's conversation list and turns; deleting/archiving one thread does not affect notes, materials or tasks. | High |
| Notes editor and storage | No dedicated note entity exists; AI textarea is transient. | Proposed `study_notes` with owner, title, body, optional course ID, timestamps and optional tags. Decide whether note content is encrypted/retained and whether it is included in AI context. Reuse existing course FK. | Add Notes list/editor, autosave state, search and “send to AI” action. Do not overload `study_materials` (which models files) or `user_app_data` (tasks blob). | Own-row CRUD. If linked to a course, validate the user can access that course. Avoid exposing note bodies in logs/audit metadata. | Notes persist through reload, can be edited/deleted by owner and cannot be read by another user; sending to AI uses only the selected note. | High |
| PDF Q&A reliability and revision tools | Indexing and Q&A exist, use extracted text chunks and lexical matching; scanned-PDF OCR is absent. | Reuse `book_chunks` and current material metadata. Add no vector service. If improving retrieval, first add local Postgres full-text indexes/queries only if supported by verified schema and measured quality. | Add progress/retry/reindex states and source snippets; summarize selected notes/PDF, generate quizzes and revision plans using existing modes/endpoints. | Check owner/shared authorization before indexing and retrieval. Keep storage private, constrain paths, cap file/text sizes, guard prompt injection in retrieved content, sanitize output display. | Text PDF answer cites source pages; reindex failure does not silently destroy the last good index; scanned-PDF limitation is clearly reported. Existing AI modes still respond. | High |

### Phase 2 deliverables

- Data model/API contract for notes and conversations, with retention and size limits.
- Notes editor and conversation UX reusing the AI Study Tools component family.
- Updated API tests for owner checks, context limits, provider failures, retries and PDF source handling.
- A documented scanned-PDF limitation unless OCR is later explicitly funded/approved.

### Dependencies

Stable Phase 1 course ownership and active-account enforcement. Conversation history and notes are new user data: schema, privacy and retention review must happen before implementation. PDF Q&A can be hardened in parallel because its current API already exists.

## Phase 3 — Teacher Portal

**Priority: Critical**  
**Objective:** Turn existing teacher roles and branch assignment policies into a usable teaching workflow without exposing Super Admin-only controls.

### Existing components to reuse

- `src/components/AdminDashboard/AdminDashboard.jsx` patterns for lists, forms, archive tables and error states.
- `api/admin.js` patterns for authenticated server actions and `academic_staff_branches` assignment.
- `academic_staff`, `academic_staff_branches`, `academic_units`, `academic_chapters`, `academic_topics`, `academic_assignments`.
- `is_assigned_teacher`, `can_manage_academic_course` and branch-specific RLS policies from RBAC migration, subject to live verification.

### Major work and requirements

| Work item | Existing functionality | New development / database | Frontend and API | Security | Acceptance criteria | Priority |
|---|---|---|---|---|---|---|
| Teacher dashboard | Teacher role and assigned branch data exist; main app currently renders student pages and Admin is Super Admin-only. | Reuse branch-assignment table. Add dashboard aggregates only from rows in assigned branches; avoid broad Auth user enumeration. | Add a distinct teacher route/panel, navigation and branch selector limited to assignments. Reuse Admin-style components but do not expose Super Admin controls. | Server and RLS validate every branch/course against the caller's assignments. Do not accept a trusted branch ID solely from the browser. | Teacher sees only assigned branches and associated content. Unassigned branch IDs return no rows/403 on direct API attempts. | Critical |
| Curriculum management | Admin can manage academic units/chapters/topics; RLS intends assigned teachers to manage content for assigned courses. | Prefer existing curriculum tables; add indexes/constraints only as indicated by live audit. Add no parallel teacher curriculum tables. | Add create/edit/reorder/archive flows for units, chapters and topics; include clear unsaved/error states. | Verify parent chain maps to a course in an assigned branch on both `using` and `with check`; teacher cannot reparent into an unassigned course. | CRUD and reorder work for assigned courses; cross-branch reads/writes fail through direct REST as well as UI. | Critical |
| Assignment management | Super Admin can create/archive academic assignments; table and policies already exist. | Reuse `academic_assignments`. Validate due date and course relationship. Submission schema belongs to Phase 4. | Add teacher create/edit/archive/list UI scoped to assigned courses. | `can_manage_academic_course(course_id)` or equivalent RLS is authoritative. Published/archived status behavior is explicit. | Teacher can create/edit assignments only for assigned branches; students can later read only eligible active assignments. | Critical |
| Student progress visibility | Personal chapter/topic rows exist; migration intends assigned staff read access. | No duplicated progress store. Add aggregate views/query only after confirming RLS and query cost. | Add branch/course roster and per-student progress summaries with filters. Do not imply gradebook or assessment scoring unless separately designed. | Teacher can see only students' progress tied to courses in assigned branch; no unrelated personal tasks, private notes or material content leaks. | Test same student across assigned/unassigned branches and confirm only authorized progress is visible. | High |
| Teacher announcements | Announcement table and audience policy exist; no authoring workflow for teachers is confirmed. | Decide whether to extend `academic_announcements.created_by` and audience semantics or create a branch-target relation; avoid an ambiguous free-text branch field. | Allow teacher compose/publish only for assigned branch audiences after the target model is chosen. | Server checks teacher branch scope; RLS prevents teacher publishing to all students or another branch unless explicitly allowed. | Published message appears only to intended students/teachers and cannot be changed by an unrelated teacher. | High |

### Phase 3 deliverables

- Teacher-specific dashboard and navigation.
- Branch-filtered curriculum and assignment authoring.
- Read-only student progress view scoped to assigned courses.
- Role-matrix tests for student, teacher with one/two branches, unassigned teacher and Super Admin.

### Dependencies

Phase 1 profile/course allocation and verified Phase 5 RLS/RBAC foundation are prerequisites. Phase 4 submissions and student announcements depend on the assignment/audience contracts from this phase.

## Phase 4 — Student Experience

**Priority: High**  
**Objective:** Complete the student LMS loop: see announcements and assignments, submit work, use resources/notes, and understand progress in their own profile context.

### Existing components to reuse

- Dashboard/App shell, `AcademicAssignments`, `TasksPanel`, `MaterialsPanel`, `SyllabusLibrary`, `ProgressReport`, `AcademicProfile`.
- Existing `academic_announcements`, `academic_assignments`, `study_materials`, course/profile queries and signed-download path.
- Phase 2 `study_notes` and AI integration if Phase 2 has shipped.

### Major work and requirements

| Work item | Existing functionality | New development / database | Frontend and API | Security | Acceptance criteria | Priority |
|---|---|---|---|---|---|---|
| Student announcement feed | Published-announcement table and audience SELECT RLS exist; no student feed exists. | Reuse `academic_announcements`; add branch audience relation only if selected in Phase 3. Add indexes on audience/published/archived fields if needed. | Add dashboard/feed panel with unread/read state only if a read-state feature is desired; otherwise keep simple published list and links. | RLS scopes by audience and branch. Do not rely on filtering unpublished announcements in React. | Student sees only published announcements addressed to them; drafts/archived/teacher-only messages are absent from student query and direct API. | High |
| Assignment submissions and status | Student assignment listing exists; no submission model or file upload flow exists. | Proposed `assignment_submissions` with assignment ID, student ID, status, submitted timestamp, text and optional Storage path. Define resubmission/deadline/late rules first. If files are enabled, use a private bucket/path policy and object ownership checks; do not make shared study-materials public. | Add assignment detail, submit/update status, receipt, late/closed state and teacher review UI in Phase 3. Add API only for operations requiring elevated checks; ordinary owner operations should use authenticated RLS. | Student can submit only as self and only for an accessible assignment. Teacher can review only assignments in assigned branches. Validate file path, size, type and deadline server-side where appropriate. | Student submission status is visible after refresh; unauthorized student/teacher IDs cannot read or overwrite another submission; late/resubmission rules match written policy. | Critical |
| Study resources and notes | Shared file library/upload/download exists; notes editor is planned in Phase 2. | Reuse `study_materials` for files and `study_notes` for text notes; do not create duplicate resource entities. Add explicit course/branch availability only where needed. | Add profile-aware resource filters, note-to-course association, browse/search/open states and links from curriculum/assignment pages. | Respect owner/shared settings, course scope and private Storage policies. Keep signed URLs short-lived and never expose raw bucket public URLs. | Students can find their own notes and authorized shared resources; changing branch does not delete or relabel their personal content. | High |
| Personalized progress reports | Existing reports use task and personal chapter/topic completion; no assignment submission status is included. | Reuse task/progress/submission tables. Add marks/grades only after institutional requirements are approved; do not infer grades from completion. | Add branch/course/term filters and assignment completion/status summaries. Distinguish personal study progress from formal results. | Queries limited to the current student's rows; admin/teacher aggregate views use role/branch policies separately. | Report values reconcile with underlying tasks, topics and submissions, and never label activity completion as a grade. | Medium |
| Personalized dashboard | Existing dashboard cards/activity and branch course filtering exist. | No new dashboard table required. Add indexes only after profiling. | Compose profile-matched courses, curriculum, announcements, due assignments and personal tasks; provide loading/error/empty states per widget. | Every widget query must use RLS-backed APIs/queries; client filter is supplementary. | Profile changes refresh academic widgets while personal task/note/material/progress IDs and content remain intact. | High |

### Phase 4 deliverables

- Student announcements feed and assignment detail/submission states.
- Submission schema/policies and, if required, private submission object access.
- Resources/notes filters and an academic-context dashboard.
- Cross-user tests proving student submissions, notes and reports are isolated.

### Dependencies

Phase 1 profile/course scope, Phase 3 assignment and announcement contracts, and Phase 5 RLS verification. Notes depend on the Phase 2 notes model; do not create a second note store.

## Phase 5 — Super Admin and Security

**Priority: Critical**  
**Objective:** Verify and complete least-privilege controls for students, assigned teachers, Super Admins and suspended users; make privileged operations observable and recoverable.

### Existing components to reuse

- `AdminDashboard.jsx`, `adminApi.js`, `api/admin.js`, `server/userAccess.js`, `server/apiDiagnostics.js`.
- `academic_staff`, `academic_staff_branches`, `platform_user_status`, `platform_audit_logs`, role RPC and security/RLS migrations.
- `supabase-read-only-audit.sql` and `docs/RBAC-OPERATIONS.md`.

### Major work and requirements

| Work item | Existing functionality | New development / database | API and operations | Security requirements | Acceptance criteria | Priority |
|---|---|---|---|---|---|---|
| Live schema/policy verification | Read-only audit SQL and migrations exist; live policy state is not known. | Compare columns, FKs, constraints, RLS enabled/forced, grants, policy expressions, bucket visibility/limits and migration order in staging. Resolve drift in reviewed migrations only. | No new endpoint required. Store the deployment migration ledger in the team's approved process, not in client code. | Never infer active security from a local file. Review permissive plus restrictive policy composition and service-role bypass paths. | A signed-off matrix states verified live policies/columns and the exact migration version in staging. Production promotion is gated on this evidence. | Critical |
| Role matrix and teacher/staff lifecycle | Role API, RPC, branch assignment UI and helper functions exist. | Add constraints only after backfilling/validating existing role rows. Keep role writes server/service-role-only. | Ensure role changes, branch assignment and removal are idempotent, authorized and auditable. | Test student, teacher assigned/unassigned, Super Admin and suspended identities. Protect last Super Admin and reject self-role mutation. | Direct REST and UI checks pass for every matrix cell; no student can self-promote or write staff assignment rows. | Critical |
| Student/teacher branch RLS | Local migration scopes courses by profile/assigned branch; other academic tables have parent-course policies. | Add/adjust policies only based on audited live definitions. Add indexes to scope lookups where query plans justify them. | Avoid privileged service-role reads for ordinary user data; where server use is necessary, explicitly validate actor and target scope. | Test courses, curriculum, assignments, materials, progress and submissions across assigned/unassigned branches. Preserve `auth.uid()` checks and active-account guards. | Unauthorized data is denied at PostgREST/Storage, not merely hidden in UI. Branch changes immediately affect access as designed. | Critical |
| User management and suspension | Admin user list, role selector and suspend/restore actions exist. | No new table required unless a reviewed status model change is needed. Define operational recovery for partial Auth/DB transitions. | Make suspension/restore retryable and observable; consider a reconciliation action for mismatched Auth ban/status rows. | Suspended users fail protected DB, Storage and AI endpoints with consistent behavior. Role changes on suspended users are rejected until restored. | Test stale JWT, sign-in after suspension, restore after partial failure, and audit trace for each action. | Critical |
| Catalog/content admin and audit | Admin panels and allowlisted API saves/archive; triggers and audit table appear in migrations. | Do not duplicate tables. Decide whether delete is archive-only for referenced academic data. Version audit metadata without storing sensitive text/content. | Ensure every privileged API mutation emits one reliable audit event; ensure direct authenticated staff mutations are audited by triggers. | Audit reads are Super Admin-only; audit write path cannot be forged by browser users. No secrets, prompts or personal file text in logs. | Each catalog/content/role/branch operation has an attributable event and cannot cross role scope. | High |
| Storage verification | Private bucket setup/repair and owner-folder policies are described in SQL and docs. | Verify existing objects and legacy paths before policy changes; preserve files. New submission bucket, if needed, belongs to Phase 4 design. | Signed URL paths are only generated after access checks. Reconcile orphan rows/objects using reviewed read-only reports. | Test owner upload/read/delete, shared read, cross-owner denial, suspended-user denial and profile photo folder boundaries. | Buckets remain private; expected user can access only permitted objects; no public URL or secret appears in built frontend configuration. | Critical |
| Retention and account deletion policy | Suspension/retention is documented; permanent delete is absent. | Define approved retention period, audit preservation/anonymization, FK order and Storage object cleanup before proposing purge schema/API. | Only after approval, create a verified server-side deletion workflow with dry-run/report and idempotent cleanup. | Re-authenticate requester, protect admin accounts, preserve legally required audit records, never cascade-delete unknown shared data. | No purge is implemented until legal/institutional policy and recovery requirements are signed off; then test in staging with disposable accounts. | Medium |

### Phase 5 deliverables

- Environment-specific security matrix and verified migration/policy inventory.
- Role/branch/storage tests, including direct API/PostgREST denial cases.
- Reliable audit and suspension recovery procedures.
- Documented retention decision; account purge remains out of scope until approved.

### Dependencies

The verification gate is first, before Phase 1 data changes or Phase 3 teacher access. Phase 5 completion spans all phases; repeat checks when new tables (notes, conversations, submissions) are introduced.

## Phase 6 — UI/UX and Production Quality

**Priority: High**  
**Objective:** Deliver a consistent, accessible, responsive experience and predictable production operation without changing business logic accidentally.

### Existing components to reuse

- Global token system in `src/styles/global.css`, ThemeContext and ThemeSwitcher.
- Existing CSS Modules, AppShell, Sidebar, Navbar, Toast, EmptyState and loading/error patterns.
- Existing Vite build, Vercel API layout and `npm run build` script.

### Major work and requirements

| Work item | Existing functionality | New development / database | Frontend/API/ops | Security and quality | Acceptance criteria | Priority |
|---|---|---|---|---|---|---|
| Design system consistency | Global theme tokens and many CSS Modules exist; earlier contrast improvements were not browser-audited end-to-end. | No DB changes. Add documented tokens for text, surfaces, borders, focus, danger/success and action colors; avoid per-component unexplained hex values. | Refactor components incrementally while preserving layouts/features. Establish shared field/button/card/dialog patterns. | Avoid color-only status; focus indicator visible; reduced motion respected. | All primary/secondary/placeholder/error/action pairs meet WCAG AA targets in light and dark palettes, checked with automated contrast scan and visual review. | High |
| WCAG and keyboard coverage | Some semantic labels, `aria-*`, focus rules and Escape handling exist. | None. | Audit headings, form labels/errors, dialogs, nav, tables, status announcements, keyboard order, screen-reader names and zoom/reflow. | WCAG 2.2 AA target for relevant flows; never remove keyboard access to simplify appearance. | Keyboard-only journeys complete for login, onboarding, course CRUD, upload, tasks, Admin and AI; no keyboard trap; 200% zoom and mobile reflow reviewed. | High |
| Responsive mobile UX | Sidebar drawer and component breakpoints exist. | None. | Test/adjust tables, forms, AI workspace, upload dialogs, Admin panels, profile forms and assignment/submission views at phone/tablet widths. | Preserve accessible touch target sizes and focus/overlay behavior. | No horizontal page overflow at 320/375/768px; navigation and dialogs usable with touch and keyboard. | High |
| Loading/error/empty states | Some existing modules have loaders, retry buttons, EmptyState and Toast. | None. | Standardize query states and actionable recovery for every new/old panel; distinguish “no records” from failed request. | Do not leak raw server errors, IDs or internal schema details to normal users. | Every query/mutation has success, pending, empty and failure behavior; retries do not duplicate writes. | High |
| Test and release pipeline | `package.json` only defines dev/build/preview; no test/lint/e2e scripts. | Add Vite-aligned test tooling as dev dependencies only after agreeing scope. No paid service is required for local/unit tests. Use staging Supabase for RLS integration. | Add component/unit/API contract tests, browser workflows, `npm run build`, deployment preview and rollback checklist. | Keep test credentials/data isolated; scan frontend build for accidental secret names/values; never use production data in tests. | CI fails on broken build/tests; staging smoke test covers student, teacher and Super Admin; release record identifies migration version and rollback path. | Critical |
| Performance and deployment | Vite build and Vercel functions are configured in repository; API chunk/build limits and actual deployment are unknown. | No schema changes by default. Add indexes only from measured query plans. | Measure route/component bundle, split Admin/PDF modules if needed, enforce function payload/time limits, test environment-variable presence and callback rewrites. | Ensure server secrets remain server-side; logs exclude tokens/prompts/file contents. | Preview deployment passes auth callback, API, mobile and role tests; build artifacts contain no server secret; deployment/rollback is documented. | High |

### Phase 6 deliverables

- Shared token/component guidelines and contrast report.
- Keyboard, screen-reader, responsive and visual test results.
- CI/build and staging release checklist.
- Measured performance changes only where the baseline identifies a bottleneck.

### Dependencies

Begin accessibility and error-state work early, then complete visual and production sign-off after Phase 4/5 interfaces stabilize. No UI polish should bypass RLS or hide security errors.

## Safest implementation order

1. **Security and schema verification gate (Phase 5 foundation):** Run the existing read-only Supabase audit in a non-production project, reconcile actual schema/policies with local migrations, and prove the student/teacher/Super Admin access matrix. Do not implement teacher access on assumed policies.
2. **Phase 1 — Core academic system:** Fix profile required-field paths, apply profile-aware filtering, connect the student curriculum to normalized tables, and repair task sync. These are prerequisites for reliable student, teacher and assignment experiences.
3. **Phase 3 — Teacher Portal:** Once branch scope is verified, expose assigned-branch curriculum/assignment management and scoped progress visibility.
4. **Phase 4 — Student Experience:** Add announcements, submissions and profile-context academic dashboard based on the teacher/assignment contract.
5. **Phase 2 — AI Study Workspace:** Harden current PDF/AI paths and add notes/conversation storage after ownership and retention decisions. AI/PDF hardening can begin earlier, but saved conversations/notes should not precede the security and data ownership design.
6. **Phase 5 — Admin/security completion:** Complete audit/recovery and retention operations as new entities and actions land; repeat security tests for every new table/API/storage path.
7. **Phase 6 — Production quality:** Run full regression, accessibility, responsive, performance and deployment verification. Design system and accessible error/loading patterns should be applied continuously, with final sign-off here.

This order keeps new teacher/student functions behind verified policies, avoids building curriculum twice, and delays irreversible retention decisions until data ownership is clear.

## First phase to develop

**Start with Phase 1: Core academic system**, preceded by the non-coding Phase 5 security/schema verification gate. The first implementation slice should be:

1. Confirm the live staging columns, existing profile nulls, course allocation values, migration order and current policies.
2. Fix the existing academic profile save paths so degree/branch cannot be cleared, without deleting or rewriting user data.
3. Make branch/cycle/year/semester scoping consistent across Dashboard, Courses, Curriculum and Assignments, with RLS as the security boundary.
4. Connect the student curriculum view to existing normalized academic tables while retaining per-user chapter/topic progress.
5. Repair and test personal task cloud synchronization, including visible sync state and offline recovery.

Do not begin with AI conversation history or broad UI redesign: the academic data scope and authorization rules are foundational dependencies for both the LMS workflows and safe personalization.
