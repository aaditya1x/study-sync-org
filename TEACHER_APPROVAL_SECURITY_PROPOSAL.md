# Teacher Approval System — Corrected Security Proposal

**Status: READY FOR FINAL REVIEW — not approved for implementation.** Documentation and SQL proposal only. Nothing here has been executed or applied. No application code, data, policies, or deployment settings were changed. Live ownership, ACL, RLS, and schema facts remain staging gates in Section 7.  
**Scope:** Atomic teacher approval, branch replacement, role/suspension API and User Management plan. Teacher Portal implementation is excluded.

## 1. Source review and current risks

`ROLE_VERIFICATION_AUDIT.md` is not present in the repository. This review uses the role-management source and the local migrations, especially `20261102_super_admin_rbac.sql`. Local SQL is not evidence of live database state.

- New registration writes a name to Auth metadata and does not accept a role. A user without an `academic_staff` row is treated as a student. The role shown after login is read from `academic_staff`; user metadata/localStorage is not authoritative.
- `/api/admin` authenticates the bearer token and checks the caller's staff role and `platform_user_status`. It uses the service-role client for data access. The generic `set_role` path currently permits teacher promotion without a branch.
- The current `teacher_branch` action changes a single branch with a separate service-role write and API audit insert. It permits cross-degree assignments and can remove the last branch.
- Existing `set_platform_user_role` is service-role-only, rejects self-change, uses an advisory lock, logs a role change, and protects the last Super Admin. It does not require a branch for teacher promotion and currently permits demotion of a Super Admin when another Super Admin remains.
- The local migrations define `academic_staff`, `academic_staff_branches`, `academic_profiles`, `academic_degrees`, `academic_branches`, `platform_user_status`, and `platform_audit_logs`. Relevant constraints include the staff role check (`teacher`/`super_admin`), branch assignment primary key `(user_id, branch_id)`, branch assignment FK to staff with `ON DELETE CASCADE`, branch FK with `ON DELETE RESTRICT`, and the profile branch/degree composite FK.
- Live function owners, execute ACLs, BYPASSRLS, FORCE RLS, actual policies/grants and migration order cannot be determined from repository files. They must be verified in an identified non-production database before implementation.

## 2. Corrected design

Use the existing tables. No migration-time row updates or new tables are proposed. Add three database functions, integrity triggers, and a deferred teacher-assignment check:

1. `approve_teacher_with_branches`: one authenticated RPC inserts the teacher row, inserts all selected branch assignments, and writes role/branch audit events in a single transaction.
2. `set_teacher_branches`: one authenticated RPC replaces an existing teacher's complete branch set. It rejects an empty set and validates every active branch against the teacher's selected profile degree before deleting anything.
3. `set_platform_user_suspension`: one authenticated RPC changes the database suspension row and logs the state change. The API coordinates the separate Supabase Auth ban/unban operation in a safe order.

Harden the existing service-role-only `set_platform_user_role` function so it rejects teacher promotion, rejects any Super Admin demotion through the management path, retains the last-Super-Admin guard, checks active/Auth-ban status, and audits branch removals before staff deletion. The API and UI must remove their legacy teacher-promotion and one-branch mutation paths in the same release.

**No existing RLS policies are changed.** Function execution is granted only to `authenticated` for the three user-facing RPCs; each derives the actor from `auth.uid()` and checks the active Super Admin role. The generic role RPC remains service-role-only and is prohibited from granting either `teacher` or `super_admin`. Existing table writes remain unavailable to browser roles. The writer inventory and service-role boundary are defined in Section 4.1.

## 3. Proposed migration SQL (review draft; do not execute)

Suggested file name: `supabase-migrations/20261104_teacher_approval_atomic.sql`. This draft assumes the local schema shown by the current migrations, including `auth.users.banned_until`, catalog `archived_at` fields, and the stated FK/PK names. Confirm each against staging. The migration must be wrapped in `BEGIN`/`COMMIT`; it performs function/trigger DDL only and must not mutate account rows.

### 3.1 Shared lock protocol

Every application role, branch-set, and suspension-status mutation must take the same advisory transaction lock first:

```sql
perform pg_advisory_xact_lock(7710064291::bigint);
```

Then lock Auth user rows in UUID order, followed by the target profile row, selected branch rows in UUID order, staff row, branch assignment rows, and finally audit inserts. The role and suspension paths use the applicable prefix of this order. The old per-branch API writer must be disabled so it cannot bypass this protocol.

The global lock is intentionally conservative for the low-volume administrative operations. It serializes approval, branch replacement, role changes, and database suspension-state changes. The ordered Auth-row locks also serialize these functions against Auth Admin ban updates that modify `auth.users`. All statements inside one RPC run in the same PostgreSQL transaction. Any uncaught error, including an audit insert failure, rolls back all writes from that RPC.

### 3.2 Harden the existing generic role RPC

Replace the function body while retaining the existing signature and service-role-only execute grant. The final reviewed body must:

- Reject NULL/unsupported roles and `p_actor_id = p_target_id`.
- Verify the supplied actor is a Super Admin, is absent from `platform_user_status`, and is not Auth-banned. This RPC remains callable only by trusted server code; its API must derive `p_actor_id` from the verified bearer token, never request JSON.
- Reject Auth-banned or application-suspended targets.
- Reject `p_role IN ('teacher', 'super_admin')`; only the atomic approval RPC may promote teachers, and Super Admin provisioning uses Section 3.9.
- Reject demotion of every existing Super Admin. Preserve the explicit last-Super-Admin error/check.
- Retain the shared advisory lock and audit role changes. Before deleting a teacher staff row (whose FK cascades branch rows), explicitly delete and audit each branch assignment in the same transaction.

The existing signature is `public.set_platform_user_role(uuid, uuid, text) RETURNS void`; `CREATE OR REPLACE` must not broaden its execute ACL. Its exact owner/ACL still requires live verification.

Proposed function body (the API remains the only ordinary caller; it supplies the actor ID only after verifying the bearer token):

