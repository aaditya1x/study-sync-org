# Teacher Approval Staging Package

**Status: REVIEW DRAFT - do not execute.** This package contains a proposed SQL migration and staging instructions only. No SQL was executed, no Supabase project was contacted, and no application or deployment changes were made. The migration is not approved for staging or production.

## Package contents

- [Migration draft](../supabase-migrations/20261104_teacher_approval_atomic.sql)
- This document: schema preflight, security test plan, blockers, and execution sequence.
- Design source: [Teacher Approval Security Proposal](../TEACHER_APPROVAL_SECURITY_PROPOSAL.md).
- Suspension/restoration saga design (supersedes this package's earlier two-call suspension recovery description): [design](TEACHER_SUSPENSION_RESTORATION_DESIGN.md), [API state machine](TEACHER_SUSPENSION_API_STATE_MACHINE.md), [concurrency tests](TEACHER_SUSPENSION_CONCURRENCY_TEST_PLAN.md), and [review-only migration draft](../supabase-migrations/20261105_teacher_suspension_operations_draft.sql).

The new suspension/restoration artifacts are separate review drafts. They are not included in or approved by the teacher approval migration below. Use their Auth ambiguity blockers and two-instance tests for any future suspension work; do not rely on the earlier sequential suspension rows in this package as sufficient verification.

## Local schema verification

The following names were checked against local migration files, not a live database:

| Object | Locally defined fields relevant to this proposal | Evidence |
|---|---|---|
| `academic_staff` | `user_id`, `role`, `created_at` | `20261031_phase1_academic_hub.sql`; role constraint updated in `20261102_super_admin_rbac.sql` |
| `academic_staff_branches` | `user_id`, `branch_id`, `assigned_by`, `created_at` | `20261031_phase1_academic_hub.sql` |
| `academic_profiles` | `user_id`, `degree_id`, `branch_id`, `academic_cycle_id`, `year_level`, `semester`, `updated_at` | `20261031_phase1_academic_hub.sql`, later profile changes in `20261103_academic_profile_scoping.sql` |
| `academic_degrees` | `id`, `name`, `created_at`, `archived_at` | `20261031_phase1_academic_hub.sql`; `archived_at` in `20261102_super_admin_rbac.sql` |
| `academic_branches` | `id`, `degree_id`, `name`, `created_at`, `archived_at` | `20261031_phase1_academic_hub.sql`; `archived_at` in `20261102_super_admin_rbac.sql` |
| `platform_user_status` | `user_id`, `suspended_at`, `suspended_by`, `reason`, `created_at` | `20261102_super_admin_rbac.sql` |
| `platform_audit_logs` | `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `metadata`, `created_at` | `20261102_super_admin_rbac.sql` |

Local migrations also define `is_current_user_active()` and `is_super_admin()`, but these do not establish Auth ban checks. Local SQL grants service-role privileges on role/status/audit tables and enables RLS. Local schema is not evidence of staging owners, effective grants, FORCE RLS, Auth columns, policies, migration order, or current rows.

### Explicit blockers

1. `auth.users.banned_until` is referenced by the proposed SQL but is **not defined or verified by the checked-in migrations**. Confirm the staging Auth schema and permissions; if that field does not exist, stop and obtain a reviewed design based on the actual Auth ban representation. Do not substitute an assumed column.
2. The staging migration baseline, constraints, trigger names, function signatures, function/table owners, effective role memberships, table grants, RLS and FORCE RLS state, and audit insert behavior are unknown. The proposed owner is `postgres`; verify it exists, has the needed rights, and behaves as required. If a definer owner cannot safely access required rows, stop. Do not alter RLS as a workaround.
3. Current deployed `/api/admin` has direct service-role teacher-branch writes and suspension/status writes. The compatibility-shutdown release and deployed-instance verification described below must happen before applying ACL revocations. This package does not implement that release.
4. Existing branchless/cross-degree teachers, suspension mismatches, duplicate or unexpected triggers, and old database writers are not known. Read-only preflight reports them; do not normalize or mutate rows as part of this migration.
5. SQL syntax, PostgreSQL-version compatibility, trigger concurrency behavior, and deferred constraint semantics remain unverified by execution. Validate only on a disposable staging clone after independent review.
6. The migration now proposes statement-level advisory-lock triggers to serialize catalog/profile/assignment DML before row locks. This is a static design correction only; do not claim the race is fixed until the two-session tests below pass.
7. Local FK `academic_staff_branches.branch_id -> academic_branches.id` is `ON DELETE RESTRICT`, so deleting an assigned branch cannot cascade-delete that assignment. No redundant delete guard is added. The profile degree FK also uses `ON DELETE RESTRICT`, but that does not reject a degree whose `archived_at` is set. The profile guard now validates INSERT and UPDATE; it allows `degree_id IS NULL` for existing setup/upsert flows, and requires any non-null degree to be active.

## Staging preflight checklist (read-only)

Run only after identifying the intended non-production project and confirming the SQL editor/session is connected to that project. Do not run on production. Keep result sets containing IDs inside the approved staging environment.

### Schema, columns, constraints

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('academic_profiles','academic_degrees','academic_branches',
    'academic_staff','academic_staff_branches','platform_user_status','platform_audit_logs')
order by table_name, ordinal_position;

select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'auth' and table_name = 'users'
  and column_name in ('banned_until','ban_duration');

select c.conrelid::regclass as table_name, c.conname, c.contype,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid in (
  'public.academic_profiles'::regclass, 'public.academic_degrees'::regclass,
  'public.academic_branches'::regclass, 'public.academic_staff'::regclass,
  'public.academic_staff_branches'::regclass,
  'public.platform_user_status'::regclass, 'public.platform_audit_logs'::regclass
)
order by table_name, c.conname;
```

The Auth query is an inspection only. A missing `banned_until` is a stop condition for this draft, not permission to edit the function to an unreviewed alternative.

### RLS, ownership, grants, functions, triggers

```sql
select n.nspname, c.relname, pg_get_userbyid(c.relowner) as table_owner,
       r.rolbypassrls, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
join pg_roles r on r.oid=c.relowner
where n.nspname='public' and c.relname in
 ('academic_profiles','academic_degrees','academic_branches','academic_staff',
  'academic_staff_branches','platform_user_status','platform_audit_logs')
order by c.relname;

select * from pg_policies where schemaname='public' and tablename in
 ('academic_profiles','academic_degrees','academic_branches','academic_staff',
  'academic_staff_branches','platform_user_status','platform_audit_logs')
order by tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name in
 ('academic_profiles','academic_degrees','academic_branches','academic_staff',
  'academic_staff_branches','platform_user_status','platform_audit_logs')
order by table_name, grantee, privilege_type;

select p.oid::regprocedure as signature, pg_get_userbyid(p.proowner) as owner,
       r.rolbypassrls, p.prosecdef, p.proconfig, p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in
 ('set_platform_user_role','is_current_user_active','is_super_admin',
  'approve_teacher_with_branches','set_teacher_branches','set_platform_user_suspension',
  'guard_teacher_branch_assignment','assert_teacher_has_branch',
  'guard_teacher_profile_degree','guard_assigned_branch_catalog',
  'guard_branch_active_degree','guard_assigned_degree_archive')
order by signature;

select t.tgrelid::regclass as table_name, t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t where not t.tgisinternal
  and t.tgrelid in ('public.academic_profiles'::regclass,
    'public.academic_degrees'::regclass,'public.academic_branches'::regclass,
    'public.academic_staff'::regclass,'public.academic_staff_branches'::regclass)
order by table_name, t.tgname;

select rolname, rolsuper, rolbypassrls
from pg_roles where rolname in ('postgres','service_role','authenticated','anon')
order by rolname;
```

Review effective privileges, including inherited memberships and table ownership. If either staff table is owned by `service_role`, ACL revocation alone cannot close direct writes: stop and submit a separately reviewed ownership proposal. Verify definer privileges and audit insertion under actual RLS/FORCE RLS. No policy changes are in this package.

### Legacy state report (IDs only; read-only)

```sql
select s.user_id, p.degree_id, count(distinct sb.branch_id) as branch_count,
       count(distinct sb.branch_id) filter (where b.id is null or b.archived_at is not null
          or b.degree_id is distinct from p.degree_id) as invalid_assignment_count
from public.academic_staff s
left join public.academic_profiles p on p.user_id=s.user_id
left join public.academic_staff_branches sb on sb.user_id=s.user_id
left join public.academic_branches b on b.id=sb.branch_id
where s.role='teacher'
group by s.user_id,p.degree_id
having count(distinct sb.branch_id)=0 or count(distinct sb.branch_id) filter
 (where b.id is null or b.archived_at is not null or b.degree_id is distinct from p.degree_id)>0;

select u.id as user_id, u.banned_until,
       (ps.user_id is not null) as has_platform_suspension
from auth.users u left join public.platform_user_status ps on ps.user_id=u.id
where (u.banned_until is not null and u.banned_until > now())
   <> (ps.user_id is not null)
order by u.id;

select role, count(*) from public.academic_staff group by role order by role;
select count(*) as super_admin_count from public.academic_staff where role='super_admin';
```

If the Auth ban column is unavailable, do not run the second query as written; first resolve blocker 1. Report and review legacy rows without changing them. Confirm at least two active Super Admins before staging rollout.

### Preflight sign-off gates

- [ ] Correct non-production project and disposable staging identities confirmed.
- [ ] Columns, FK/PK/check constraints, migration baseline, and Auth ban representation match the draft.
- [ ] Function/table owners and effective grants reviewed; owner has needed privileges.
- [ ] RLS/FORCE RLS and audit insert behavior support the definer functions without policy changes.
- [ ] Legacy data report reviewed; no automatic repair/backfill approved by this package.
- [ ] Compatibility shutdown deployed to every staging API instance; legacy writes are absent.
- [ ] SQL draft independently reviewed and syntax/semantics validated on a disposable clone.

Any unchecked gate is a blocker. Do not apply the SQL draft.

## Security test plan (disposable staging only)

Use disposable users and catalogs. Capture before/after row counts and IDs, relevant role/branch/status rows, and audit events. Tests that expect rejection must show no partial write or audit event. Never run fault injection or concurrency tests in production.

| Area | Scenario | Expected result |
|---|---|---|
| Authorization | Anonymous, student, teacher call each authenticated RPC | Denied; no data or audit changes |
| Authorization | Active Super Admin calls approval for eligible student and valid branch | Success; role, branch assignments and audit commit together |
| Authorization | Platform-suspended or Auth-banned Super Admin calls each RPC with an otherwise valid JWT | Denied; no writes |
| Authorization | Target is missing, self, staff member, suspended, or Auth-banned | Denied; no writes |
| Input validation | Null/empty branch list, null element, unknown/archived/cross-degree branch, missing/archived degree | Denied before any delete or insert |
| Role boundary | Generic service-role RPC requests `teacher` or `super_admin`; API asks for either | Denied; no role writes |
| Role boundary | Existing Super Admin demotion and last-admin demotion | Both denied; Super Admin rows unchanged |
| Branch replacement | Valid replacement containing retained, removed, and added branches | Exact delta only; one audit event per actual assignment change |
| Branch integrity | Attempt empty replacement, direct mismatched branch insert, direct assignment identity update | Denied; existing valid set remains |
| Branch deletion | Attempt to delete an assigned branch | Rejected by existing `ON DELETE RESTRICT` FK; assignment remains and no cascade deletion/audit gap occurs |
| Branch unarchive | Set `archived_at = NULL` on a branch under an archived degree | Rejected; branch remains archived |
| Branch unarchive | Set `archived_at = NULL` on a branch under an active degree | Succeeds if all other constraints pass |
| Branch reclassify and unarchive | One UPDATE changes `degree_id` to an archived degree and clears `archived_at` | Rejected after validating `NEW.degree_id`; prior row values remain |
| Profile insertion | Insert/upsert a profile with null degree, active degree, archived degree, and nonexistent degree | Null degree remains allowed for onboarding; active degree succeeds; archived degree rejected by trigger; nonexistent degree rejected by FK |
| TRUNCATE boundary | Attempt `TRUNCATE` and `TRUNCATE ... CASCADE` as authenticated and service-role credentials on protected profile/catalog/role/assignment/status/audit tables | Denied; no rows or audit history change. Verify owners separately because owner/superuser privileges are not removed by `REVOKE` |
| Profile race | Two sessions: teacher profile degree update versus branch assignment/replacement; DML takes the shared statement-level lock first | Exactly one proceeds at a time; profile degree change rejects while assignments exist, and any later assignment validates the committed profile degree |
| Branch catalog race | Two sessions: assignment/replacement versus branch archive or reclassification, each acquisition order | Later operation sees committed state and rejects if incompatible; no active assignment points to archived/reclassified/cross-degree branch |
| Degree race | Two sessions: branch creation/assignment versus degree archive, each acquisition order | If creation/assignment wins, archive rejects on the dependency; if archive wins, later branch/assignment rejects the archived degree |
| Suspended-actor race | Session A begins approval and waits on shared advisory lock; session B changes actor suspension/role under the same lock and commits; release A | Approval rechecks authority after locks and is denied; no partial write |
| Target suspension race | Suspend target versus approval using separate sessions and lock barriers | Serialized outcome; a committed suspension prevents later approval |
| Auth ban race | In disposable staging, coordinate Auth ban with the Auth user-row lock and verify the supported Auth mechanism serializes as claimed | No banned actor/target is authorized; if Auth updates do not honor the row lock, record as a design blocker and do not claim race protection |
| Suspension recovery (legacy sequence only) | Suspend: DB status succeeds then Auth ban fails/times out. Restore: Auth unban succeeds then DB status removal fails | Status stays restrictive in these individual failure cases; cross-request concurrency is not tested here. Use the separate suspension/restoration test plan before any implementation claim |
| Suspension idempotence (legacy RPC only) | Repeat same requested state | Existing RPC avoids duplicate transition audit sequentially; it does not serialize Auth calls across API instances. Use the separate operation-journal design and concurrent tests |
| Audit atomicity | In disposable clone add temporary trigger that raises for each distinct audit action in turn; call approval, replacement, role demotion, suspend and restore | Entire RPC transaction rolls back, including status/role/branch writes; remove temporary trigger after each run |
| Direct write boundary | Authenticated REST direct DML to staff/branch/status/audit | Denied by existing grants/RLS |
| Direct write boundary | Service-role direct INSERT/UPDATE/DELETE/TRUNCATE on staff, branches, status after migration | Denied; SELECT used by existing read paths still works |
| Definer boundary | Call RPC with user bearer token; call same RPC through service-role client without user JWT | User call subject to checks; service-only context has no `auth.uid()` and is denied |
| Rollback | Force a DDL error in a disposable clone transaction, then inspect functions, triggers, ACLs and row counts | Transaction leaves pre-migration schema/ACLs and all account rows unchanged |
| Forward-only app rollback | Simulate app rollback plan | Legacy teacher/branch endpoints remain disabled; generic promotion guard and direct-write restrictions remain; new account rows are not deleted |

For race tests use two independent sessions and explicit barriers; save the exact interleaving and SQLSTATE. Do not use staging tests to repair historical rows. A mismatch requires a separately reviewed forward operation.

### Required two-session degree/profile/branch race procedure

Run only on a disposable clone with disposable catalog rows and teacher. Use two independent sessions, explicit commit barriers, and read-only observation of `pg_stat_activity`/`pg_locks`. Record statements, advisory-lock waits on key `7710064291`, SQLSTATEs, committed profile/branch/catalog rows, and audit deltas. Do not acquire row locks manually before DML; that violates the migration's lock protocol.

1. **Profile degree versus assignment:** Session A updates the teacher profile to another active degree and holds the transaction. Session B attempts an assignment/replacement using a branch valid only for the old degree. Confirm B waits on the advisory lock. Commit A only if allowed; an assigned teacher's degree change should reject. Then verify B resumes and validates against the committed degree. Reverse acquisition order: let assignment acquire the lock first and commit; the degree change must then reject because the teacher remains assigned.
2. **Branch archive/reclassification versus assignment:** Session A assigns a valid branch and holds the transaction; Session B archives or changes that branch's degree. Confirm B waits, then rejects after A commits. Reverse the order: archive/reclassify and commit first; assignment must wait and then reject the inactive or mismatched branch.
3. **Degree archive versus branch creation/teacher assignment:** Session A creates an active branch or assigns a teacher branch under a degree and holds the transaction; Session B archives the degree. Confirm B waits and then rejects due to the committed dependency. Reverse the order: archive and commit first; branch creation/assignment must wait and then reject.
4. **Replacement, profile, and archive combined:** Hold a complete branch replacement in Session A while Session B attempts both profile degree change and relevant degree/branch archive operations in separate runs. Confirm the waiting statements observe the final committed assignment set and reject any incompatible change.
5. **Branch unarchive/reclassification:** Separately unarchive a branch under an archived degree (must fail), unarchive under an active degree (must succeed if other constraints pass), and in one UPDATE change `degree_id` to an archived degree while clearing `archived_at` (must fail against `NEW.degree_id`). Confirm failed statements preserve the old row state.

Pass only if each waiting statement is observed blocking on the shared advisory lock before its row changes, each possible order ends in a valid consistent state, and there are no deadlocks or partial audit/data writes. If the lock wait is absent or any invariant fails, the race remains unresolved. These tests have not been executed.

## Exact staging execution instructions

These instructions authorize no execution by themselves. Apply only after the institution separately approves this staging change and all gates above pass.

1. Identify the disposable/non-production Supabase project by project reference in the change record. Open a fresh SQL session and independently verify its project/database identity. Do not use production credentials or production SQL editor.
2. Deploy and verify the compatibility shutdown to every staging API instance first: reject `set_role` teacher/Super Admin requests, reject `teacher_branch`, and disable matching UI controls. Confirm no old API instance or server path can write staff/branch/status rows directly. The API/UI change is outside this package and must be completed separately.
3. Run only the read-only preflight SQL above. Save output in approved staging records, IDs only. Stop on any blocker, schema mismatch, ownership/RLS issue, missing Auth ban representation, unexpected trigger (especially one that locks rows before the shared key), any application credential that owns a protected table, or unreviewed legacy-state issue.
4. Independently review the entire migration file. Confirm file hash/revision in the change record, compare each referenced name against staging, verify `postgres` exists and has the required ownership/table privileges, and confirm no RLS statement or row mutation is present.
5. On a disposable clone, validate parser/runtime compatibility and run rollback/error-injection tests. The migration contains one `BEGIN`/`COMMIT`; submit the complete file once through the approved staging SQL runner. Do not run the Super Admin provisioning example from the proposal. Do not split the migration or rerun blindly after an error.
6. If the transaction errors, stop. Inspect migration state, function definitions, owners, ACLs, triggers and row counts read-only before proposing a retry. Do not manually repair the failed transaction or account data.
7. After successful staging application, verify function owners and effective ACLs for `PUBLIC`, `anon`, `authenticated`, and `service_role`; verify direct table DML and TRUNCATE/CASCADE denial, retained read paths, no RLS changes, expected triggers, and audit inserts under actual RLS/FORCE RLS. Confirm no application credential owns a protected table; owners/superusers can bypass ordinary TRUNCATE revokes and are outside this database ACL boundary.
8. Run the security test plan with disposable identities and two-session barriers, including every degree/profile/branch race above in both acquisition orders. Save observed advisory-lock waits and outcomes. Any failed invariant, deadlock, missing lock wait, or unsupported Auth lock behavior blocks further rollout.
9. Keep teacher approval, branch replacement and suspension actions disabled until the separately reviewed RPC-backed API/UI work is implemented and verified. No production preparation or deployment is included here.

## Completion status

Created as a draft package only. Local schema and static lock-order review were performed; live staging verification, two-session race tests, SQL execution, database connection, application changes, and deployment were not performed. The race mitigation is not empirically validated. Critical blockers remain listed above, so this package is **not approved for execution**.
