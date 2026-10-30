# Study Sync RBAC operations

## Apply the migration manually

Review the live project's `pg_policies`, grants, table definitions, and storage
policies against the repository migrations before applying anything. Then run
`supabase-migrations/20261102_super_admin_rbac.sql` from the Supabase SQL Editor
or your reviewed migration workflow. It is additive and preserves existing
course progress, task data, and materials. It updates the legacy `admin` role
value to `super_admin`, adds role and audit structures, and replaces the
named course/catalog policies. Do not apply this file automatically from the
application.

After applying it, verify the migration committed and PostgREST refreshed.
Role and account administration requires the server endpoint in `api/admin.js`
and server-only `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`). Keep
that key out of every `VITE_*` variable and the browser bundle.

## Provision the first Super Admin

Create or identify the intended account in Supabase Auth first. Copy its
existing Auth user UUID from **Authentication → Users**. After the migration
has been reviewed and applied, run this single-user SQL manually, replacing
the placeholder with that UUID:

```sql
-- Confirm the target is the intended existing Auth account.
select id, email
from auth.users
where id = '00000000-0000-0000-0000-000000000000'::uuid;

-- Provision only that verified account. This is intentionally not exposed
-- through a client RPC or the public application.
insert into public.academic_staff (user_id, role)
select id, 'super_admin'
from auth.users
where id = '00000000-0000-0000-0000-000000000000'::uuid
on conflict (user_id) do update set role = excluded.role;
```

Run it only after confirming the first query returns exactly the account you
intend to administer the platform. The browser cannot write `academic_staff`;
subsequent role changes go through the authenticated server endpoint and the
service-role-only `set_platform_user_role` RPC. Keep at least two trusted
Super Admins after bootstrap; the RPC prevents removal of the last one.

## Retention and account removal

The dashboard has no permanent account-deletion action. Suspension blocks
authenticated access while retaining Auth identity, profile, progress, tasks,
uploads, and audit history for recovery. Catalog content, courses, shared
materials, curriculum, assignments, and announcements support archival where
the schema has `archived_at`; archive does not delete stored objects.

If account deletion is later required, process it only through a reviewed,
server-side workflow with an explicit retention/legal basis. The workflow
must verify the requester and target, preserve or anonymize required audit
records, remove the user's Storage objects and personal rows in a controlled
order, and then delete the Auth identity. This project does not define a
retention period; set one in the institution's policy and Supabase backup
terms before implementing purge behavior. No purge or production data change
is performed by this migration or dashboard.

## Manual security verification

Use separate test accounts for each role and inspect both UI behavior and
direct Supabase/API requests:

1. Student: direct insert/update/delete against `academic_staff` and catalog
   tables is denied; changing a role through `/api/admin` returns 403.
2. Teacher: assigned-branch course/curriculum/assignment edits work; an
   unassigned branch and role/catalog changes are denied.
3. Super Admin: catalog/course operations succeed, archived rows are hidden
   from normal reads, and mutations appear in `platform_audit_logs`.
4. Verify role changes reject self-change and removal of the last Super Admin.
5. Verify students cannot read or mutate another user's profile, tasks,
   chapter/topic progress, private material metadata, or private Storage files.
6. Suspend a test student, retain their existing JWT, and confirm protected
   table/storage operations and server AI routes reject access. Restore the
   account and confirm access resumes.
7. Verify Storage still enforces ownership and existing shared-resource
   policies. Confirm no service-role credential appears in built assets or
   browser environment variables.

Perform these checks in a non-production Supabase project first.