```sql
create or replace function public.set_platform_user_role(
  p_actor_id uuid, p_target_id uuid, p_role text
)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_current_role text;
  v_actor_banned_until timestamptz;
  v_target_banned_until timestamptz;
  v_admin_count bigint;
  v_branch_id uuid;
begin
  if p_actor_id is null or p_target_id is null or p_role is null
     or p_role not in ('student', 'teacher', 'super_admin') then
    raise exception 'Unsupported role change.' using errcode = '22023';
  end if;
  if p_actor_id = p_target_id then
    raise exception 'You cannot change your own role.' using errcode = '22023';
  end if;
  if p_role in ('teacher', 'super_admin') then
    raise exception 'This role requires its dedicated trusted provisioning operation.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(7710064291::bigint);
  perform u.id from auth.users u
  where u.id = any(array[p_actor_id, p_target_id])
  order by u.id for update;
  select u.banned_until into v_actor_banned_until
  from auth.users u where u.id = p_actor_id;
  if not found then raise exception 'Actor account not found.' using errcode = '42501'; end if;
  select u.banned_until into v_target_banned_until
  from auth.users u where u.id = p_target_id;
  if not found then raise exception 'Target account not found.' using errcode = 'P0002'; end if;

  if v_actor_banned_until is not null and v_actor_banned_until > now()
     or exists (select 1 from public.platform_user_status where user_id = p_actor_id)
     or not exists (select 1 from public.academic_staff where user_id = p_actor_id and role = 'super_admin') then
    raise exception 'Active Super Admin access is required.' using errcode = '42501';
  end if;
  if (v_target_banned_until is not null and v_target_banned_until > now())
     or exists (select 1 from public.platform_user_status where user_id = p_target_id) then
    raise exception 'Restore the target account before changing its role.' using errcode = '42501';
  end if;

  select s.role into v_current_role
  from public.academic_staff s where s.user_id = p_target_id for update;
  if v_current_role = 'super_admin' and p_role <> 'super_admin' then
    select count(*) into v_admin_count
    from public.academic_staff where role = 'super_admin';
    if v_admin_count <= 1 then
      raise exception 'The last Super Admin cannot be removed.' using errcode = '23514';
    end if;
    raise exception 'Existing Super Admin roles cannot be demoted here.' using errcode = '42501';
  end if;

  if p_role = 'student' then
    -- Audit before staff deletion; the FK otherwise cascades these rows.
    for v_branch_id in
      delete from public.academic_staff_branches
      where user_id = p_target_id returning branch_id
    loop
      insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
      values (p_actor_id, 'branch_unassigned', 'teacher', p_target_id::text,
        jsonb_build_object('branch_id', v_branch_id, 'reason', 'role_changed'));
    end loop;
    delete from public.academic_staff where user_id = p_target_id;
  else
    raise exception 'Only student demotion is supported by this role operation.' using errcode = '22023';
  end if;

  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'role_changed', 'user', p_target_id::text,
    jsonb_build_object('from', coalesce(v_current_role, 'student'), 'to', p_role));
end;
$$;

revoke all on function public.set_platform_user_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_platform_user_role(uuid, uuid, text) to service_role;
```

### 3.3 New atomic approval RPC

The SQL below is a precise design for the new function; validate execution against the actual schema, owner and RLS state before treating it as deployable.

```sql
create or replace function public.approve_teacher_with_branches(
  p_target_id uuid,
  p_branch_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_banned_until timestamptz;
  v_target_banned_until timestamptz;
  v_degree_id uuid;
  v_branch_ids uuid[];
  v_existing_role text;
  v_branch_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Authenticated Super Admin access is required.' using errcode = '42501';
  end if;
  if p_target_id is null or p_target_id = v_actor_id then
    raise exception 'Choose a different registered student.' using errcode = '22023';
  end if;
  if p_branch_ids is null or cardinality(p_branch_ids) = 0
     or array_position(p_branch_ids, null::uuid) is not null then
    raise exception 'At least one branch is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(7710064291::bigint);
  -- Lock actor and target Auth rows deterministically. Auth Admin ban updates
  -- the same rows; the lock makes their state check serialize with approval.
  perform u.id
  from auth.users u
  where u.id = any(array[v_actor_id, p_target_id])
  order by u.id
  for update;

  -- Recheck ALL actor authority after serialization. The pre-lock role check
  -- would race with a concurrent database suspension or role change.
  if not exists (
       select 1 from public.academic_staff s
       where s.user_id = v_actor_id and s.role = 'super_admin'
     )
     or exists (select 1 from public.platform_user_status ps where ps.user_id = v_actor_id) then
    raise exception 'Active Super Admin access is required.' using errcode = '42501';
  end if;

  select banned_until into v_actor_banned_until from auth.users where id = v_actor_id;
  if not found then
    raise exception 'The actor account does not exist.' using errcode = '42501';
  end if;
  select banned_until into v_target_banned_until from auth.users where id = p_target_id;
  if not found then
    raise exception 'The target account does not exist.' using errcode = 'P0002';
  end if;
  if v_actor_banned_until is not null and v_actor_banned_until > now() then
    raise exception 'The actor account is Auth-banned.' using errcode = '42501';
  end if;
  if v_target_banned_until is not null and v_target_banned_until > now() then
    raise exception 'Restore the Auth-banned account before approval.' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_user_status where user_id = p_target_id) then
    raise exception 'Restore the suspended account before approval.' using errcode = '42501';
  end if;

  select p.degree_id into v_degree_id
  from public.academic_profiles p
  where p.user_id = p_target_id
  for update;
  if v_degree_id is null or not exists (
    select 1 from public.academic_degrees d
    where d.id = v_degree_id and d.archived_at is null
  ) then
    raise exception 'The student must have an active selected degree.' using errcode = '23514';
  end if;

  select array_agg(distinct r.branch_id order by r.branch_id)
  into v_branch_ids
  from unnest(p_branch_ids) as r(branch_id);
  -- Lock selected catalog rows in the documented order before validating.
  perform b.id
  from public.academic_branches b
  where b.id = any(v_branch_ids)
  order by b.id
  for update;
  if exists (
    select 1
    from unnest(v_branch_ids) as r(branch_id)
    left join public.academic_branches b
      on b.id = r.branch_id
     and b.degree_id = v_degree_id
     and b.archived_at is null
    where b.id is null
  ) then
    raise exception 'Every branch must be active and belong to the selected degree.' using errcode = '23514';
  end if;

  select s.role into v_existing_role
  from public.academic_staff s
  where s.user_id = p_target_id
  for update;
  if found then
    raise exception 'Only a student account can be approved as a teacher.' using errcode = '23514';
  end if;

  insert into public.academic_staff(user_id, role)
  values (p_target_id, 'teacher');

  for v_branch_id in
    insert into public.academic_staff_branches(user_id, branch_id, assigned_by)
    select p_target_id, r.branch_id, v_actor_id
    from unnest(v_branch_ids) as r(branch_id)
    returning branch_id
  loop
    insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (v_actor_id, 'branch_assigned', 'teacher', p_target_id::text,
      jsonb_build_object('branch_id', v_branch_id));
  end loop;

  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (v_actor_id, 'role_changed', 'user', p_target_id::text,
    jsonb_build_object('from', 'student', 'to', 'teacher', 'branch_ids', to_jsonb(v_branch_ids)));

  return jsonb_build_object('user_id', p_target_id, 'role', 'teacher', 'branch_ids', to_jsonb(v_branch_ids));
end;
$$;
```

Each Auth lookup above checks `FOUND` immediately, so the target lookup cannot overwrite the actor lookup's result. Do not rely on FK failure as account validation.

### 3.4 New atomic branch-set replacement RPC

This RPC is not called by the approval function; approval performs its own role/branch/audit writes. Keeping the functions independent avoids nested ownership and execute-privilege assumptions. Direct authenticated calls are intentionally allowed, but every call rechecks the actor and target.

```sql
create or replace function public.set_teacher_branches(
  p_target_id uuid, p_branch_ids uuid[]
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_banned_until timestamptz;
  v_target_banned_until timestamptz;
  v_degree_id uuid;
  v_branch_ids uuid[];
  v_branch_id uuid;
  v_target_role text;
begin
  if v_actor_id is null or not public.is_super_admin() then
    raise exception 'Active Super Admin access is required.' using errcode = '42501';
  end if;
  if p_target_id is null or p_target_id = v_actor_id then
    raise exception 'Choose a different teacher account.' using errcode = '22023';
  end if;
  if p_branch_ids is null or cardinality(p_branch_ids) = 0
     or array_position(p_branch_ids, null::uuid) is not null then
    raise exception 'At least one branch is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(7710064291::bigint);
  perform u.id from auth.users u
  where u.id = any(array[v_actor_id, p_target_id])
  order by u.id for update;
  select u.banned_until into v_actor_banned_until from auth.users u where u.id = v_actor_id;
  if not found then raise exception 'Actor account not found.' using errcode = '42501'; end if;
  select u.banned_until into v_target_banned_until from auth.users u where u.id = p_target_id;
  if not found then raise exception 'Target account not found.' using errcode = 'P0002'; end if;
  if (v_actor_banned_until is not null and v_actor_banned_until > now())
     or exists (select 1 from public.platform_user_status where user_id = v_actor_id)
     or not exists (select 1 from public.academic_staff where user_id = v_actor_id and role = 'super_admin') then
    raise exception 'Active Super Admin access is required.' using errcode = '42501';
  end if;
  if (v_target_banned_until is not null and v_target_banned_until > now())
     or exists (select 1 from public.platform_user_status where user_id = p_target_id) then
    raise exception 'Restore the target account before changing branches.' using errcode = '42501';
  end if;

  select p.degree_id into v_degree_id
  from public.academic_profiles p where p.user_id = p_target_id for update;
  if not found or v_degree_id is null then
    raise exception 'The teacher must have a selected degree.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.academic_degrees d where d.id = v_degree_id and d.archived_at is null) then
    raise exception 'The selected degree is archived or unavailable.' using errcode = '23514';
  end if;
  select array_agg(distinct r.branch_id order by r.branch_id)
  into v_branch_ids from unnest(p_branch_ids) as r(branch_id);
  perform b.id from public.academic_branches b
  where b.id = any(v_branch_ids) order by b.id for update;
  if exists (
    select 1 from unnest(v_branch_ids) as r(branch_id)
    left join public.academic_branches b
      on b.id = r.branch_id and b.degree_id = v_degree_id and b.archived_at is null
    where b.id is null
  ) then
    raise exception 'Every branch must be active and belong to the selected degree.' using errcode = '23514';
  end if;
  select s.role into v_target_role
  from public.academic_staff s where s.user_id = p_target_id for update;
  if not found or v_target_role <> 'teacher' then
    raise exception 'Only an existing teacher can have branch assignments changed.' using errcode = '23514';
  end if;

  -- Reached only after validating a nonempty complete replacement set.
  for v_branch_id in
    delete from public.academic_staff_branches
    where user_id = p_target_id and branch_id <> all(v_branch_ids)
    returning branch_id
  loop
    insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (v_actor_id, 'branch_unassigned', 'teacher', p_target_id::text,
      jsonb_build_object('branch_id', v_branch_id));
  end loop;
  for v_branch_id in
    insert into public.academic_staff_branches(user_id, branch_id, assigned_by)
    select p_target_id, r.branch_id, v_actor_id
    from unnest(v_branch_ids) as r(branch_id)
    on conflict (user_id, branch_id) do nothing
    returning branch_id
  loop
    insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (v_actor_id, 'branch_assigned', 'teacher', p_target_id::text,
      jsonb_build_object('branch_id', v_branch_id));
  end loop;
  return jsonb_build_object('user_id', p_target_id, 'branch_ids', to_jsonb(v_branch_ids));
end;
$$;
```

### 3.5 New database suspension-state RPC

The function changes only `platform_user_status`; Supabase Auth ban/unban remains an external API operation. It is serialized with teacher approval and writes its audit event in the same DB transaction.

```sql
create or replace function public.set_platform_user_suspension(
  p_target_id uuid, p_suspended boolean, p_reason text default ''
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_banned_until timestamptz;
  v_target_banned_until timestamptz;
  v_has_suspension boolean;
  v_changed boolean := false;
begin
  if v_actor_id is null or not public.is_super_admin() then
    raise exception 'Active Super Admin access is required.' using errcode = '42501';
  end if;
  if p_target_id is null or p_target_id = v_actor_id or p_suspended is null then
    raise exception 'Choose a valid student and suspension action.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(7710064291::bigint);
  perform u.id from auth.users u
  where u.id = any(array[v_actor_id, p_target_id])
  order by u.id for update;
  select u.banned_until into v_actor_banned_until from auth.users u where u.id = v_actor_id;
  if not found then raise exception 'Actor account not found.' using errcode = '42501'; end if;
  select u.banned_until into v_target_banned_until from auth.users u where u.id = p_target_id;
  if not found then raise exception 'Target account not found.' using errcode = 'P0002'; end if;
  if (v_actor_banned_until is not null and v_actor_banned_until > now())
     or exists (select 1 from public.platform_user_status where user_id = v_actor_id)
     or not exists (select 1 from public.academic_staff where user_id = v_actor_id and role = 'super_admin') then
    raise exception 'Active Super Admin access is required.' using errcode = '42501';
  end if;
  if exists (select 1 from public.academic_staff where user_id = p_target_id) then
    raise exception 'Only student accounts can be suspended or restored here.' using errcode = '42501';
  end if;
  select exists(select 1 from public.platform_user_status where user_id = p_target_id)
  into v_has_suspension;

  if p_suspended and not v_has_suspension then
    insert into public.platform_user_status(user_id, suspended_by, reason)
    values (p_target_id, v_actor_id, left(coalesce(p_reason, ''), 500));
    v_changed := true;
    insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (v_actor_id, 'suspend_student', 'user', p_target_id::text, '{}'::jsonb);
  elsif not p_suspended and v_has_suspension then
    if v_target_banned_until is not null and v_target_banned_until > now() then
      raise exception 'Auth unban must complete before restoring database access.' using errcode = '42501';
    end if;
    delete from public.platform_user_status where user_id = p_target_id;
    v_changed := true;
    insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (v_actor_id, 'restore_student', 'user', p_target_id::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('user_id', p_target_id, 'suspended', p_suspended, 'changed', v_changed);
end;
$$;
```

### 3.6 Executable integrity triggers and lock behavior

These trigger definitions use the columns established by the local academic/RBAC migrations. They enforce: a committed teacher has at least one branch; each assignment belongs to an active branch of the teacher's active selected degree; an assigned teacher cannot change/delete that degree; an assigned branch cannot be archived/reclassified; and a degree cannot be archived while it has active branches or teacher dependencies. A teacher degree transfer is intentionally unsupported; demote, update the profile, then use the atomic approval flow under a separately reviewed operation.

**Lock ordering:** The three RPCs take the shared advisory lock, then Auth rows sorted by UUID, profile, branch catalog rows sorted by UUID, staff/assignment rows, and audit writes. The trigger guards below do not take the advisory lock after a row has already been locked by a direct profile/catalog UPDATE; doing so would invert the order and risk deadlock. Instead, the assignment guard locks profile then branch (`FOR SHARE`); profile degree edits serialize on the profile row; branch catalog edits serialize on the branch row; and degree archive serializes on the degree row. On conflict, the losing statement re-reads the committed row under READ COMMITTED and rejects invalid state. Direct `academic_staff_branches` writes are revoked from `service_role` in this proposal; all supported assignment mutations use the RPC lock protocol. The staging race tests in Section 8 are mandatory.

```sql
create or replace function public.guard_teacher_branch_assignment()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_degree_id uuid;
  v_role text;
  v_branch_degree uuid;
  v_branch_archived timestamptz;
  v_degree_archived timestamptz;
begin
  if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id
                           or new.branch_id is distinct from old.branch_id) then
    raise exception 'Assignment identity changes must use delete and insert through the managed RPC.' using errcode = '22023';
  end if;
  -- FOR UPDATE on the profile serializes assignment creation with profile edits.
  select p.degree_id into v_degree_id
  from public.academic_profiles p where p.user_id = new.user_id for update;
  if not found or v_degree_id is null then
    raise exception 'Teacher must have a selected degree.' using errcode = '23514';
  end if;
  select s.role into v_role from public.academic_staff s
  where s.user_id = new.user_id for update;
  if not found or v_role <> 'teacher' then
    raise exception 'Branch assignments are allowed only for teachers.' using errcode = '23514';
  end if;
  select b.degree_id, b.archived_at, d.archived_at
    into v_branch_degree, v_branch_archived, v_degree_archived
  from public.academic_branches b
  join public.academic_degrees d on d.id = b.degree_id
  where b.id = new.branch_id for share of b, d;
  if not found or v_branch_archived is not null or v_degree_archived is not null
     or v_branch_degree is distinct from v_degree_id then
    raise exception 'Branch must be active and belong to the teacher degree.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.assert_teacher_has_branch()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_user_id uuid;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Role and assignment identity keys cannot be changed in place.' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
  else
    v_user_id := new.user_id;
  end if;
  if exists (select 1 from public.academic_staff s where s.user_id = v_user_id and s.role = 'teacher')
     and not exists (select 1 from public.academic_staff_branches sb where sb.user_id = v_user_id) then
    raise exception 'A teacher must retain at least one branch assignment.' using errcode = '23514';
  end if;
  return null;
end;
$$;

create or replace function public.guard_teacher_profile_degree()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.academic_staff s join public.academic_staff_branches sb using (user_id)
               where s.user_id = old.user_id and s.role = 'teacher') then
      raise exception 'A teacher with branch assignments cannot lose the academic profile.' using errcode = '23514';
    end if;
    return old;
  end if;
  if new.degree_id is distinct from old.degree_id
     and exists (select 1 from public.academic_staff s join public.academic_staff_branches sb using (user_id)
                 where s.user_id = old.user_id and s.role = 'teacher') then
    raise exception 'Change the teacher degree only through a reviewed reassignment workflow.' using errcode = '23514';
  end if;
  if new.degree_id is not null and not exists (
      select 1 from public.academic_degrees d where d.id = new.degree_id and d.archived_at is null
  ) then
    raise exception 'Selected degree must be active.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_assigned_branch_catalog()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if (new.degree_id is distinct from old.degree_id or (old.archived_at is null and new.archived_at is not null))
     and exists (select 1 from public.academic_staff_branches sb where sb.branch_id = old.id) then
    raise exception 'A branch with teacher assignments cannot be archived or reclassified.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_branch_active_degree()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  -- Share-locking the parent serializes branch creation/reclassification with
  -- degree archival. It also prevents new active branches under archived degrees.
  perform 1 from public.academic_degrees d
  where d.id = new.degree_id and d.archived_at is null for share;
  if not found then
    raise exception 'A branch must belong to an active degree.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_assigned_degree_archive()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if old.archived_at is null and new.archived_at is not null
     and (exists (select 1 from public.academic_branches b where b.degree_id = old.id and b.archived_at is null)
       or exists (select 1 from public.academic_profiles p join public.academic_staff s using (user_id)
                  where p.degree_id = old.id and s.role = 'teacher')
       or exists (select 1 from public.academic_staff_branches sb join public.academic_branches b on b.id = sb.branch_id
                  where b.degree_id = old.id)) then
    raise exception 'A degree with active branches or teacher dependencies cannot be archived.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists teacher_branch_assignment_guard on public.academic_staff_branches;
create trigger teacher_branch_assignment_guard before insert or update on public.academic_staff_branches
for each row execute function public.guard_teacher_branch_assignment();

drop trigger if exists teacher_staff_branch_count_check on public.academic_staff;
create constraint trigger teacher_staff_branch_count_check after insert or update on public.academic_staff
deferrable initially deferred for each row execute function public.assert_teacher_has_branch();
drop trigger if exists teacher_assignment_branch_count_check on public.academic_staff_branches;
create constraint trigger teacher_assignment_branch_count_check after insert or update or delete on public.academic_staff_branches
deferrable initially deferred for each row execute function public.assert_teacher_has_branch();

drop trigger if exists teacher_profile_degree_guard on public.academic_profiles;
create trigger teacher_profile_degree_guard before update or delete on public.academic_profiles
for each row execute function public.guard_teacher_profile_degree();
drop trigger if exists assigned_branch_catalog_guard on public.academic_branches;
create trigger assigned_branch_catalog_guard before update on public.academic_branches
for each row execute function public.guard_assigned_branch_catalog();
drop trigger if exists branch_active_degree_guard on public.academic_branches;
create trigger branch_active_degree_guard before insert or update of degree_id on public.academic_branches
for each row execute function public.guard_branch_active_degree();
drop trigger if exists assigned_degree_archive_guard on public.academic_degrees;
create trigger assigned_degree_archive_guard before update on public.academic_degrees
for each row execute function public.guard_assigned_degree_archive();
drop trigger if exists teacher_profile_branch_count_check on public.academic_profiles;
create constraint trigger teacher_profile_branch_count_check after update or delete on public.academic_profiles
deferrable initially deferred for each row execute function public.assert_teacher_has_branch();
```

The trigger functions must be owned by the verified `postgres` migration/function owner, with fixed search paths. Their execution privilege is not an application API: revoke direct `EXECUTE` from `PUBLIC`, `anon`, `authenticated`, and `service_role` after trigger creation. Trigger-owner reads must still work with the actual `FORCE ROW LEVEL SECURITY` state. Before final migration approval, run the definitions against a disposable clone and confirm deferred-trigger semantics for multi-row replacement and role demotion. **Do not apply them if the installed PostgreSQL version or target schema differs.**

### 3.7 Execute privileges

```sql
revoke all on function public.approve_teacher_with_branches(uuid, uuid[]) from public, anon, service_role;
revoke all on function public.set_teacher_branches(uuid, uuid[]) from public, anon, service_role;
revoke all on function public.set_platform_user_suspension(uuid, boolean, text) from public, anon, service_role;
grant execute on function public.approve_teacher_with_branches(uuid, uuid[]) to authenticated;
grant execute on function public.set_teacher_branches(uuid, uuid[]) to authenticated;
grant execute on function public.set_platform_user_suspension(uuid, boolean, text) to authenticated;
```

Keep the generic `set_platform_user_role(uuid,uuid,text)` execute grant restricted to `service_role`. Verify `PUBLIC`, `anon`, `authenticated`, and `service_role` effective privileges after migration. The API must call the three new RPCs with a user-scoped client carrying the verified bearer token; a service-role call has no authenticated `auth.uid()` and should fail. No RLS policy is added, removed, or weakened.

### 3.8 Migration assembly, ownership, and final table ACLs

The migration file is one transaction. Assemble it in this exact order: `BEGIN`; replacement body and ACL for `set_platform_user_role` (3.2); approval RPC (3.3); branch replacement RPC (3.4); suspension RPC (3.5); trigger functions/triggers (3.6); ownership and final ACL statements below; `COMMIT`. Do not split the role guard from disabling legacy writers. This DDL performs no row backfill or user-data mutation. On any error, PostgreSQL rolls the transaction back.

The expected owner is the trusted `postgres` database role, **only after staging confirms that role exists and the migration operator is authorized to assign ownership**. Never assign a function or either role table to `service_role`. Use these final statements after creating/replacing all functions; preflight must verify whether `postgres` has the required rights and whether any function is currently owned by a different role. If either role table is owned by `service_role`, stop: ordinary ACL revocation cannot remove an owner's inherent table privileges. Prepare a separately reviewed ownership change rather than claiming the direct-write boundary is closed.

```sql
alter function public.set_platform_user_role(uuid, uuid, text) owner to postgres;
alter function public.approve_teacher_with_branches(uuid, uuid[]) owner to postgres;
alter function public.set_teacher_branches(uuid, uuid[]) owner to postgres;
alter function public.set_platform_user_suspension(uuid, boolean, text) owner to postgres;
alter function public.guard_teacher_branch_assignment() owner to postgres;
alter function public.assert_teacher_has_branch() owner to postgres;
alter function public.guard_teacher_profile_degree() owner to postgres;
alter function public.guard_assigned_branch_catalog() owner to postgres;
alter function public.guard_assigned_degree_archive() owner to postgres;
alter function public.guard_branch_active_degree() owner to postgres;

revoke all on function public.set_platform_user_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_platform_user_role(uuid, uuid, text) to service_role;
revoke all on function public.approve_teacher_with_branches(uuid, uuid[]) from public, anon, service_role;
revoke all on function public.set_teacher_branches(uuid, uuid[]) from public, anon, service_role;
revoke all on function public.set_platform_user_suspension(uuid, boolean, text) from public, anon, service_role;
grant execute on function public.approve_teacher_with_branches(uuid, uuid[]) to authenticated;
grant execute on function public.set_teacher_branches(uuid, uuid[]) to authenticated;
grant execute on function public.set_platform_user_suspension(uuid, boolean, text) to authenticated;

revoke all on function public.guard_teacher_branch_assignment() from public, anon, authenticated, service_role;
revoke all on function public.assert_teacher_has_branch() from public, anon, authenticated, service_role;
revoke all on function public.guard_teacher_profile_degree() from public, anon, authenticated, service_role;
revoke all on function public.guard_assigned_branch_catalog() from public, anon, authenticated, service_role;
revoke all on function public.guard_assigned_degree_archive() from public, anon, authenticated, service_role;
revoke all on function public.guard_branch_active_degree() from public, anon, authenticated, service_role;

-- Keep required reads for existing server-side list/report operations, but
-- remove service-role direct role/assignment mutations. Definer functions
-- owned by postgres perform the narrowly scoped writes.
revoke insert, update, delete, truncate, references, trigger
  on public.academic_staff, public.academic_staff_branches from service_role;
grant select on public.academic_staff, public.academic_staff_branches to service_role;
```

The trigger functions are invoked by triggers, not application RPCs. Confirm the target PostgreSQL version accepts the function/trigger forms and ownership changes. `SECURITY DEFINER` does not itself bypass `FORCE ROW LEVEL SECURITY`: either the verified owner must have effective `BYPASSRLS`, or the migration must stop for a reviewed least-privilege RLS/ownership design. Do not use `row_security = off` as a bypass workaround. The functions need table privileges for their mutations; the chosen owner must have them. `platform_audit_logs` has RLS and no ordinary authenticated insert policy in local migrations, so verify the definer can insert audit rows and that `platform_user_status` reads/writes work. Confirm effective grants after commit, including inherited role memberships and `PUBLIC` defaults.

The staged SQL test must prove that an injected failure in every audit insert aborts the enclosing RPC and leaves no role/branch/status mutation. The Auth ban/unban is outside the SQL transaction and is recovered by the API protocol in Sections 4 and 9.

### 3.9 One trusted Super Admin provisioning procedure

There is no application role picker or generic RPC for creating a Super Admin. The **only** provisioning path is a manually reviewed SQL transaction run by the designated database operator after out-of-band two-person approval. It applies both to initial bootstrap and later additions. It refuses to overwrite an existing staff role, records a durable audit row, and does not expose a PostgREST function. For initial bootstrap, `actor_id` is NULL because no Super Admin exists; the operator UUID and approval reference are retained in metadata. Later provisioning records the active Super Admin operator as `actor_id`.

```sql
begin;
do $provision$
declare
  v_target uuid := '00000000-0000-0000-0000-000000000000'; -- reviewed Auth UUID
  v_operator uuid := '11111111-1111-1111-1111-111111111111'; -- operator identity
  v_approval_ref text := 'CHANGE-0000'; -- two-person approval record
  v_admin_count bigint;
  v_actor uuid;
begin
  perform pg_advisory_xact_lock(7710064291::bigint);
  perform u.id from auth.users u
  where u.id = any(array[v_target, v_operator]) order by u.id for update;
  if not exists (select 1 from auth.users where id = v_target) then
    raise exception 'Target Auth account does not exist.';
  end if;
  if exists (select 1 from public.academic_staff where user_id = v_target) then
    raise exception 'Target already has a staff role; provisioning will not overwrite it.';
  end if;
  if exists (select 1 from auth.users where id = v_target and banned_until > now())
     or exists (select 1 from public.platform_user_status where user_id = v_target) then
    raise exception 'Suspended or Auth-banned accounts cannot be provisioned.';
  end if;
  select count(*) into v_admin_count from public.academic_staff where role = 'super_admin';
  if v_admin_count > 0 then
    if not exists (select 1 from public.academic_staff where user_id = v_operator and role = 'super_admin')
       or exists (select 1 from public.platform_user_status where user_id = v_operator)
       or exists (select 1 from auth.users where id = v_operator and banned_until > now()) then
      raise exception 'A current active Super Admin operator is required.';
    end if;
    v_actor := v_operator;
  else
    v_actor := null; -- audited bootstrap; operator is recorded below
  end if;
  insert into public.academic_staff(user_id, role) values (v_target, 'super_admin');
  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'super_admin_provisioned', 'user', v_target::text,
    jsonb_build_object('operator_id', v_operator, 'approval_ref', v_approval_ref,
      'bootstrap', v_admin_count = 0));
end;
$provision$;
commit;
```

This is an operator procedure, not something to run during this documentation task. Before use, independently verify the target account/email against the UUID and preserve the approval record. Revoke/avoid service API/UI actions that assign `super_admin`; do not invoke `set_platform_user_role` for that role. The migration must not run this provisioning block.

## 4. API implementation plan

Expected files: `api/admin.js`, optionally a small server helper, and `src/lib/adminApi.js` only if a request helper is useful.

### 4.1 Existing writer inventory and trusted boundary

Static repository inventory (not a live deployment inventory):

| Writer | Current path | Required disposition |
|---|---|---|
| `api/admin.js` `set_role` | Uses service-role `admin.rpc("set_platform_user_role", ...)`; SQL function inserts/updates/deletes `academic_staff` and deletes branch rows on non-teacher changes. | Keep only student demotion. API rejects `teacher` and `super_admin`; hardened SQL RPC independently rejects both. |
| `api/admin.js` `teacher_branch` | Direct service-role `academic_staff_branches.upsert/delete`, followed by API `writeAudit`. | Remove both write paths. Replace with the single `set_teacher_branches` user-scoped RPC; reject all legacy action payloads. |
| `api/admin.js` user/teacher/dashboard reads | Reads staff and branch rows with service role. | Keep read-only. Check every query error; no inferred empty role/assignment state. |
| Manual bootstrap in `docs/RBAC-OPERATIONS.md` | SQL `insert ... on conflict do update` into `academic_staff`, currently no audit event. | Retire that snippet and replace it with Section 3.9's explicit two-person, audited SQL procedure. |
| React `App.jsx`, Academic Hub, Admin Dashboard | Read role/profile; UI calls `/api/admin`. No direct client staff/assignment writes found. | Keep reads; remove ordinary Super Admin role selection and single-branch controls. |
| Other application/API source | Static `rg` inventory found no other `academic_staff` or `academic_staff_branches` writer. | Repeat repository-wide writer search at implementation time, including scripts/functions not included in this checkout. |

Local migrations grant `ALL` on both role tables to `service_role`; the service key has powerful server privileges and is a root of trust. The migration proposal revokes service-role INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on these tables while retaining SELECT. The `postgres`-owned definer functions become the only routine runtime writer; the manual operator transaction is the only Super Admin provisioning exception. This control is effective only if staging verifies the table owner, role memberships, grants, definer ownership and no alternate service-role credentials/writer. A leaked service secret or database owner remains privileged and cannot be constrained by UI checks.

1. Verify every caller bearer token with Auth. Load caller role from `academic_staff`; check both `platform_user_status` and Auth `banned_until`. Only an active Super Admin may use these actions.
2. Extend the users response with registered name/email, role, status, academic degree, and assigned branch IDs/names. Fail the request if role/status/branch lookups fail; never infer “student/no branches” from an integration error.
3. Add `approve_teacher` requiring target ID and a nonempty branch UUID array. Verify target exists, is not Auth-banned, has no suspension row, has no staff role, and has an active selected degree. Use a user-scoped client and call `approve_teacher_with_branches` once. Do not call `set_role` then `teacher_branch`.
4. Replace `teacher_branch` with a complete-set `set_teacher_branches` action using one user-scoped RPC; remove the old one-branch upsert/delete implementation and reject legacy requests. The RPC validates everything and logs the branch delta.
5. Make `set_role` accept only `student` (demotion) and reject both `teacher` and `super_admin` unconditionally. Reject Auth-banned/suspended targets; retain self-change rejection. Existing Super Admin rows are untouched by deployment. New Super Admins use only the Section 3.9 operator transaction; the UI exposes no Super Admin promotion action.
6. Route role-change audit through the existing database function. Do not call `writeAudit` for role/branch events already written inside RPCs.
7. Suspension order: **suspend:** call `set_platform_user_suspension(..., true)` first, then Auth ban. If the Auth call fails, keep the database suspension and return an explicit partial-completion error with a retry/reconciliation path. **Restore:** Auth unban first, then call `set_platform_user_suspension(..., false)`. If the database call fails, leave its suspension row in place and report retry required. The DB lock/status record prevents portal access during the handoff. Do not report full success until both steps succeed. The RPC writes the audit event; remove the current API-side suspension `writeAudit` call to prevent duplicates.
8. If Auth API requests time out, reconcile Auth state and the status row before retrying. Make suspension calls idempotent and audit only actual state transitions.
9. Apply active-account checks to every authenticated API route (including existing AI and PDF handlers), checking the database suspension state and Auth ban status. The app shell must also fail closed while activity/role verification is pending or unavailable.

### 4.2 Legacy mutation shutdown and rollout ordering

1. **Compatibility shutdown release first:** make `/api/admin` reject `set_role` for `teacher` and `super_admin`, reject `teacher_branch` entirely, and remove/disable the corresponding UI controls. Keep user/teacher reads available. This release deliberately makes approval/reassignment unavailable and performs no write through the old path.
2. Confirm all deployed API instances serve the shutdown behavior and search all server code for direct staff/branch writes. Do not start the SQL migration while an old endpoint can still mutate assignments.
3. Apply the complete migration to disposable staging after independent approval. It removes service-role table mutation grants and adds the guarded RPCs/triggers. Verify no direct writes remain and the RPCs work through authenticated caller context.
4. Deploy the new API/UI release. It calls one RPC per approval/replacement/suspension-state transition; it never falls back to legacy writes. If the RPC is unavailable, return an error and make no write.
5. Repeat the endpoint/writer search against the deployed build and logs before enabling production use. This staged order favors a temporary admin feature outage over a split-version unsafe mutation window.

## 5. User Management UI plan

Expected files: `src/components/AdminDashboard/AdminDashboard.jsx`, its CSS module, and optionally a focused approval dialog.

- Show Name, registered Email, Current Role, Account Status, selected Degree, Assigned Branches, and row actions.
- Student row action opens the teacher approval flow. Select active branches filtered to the student's selected degree; require one or more. A missing/inactive degree or failed query blocks approval with a clear explanation.
- Before submission, show a confirmation summary with name/email, current role/status, selected degree, and every branch. Require explicit confirmation.
- Submit one `approve_teacher` action. Pending disables duplicate submits; success refreshes user/teacher rows and shows confirmation; failure retains selections and shows a retryable error.
- Replace one-at-a-time branch chips with a full branch-set editor for existing teachers. Require one or more active same-degree branches and confirm the replacement before calling the API once.
- Replace immediate role selection with explicit role-change actions. Existing Super Admin rows are visibly protected and offer no demotion action. Teacher promotion is available only through the branch-confirmation workflow. The UI has no Super Admin creation action; all new Super Admin provisioning uses only the operator procedure in Section 3.9.
- Suspension/restore states should distinguish database suspension from an Auth operation awaiting retry; do not display “Active” until both systems agree.

## 6. Data and policy impact

### Migration-time

No account/data rows are to be changed. The migration replaces function definitions and ACLs and creates new functions only. Do not edit, delete, backfill, or normalize student, teacher, branch, suspension, audit, or Super Admin rows during migration. Do not modify RLS policies.

### Runtime

A successful approval writes a teacher role row, one or more branch rows, one role audit entry, and branch-assignment audit entries atomically. A successful replacement updates only that teacher's branch set and audit delta. Suspension changes one student status row and an audit event in a database transaction; Auth ban state is coordinated by API but not transactionally coupled.

Existing branchless/cross-degree teachers may exist. The preflight must list them by user ID and current assignments only. Do not modify them automatically. Resolve only through a separately approved branch-set operation after confirming the selected profile degree. Existing Super Admin accounts/roles are unchanged by migration application; management-path demotions are blocked after the guard is installed.

### Policies

No RLS changes are proposed. Verify current policies and grants compose with function ownership. `academic_staff` and `academic_staff_branches` browser writes must remain denied. New function grants provide a narrow authenticated call surface whose checks are enforced inside the function. If live RLS/owner privileges prevent the definer from reading/writing required rows or audit rows, stop and submit a separate least-privilege policy/ownership proposal; do not weaken RLS ad hoc.

## 7. Staging preflight SQL checklist (read-only; do not run against production)

These are inspection examples for a known non-production project. They are not migration statements.

### Columns and constraints

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('academic_profiles','academic_degrees','academic_branches',
    'academic_staff','academic_staff_branches','platform_user_status','platform_audit_logs')
order by table_name, ordinal_position;

select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until';

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

### RLS, owners, function security and grants

```sql
select n.nspname, c.relname, r.rolname as table_owner,
       r.rolbypassrls, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_roles r on r.oid = c.relowner
where n.nspname = 'public'
  and c.relname in ('academic_profiles','academic_degrees','academic_branches',
    'academic_staff','academic_staff_branches','platform_user_status','platform_audit_logs')
order by c.relname;

select p.oid::regprocedure as function_signature, owner.rolname as function_owner,
       owner.rolbypassrls, p.prosecdef as security_definer,
       p.proconfig, coalesce(grantee.rolname, 'PUBLIC') as grantee,
       acl.privilege_type, acl.is_grantable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles owner on owner.oid = p.proowner
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles grantee on grantee.oid = acl.grantee
where n.nspname = 'public'
  and p.proname in ('set_platform_user_role','is_current_user_active','is_super_admin',
    'approve_teacher_with_branches','set_teacher_branches','set_platform_user_suspension')
order by function_signature;

select * from pg_policies
where schemaname = 'public'
  and tablename in ('academic_profiles','academic_degrees','academic_branches',
    'academic_staff','academic_staff_branches','platform_user_status','platform_audit_logs')
order by tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('academic_staff','academic_staff_branches','platform_user_status','platform_audit_logs')
order by table_name, grantee, privilege_type;

select r.rolname, r.rolsuper, r.rolbypassrls,
       pg_has_role('service_role', r.oid, 'member') as inherited_by_service_role
from pg_roles r
where r.rolname in ('postgres','service_role','authenticated','anon','public')
order by r.rolname;

select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner,
       p.proacl, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('set_platform_user_role','approve_teacher_with_branches',
    'set_teacher_branches','set_platform_user_suspension',
    'guard_teacher_branch_assignment','assert_teacher_has_branch',
    'guard_teacher_profile_degree','guard_assigned_branch_catalog',
    'guard_assigned_degree_archive');
```

### Legacy data and suspension consistency (IDs only)

```sql
select s.user_id, p.degree_id, count(sb.branch_id) as assigned_branch_count,
       count(*) filter (where b.id is null or b.archived_at is not null
                         or b.degree_id is distinct from p.degree_id) as invalid_assignment_count
from public.academic_staff s
left join public.academic_profiles p on p.user_id = s.user_id
left join public.academic_staff_branches sb on sb.user_id = s.user_id
left join public.academic_branches b on b.id = sb.branch_id
where s.role = 'teacher'
group by s.user_id, p.degree_id
having count(sb.branch_id) = 0
    or count(*) filter (where b.id is null or b.archived_at is not null
                         or b.degree_id is distinct from p.degree_id) > 0;

select u.id as user_id, u.banned_until, (s.user_id is not null) as has_status_suspension
from auth.users u
left join public.platform_user_status s on s.user_id = u.id
where (u.banned_until is not null and u.banned_until > now())
   <> (s.user_id is not null)
order by u.id;

select role, count(*) from public.academic_staff group by role order by role;
select count(*) as super_admin_count from public.academic_staff where role = 'super_admin';
```

The `auth.users.banned_until` field and query permissions must be confirmed first. Query output is sensitive; keep it in approved staging, do not export emails/tokens, and do not use it to mutate rows.

## 8. Security test matrix

| Caller/target/scenario | Expected result |
|---|---|
| Anonymous calls any new RPC/API | Denied; no writes/audits |
| Student or teacher calls approval/branch/suspension RPC directly | Denied by `auth.uid()` + active Super Admin check |
| Suspended or Auth-banned Super Admin with a still-valid JWT | Denied by status and `auth.users.banned_until` checks |
| Active Super Admin directly calls approval RPC for eligible student with 1+ same-degree branches | Success; role, branches, audit events commit together |
| Empty/null branch list, unknown/archived/cross-degree branch, missing degree | Denied; no role, assignment, or audit changes |
| Auth-banned/suspended target, existing staff target, self-target | Denied; no writes |
| Inject failure during assignment insert or any audit insert | Entire RPC rolls back |
| Direct old `set_role` API or service RPC requests teacher role | Denied; approval RPC required |
| Direct old `teacher_branch` API request | Rejected; no single-branch writes/deletes |
| Branch replacement with valid nonempty set | Only delta is applied; matching audit rows are committed |
| Branch replacement with empty/invalid set | Denied before delete; existing assignments remain |
| Two concurrent approvals/reassignments/role changes/suspensions | Shared lock serializes; no branchless approved teacher or duplicate role transition |
| Suspend concurrent with approval | Shared lock + Auth row lock produces a serial outcome; suspended target is not approved after suspension commits |
| Suspend the acting Super Admin while approval waits for the shared lock | Approval rechecks role, DB suspension and Auth ban after both locks; denied with no writes |
| Profile degree change races with approval or branch replacement | Profile row lock serializes; either the profile update commits first and RPC validates against new degree, or the change is rejected for an already assigned teacher |
| Assigned branch archive/reclassification races with branch replacement | Branch-row lock serializes; one operation rejects if the other commits an incompatible assignment; no archived/cross-degree branch remains assigned |
| Degree archive races with branch creation/teacher assignment | Degree/catalog lock and guard serialize; archive is rejected while active branches/dependencies exist, and later assignment rejects archived degree |
| Authenticated or service-role direct INSERT/UPDATE/DELETE on role tables after migration | Browser denied by grants/RLS; service role denied by table ACL; only RPC/operator path can write |
| Service role attempts generic RPC `teacher` or `super_admin` | Both denied; no staff or assignment rows change |
| Trusted Super Admin SQL provisioning | Target must be Auth-existing, unsuspended and have no staff role; audited event includes operator/approval reference; failed audit rolls back role insert |
| Existing Super Admin demotion by UI/API/generic RPC | Denied; all existing Super Admin role rows unchanged |
| Last Super Admin demotion | Denied by explicit guard |
| Role/branch/suspension success | One event per actual transition; API adds no duplicate audit row |
| Direct REST writes to staff/branch/status/audit tables as authenticated | Denied by existing grants/RLS |

Run failure injection and concurrency tests only in disposable staging. Test the new functions through PostgREST with student, teacher, active Super Admin, platform-suspended Super Admin, Auth-banned Super Admin, and Auth-banned target identities. Failure injection should use a temporary staging-only trigger that raises on a chosen audit action and must be removed in the same disposable environment; never add this test trigger to the proposal migration or production. For race tests, use two independent database sessions and barriers so each interleaving is reproducible. Include the lock-waiting suspended-actor scenario explicitly.

## 9. Rollout, rollback and recovery

### Pre-deployment

1. Identify non-production target and compare actual schema, function definitions/owners/ACLs, RLS/grants, Auth ban field and migration order using the read-only checklist above.
2. Report branchless/cross-degree teachers and Auth/status suspension mismatches by ID only. Do not modify those records.
3. Save current role function definition/ACL for review and confirm at least two trusted Super Admins exist.
4. Prepare API/UI in a disabled state that rejects legacy teacher promotion and branch mutation. Keep approval disabled until migration is installed.
5. Inventory server-side role-table writers and validate that the planned service-role ACL revocation will not break any remaining legitimate caller. Confirm the trusted operator provisioning path and audit reference format with the institution.

### Staging migration and rollout

1. Apply the reviewed migration only to disposable/non-production staging after separate approval; verify its transaction, function owners, ACLs, and no data changes.
2. Verify authenticated direct table writes fail, service-role direct DML fails, service-role read/list calls still work, and RPC definer writes/audit inserts succeed under the observed RLS/FORCE RLS configuration.
3. Test teacher assignment/profile/catalog race cases and audit-failure rollback with disposable identities and two sessions.
4. Deploy the compatibility shutdown to staging first, then migration, then the RPC-backed API/UI. Enable the new UI only after the RPC/ACL checks pass.
5. Never leave old `set_role: teacher` or one-branch `teacher_branch` handlers available in a rollout gap. If the RPC is missing, return unavailable and make no writes.

### Failure and rollback

- A migration DDL failure should roll back function/ACL changes in the migration transaction. Inspect migration state and function ACLs before retrying.
- On application rollback, disable approval, branch-set, and suspension actions first. Retain the SQL guard that rejects generic teacher promotion and Super Admin demotion. Do not restore the old unsafe role/branch endpoints.
- Dropping new RPCs does not remove teacher or branch rows created after rollout. Do not cascade/drop account data as rollback.
- For an uncertain request, refresh the authoritative role, branch set, Auth ban and platform status as Super Admin before retrying. Database role/branch/audit state from each RPC is atomic; the Auth ban remains an external operation reconciled using the sequencing rules.
- To retry a failed suspension ban, keep the DB status row in place and retry Auth ban. To retry restoration, leave DB status in place until Auth unban succeeds, then retry status removal. Do not show Active until both systems agree.
- Any emergency database restoration must be a reviewed forward migration that retains the no-branchless-approval, no-Super-Admin-demotion, active-account, and audit guards. Never restore the legacy teacher promotion path.
- Do not restore service-role direct DML grants on `academic_staff` or `academic_staff_branches` as an application rollback. If an operational repair is necessary, use the designated database operator with a reviewed, audited transaction and retain a record of the affected IDs and approval reference.

## 10. Implementation order and remaining gates

1. Complete staging preflight and verify actual definer owner/RLS/audit behavior.
2. Ship the compatibility shutdown first: reject legacy teacher/Super Admin role changes and disable the old one-branch endpoint/UI.
3. Finalize SQL syntax and function ACLs; validate Auth-ban field and lock protocol against the actual Supabase version/schema.
4. Apply only to disposable staging after separate approval; run direct RPC, direct-write denial, failure-injection, concurrency, audit, and legacy-data tests.
5. Implement the RPC-backed API and confirmation/branch-set UI; retain the disabled state if any RPC or ACL check fails.
6. Update suspension API ordering and add portal-shell active-status gating; test all APIs and PostgREST/Storage active-account enforcement.
7. Recheck existing accounts and confirm no migration-time user rows or RLS policies changed; only then prepare a separately approved production rollout.

The source document `ROLE_VERIFICATION_AUDIT.md` remains absent; the source findings above are based on the current repository review. The migration snippets are a proposed single-transaction artifact and have not been syntax-checked against a live server. No SQL or live database verification has been performed. **Status: READY FOR FINAL REVIEW only. This is not approval to implement, execute, apply, or deploy.** Staging schema, function ownership/ACLs, RLS/FORCE RLS behavior, and the listed race/failure tests remain mandatory gates before implementation or migration approval.
