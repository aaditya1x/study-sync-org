-- Teacher approval security migration draft.
--
-- STATUS: REVIEW/STAGING DRAFT ONLY. DO NOT RUN until all BLOCKERS below
-- are resolved and an authorized operator separately approves staging use.
-- This file was not executed or syntax-tested against a live Supabase project.
-- It performs DDL/ACL changes only; it does not backfill or mutate account rows.
-- It intentionally does not alter any RLS policy.
--
-- BLOCKERS TO CLEAR BEFORE EXECUTION:
-- 1. Local migrations do not define auth.users.banned_until. Verify its exact
--    presence/type/meaning on the staging Auth schema. If absent/different,
--    stop and revise every reference below; do not omit Auth-ban enforcement.
-- 2. Verify `postgres` exists, is the approved function/table owner, has the
--    required table privileges, and bypasses RLS as required. Verify
--    relforcerowsecurity=false or an approved, safe definer model. Do not
--    weaken RLS to make these functions work.
-- 3. Ship the API compatibility shutdown before applying this migration:
--    old teacher_branch writes and direct suspension-status writes bypass the
--    shared locking/audit protocol. This package does not change API/UI code.
-- 4. Verify actual staging schema, migration history, grants, RLS policies,
--    function owners/ACLs, existing triggers, and table ownership first.
-- 5. Report (do not modify) pre-existing branchless/cross-degree teachers.
--    Decide a separately approved repair path before enabling role invariants.
--
-- Based on local schema in 20261031_phase1_academic_hub.sql,
-- 20261101_phase1_academic_admin_hardening.sql, and
-- 20261102_super_admin_rbac.sql. Use only after that schema is confirmed.

begin;

-- Generic management is demotion-only. It cannot create teachers or admins.
create or replace function public.set_platform_user_role(
  p_actor_id uuid,
  p_target_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
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
    raise exception 'Use the dedicated approval/provisioning path for this role.' using errcode = '22023';
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

  if (v_actor_banned_until is not null and v_actor_banned_until > now())
     or exists (select 1 from public.platform_user_status where user_id = p_actor_id)
     or not exists (
       select 1 from public.academic_staff
       where user_id = p_actor_id and role = 'super_admin'
     ) then
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

  if p_role <> 'student' then
    raise exception 'Only student demotion is supported by this operation.' using errcode = '22023';
  end if;

  for v_branch_id in
    delete from public.academic_staff_branches
    where user_id = p_target_id returning branch_id
  loop
    insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (p_actor_id, 'branch_unassigned', 'teacher', p_target_id::text,
      jsonb_build_object('branch_id', v_branch_id, 'reason', 'role_changed'));
  end loop;
  delete from public.academic_staff where user_id = p_target_id;

  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'role_changed', 'user', p_target_id::text,
    jsonb_build_object('from', coalesce(v_current_role, 'student'), 'to', 'student'));
end;
$$;

-- One authenticated transaction for promotion + all branch rows + audit.
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
  perform u.id from auth.users u
  where u.id = any(array[v_actor_id, p_target_id])
  order by u.id for update;

  -- Recheck all actor state only after both serialization locks.
  if not exists (
       select 1 from public.academic_staff s
       where s.user_id = v_actor_id and s.role = 'super_admin'
     )
     or exists (select 1 from public.platform_user_status where user_id = v_actor_id) then
    raise exception 'Active Super Admin access is required.' using errcode = '42501';
  end if;
  select u.banned_until into v_actor_banned_until
  from auth.users u where u.id = v_actor_id;
  if not found then raise exception 'Actor account not found.' using errcode = '42501'; end if;
  select u.banned_until into v_target_banned_until
  from auth.users u where u.id = p_target_id;
  if not found then raise exception 'Target account not found.' using errcode = 'P0002'; end if;
  if v_actor_banned_until is not null and v_actor_banned_until > now() then
    raise exception 'The actor account is Auth-banned.' using errcode = '42501';
  end if;
  if v_target_banned_until is not null and v_target_banned_until > now()
     or exists (select 1 from public.platform_user_status where user_id = p_target_id) then
    raise exception 'Restore the target account before approval.' using errcode = '42501';
  end if;

  select p.degree_id into v_degree_id
  from public.academic_profiles p where p.user_id = p_target_id for update;
  if not found or v_degree_id is null then
    raise exception 'The student must have an active selected degree.' using errcode = '23514';
  end if;
  perform 1 from public.academic_degrees d
  where d.id = v_degree_id and d.archived_at is null for share;
  if not found then
    raise exception 'The student must have an active selected degree.' using errcode = '23514';
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

  select s.role into v_existing_role
  from public.academic_staff s where s.user_id = p_target_id for update;
  if found then
    raise exception 'Only a student account can be approved as a teacher.' using errcode = '23514';
  end if;

  insert into public.academic_staff(user_id, role) values (p_target_id, 'teacher');
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

-- Atomic complete-set replacement; empty/invalid sets fail before deletes.
create or replace function public.set_teacher_branches(
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
  v_branch_id uuid;
  v_target_role text;
begin
  if v_actor_id is null or p_target_id is null or p_target_id = v_actor_id then
    raise exception 'Active Super Admin and a different target are required.' using errcode = '42501';
  end if;
  if p_branch_ids is null or cardinality(p_branch_ids) = 0
     or array_position(p_branch_ids, null::uuid) is not null then
    raise exception 'At least one branch is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(7710064291::bigint);
  perform u.id from auth.users u
  where u.id = any(array[v_actor_id, p_target_id]) order by u.id for update;
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
    raise exception 'The teacher must have an active selected degree.' using errcode = '23514';
  end if;
  perform 1 from public.academic_degrees d
  where d.id = v_degree_id and d.archived_at is null for share;
  if not found then
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

-- Database half of the API-coordinated suspension state machine.
create or replace function public.set_platform_user_suspension(
  p_target_id uuid,
  p_suspended boolean,
  p_reason text default ''
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
  v_has_suspension boolean;
  v_changed boolean := false;
begin
  if v_actor_id is null or p_target_id is null or p_target_id = v_actor_id or p_suspended is null then
    raise exception 'Active Super Admin, target, and action are required.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(7710064291::bigint);
  perform u.id from auth.users u
  where u.id = any(array[v_actor_id, p_target_id]) order by u.id for update;
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
    raise exception 'Only student accounts can be suspended or restored by this operation.' using errcode = '42501';
  end if;
  select exists (select 1 from public.platform_user_status where user_id = p_target_id)
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

-- Every write to a relationship/catalog table takes the shared advisory lock
-- before PostgreSQL locks rows for the statement. Managed RPCs take it first
-- as well. Direct transaction code must not lock these rows before its DML;
-- a statement trigger cannot undo locks already taken by its caller.
create or replace function public.lock_teacher_catalog_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(7710064291::bigint);
  return null; -- ignored for a statement-level trigger
end;
$$;

-- Integrity: assignments always match an active teacher profile degree.
create or replace function public.guard_teacher_branch_assignment()
returns trigger
language plpgsql
security definer
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
    raise exception 'Assignment identity changes require delete/insert through the managed path.' using errcode = '22023';
  end if;
  select p.degree_id into v_degree_id
  from public.academic_profiles p where p.user_id = new.user_id for update;
  if not found or v_degree_id is null then
    raise exception 'Teacher must have a selected degree.' using errcode = '23514';
  end if;
  -- Lock order after the shared advisory lock: profile -> degree -> branch -> staff.
  select d.archived_at into v_degree_archived
  from public.academic_degrees d where d.id = v_degree_id for share;
  if not found or v_degree_archived is not null then
    raise exception 'Teacher degree must be active.' using errcode = '23514';
  end if;
  select b.degree_id, b.archived_at
    into v_branch_degree, v_branch_archived
  from public.academic_branches b where b.id = new.branch_id for share;
  if not found or v_branch_archived is not null
     or v_branch_degree is distinct from v_degree_id then
    raise exception 'Branch must be active and belong to the teacher degree.' using errcode = '23514';
  end if;
  select s.role into v_role from public.academic_staff s
  where s.user_id = new.user_id for update;
  if not found or v_role <> 'teacher' then
    raise exception 'Branch assignments are allowed only for teachers.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.assert_teacher_has_branch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_user_id uuid;
begin
  if tg_op = 'DELETE' then v_user_id := old.user_id; else v_user_id := new.user_id; end if;
  if exists (select 1 from public.academic_staff s where s.user_id = v_user_id and s.role = 'teacher')
     and not exists (select 1 from public.academic_staff_branches sb where sb.user_id = v_user_id) then
    raise exception 'A teacher must retain at least one branch assignment.' using errcode = '23514';
  end if;
  return null;
end;
$$;

create or replace function public.guard_teacher_profile_degree()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Statement-level lock is acquired before this profile row is changed.
  -- Profile degree validation then locks the selected degree in the shared
  -- order (profile -> degree), serializing it with degree archival.
  if tg_op = 'INSERT' then
    -- Existing profile setup permits degree_id NULL while onboarding. When a
    -- degree is supplied, require it to exist and remain active through commit.
    if new.degree_id is not null then
      perform 1 from public.academic_degrees d
      where d.id = new.degree_id and d.archived_at is null for share;
      if not found then
        raise exception 'Selected degree must be active.' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.academic_staff s join public.academic_staff_branches sb using (user_id)
               where s.user_id = old.user_id and s.role = 'teacher') then
      raise exception 'A teacher with assignments cannot lose the academic profile.' using errcode = '23514';
    end if;
    return old;
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'Academic profile ownership cannot be changed.' using errcode = '22023';
  end if;
  if new.degree_id is distinct from old.degree_id
     and exists (select 1 from public.academic_staff s join public.academic_staff_branches sb using (user_id)
                 where s.user_id = old.user_id and s.role = 'teacher') then
    raise exception 'Teacher degree changes require a separately reviewed reassignment workflow.' using errcode = '23514';
  end if;
  if new.degree_id is not null then
    perform 1 from public.academic_degrees d
    where d.id = new.degree_id and d.archived_at is null for share;
    if not found then
      raise exception 'Selected degree must be active.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_assigned_branch_catalog()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (new.degree_id is distinct from old.degree_id
      or (old.archived_at is null and new.archived_at is not null))
     and exists (select 1 from public.academic_staff_branches sb where sb.branch_id = old.id) then
    raise exception 'A branch with teacher assignments cannot be archived or reclassified.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_branch_active_degree()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- The statement-level advisory lock is held before the branch row lock.
  -- Validate every INSERT that creates an active branch and every update that
  -- changes degree_id or archived_at. In particular, reactivation validates
  -- NEW.degree_id so a combined reclassification/unarchive cannot bypass this.
  if new.archived_at is not null then
    return new;
  end if;
  perform 1 from public.academic_degrees d
  where d.id = new.degree_id and d.archived_at is null for share;
  if not found then raise exception 'A branch must belong to an active degree.' using errcode = '23514'; end if;
  return new;
end;
$$;

create or replace function public.guard_assigned_degree_archive()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.archived_at is null and new.archived_at is not null
     and (exists (select 1 from public.academic_branches b where b.degree_id = old.id and b.archived_at is null)
       or exists (select 1 from public.academic_profiles p join public.academic_staff s using (user_id)
                  where p.degree_id = old.id and s.role = 'teacher')
       or exists (select 1 from public.academic_staff_branches sb
                  join public.academic_branches b on b.id = sb.branch_id where b.degree_id = old.id)) then
    raise exception 'A degree with active branches or teacher dependencies cannot be archived.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists teacher_branch_assignment_guard on public.academic_staff_branches;
drop trigger if exists teacher_catalog_lock_profiles on public.academic_profiles;
create trigger teacher_catalog_lock_profiles before insert or update or delete on public.academic_profiles
for each statement execute function public.lock_teacher_catalog_mutation();
drop trigger if exists teacher_catalog_lock_degrees on public.academic_degrees;
create trigger teacher_catalog_lock_degrees before insert or update or delete on public.academic_degrees
for each statement execute function public.lock_teacher_catalog_mutation();
drop trigger if exists teacher_catalog_lock_branches on public.academic_branches;
create trigger teacher_catalog_lock_branches before insert or update or delete on public.academic_branches
for each statement execute function public.lock_teacher_catalog_mutation();
drop trigger if exists teacher_catalog_lock_assignments on public.academic_staff_branches;
create trigger teacher_catalog_lock_assignments before insert or update or delete on public.academic_staff_branches
for each statement execute function public.lock_teacher_catalog_mutation();
drop trigger if exists teacher_catalog_lock_staff on public.academic_staff;
create trigger teacher_catalog_lock_staff before insert or update or delete on public.academic_staff
for each statement execute function public.lock_teacher_catalog_mutation();
create trigger teacher_branch_assignment_guard before insert or update on public.academic_staff_branches
for each row execute function public.guard_teacher_branch_assignment();
drop trigger if exists teacher_staff_branch_count_check on public.academic_staff;
create constraint trigger teacher_staff_branch_count_check after insert or update on public.academic_staff
deferrable initially deferred for each row execute function public.assert_teacher_has_branch();
drop trigger if exists teacher_assignment_branch_count_check on public.academic_staff_branches;
create constraint trigger teacher_assignment_branch_count_check after insert or update or delete on public.academic_staff_branches
deferrable initially deferred for each row execute function public.assert_teacher_has_branch();
drop trigger if exists teacher_profile_degree_guard on public.academic_profiles;
create trigger teacher_profile_degree_guard before insert or update or delete on public.academic_profiles
for each row execute function public.guard_teacher_profile_degree();
drop trigger if exists teacher_profile_branch_count_check on public.academic_profiles;
create constraint trigger teacher_profile_branch_count_check after update or delete on public.academic_profiles
deferrable initially deferred for each row execute function public.assert_teacher_has_branch();
drop trigger if exists assigned_branch_catalog_guard on public.academic_branches;
create trigger assigned_branch_catalog_guard before update on public.academic_branches
for each row execute function public.guard_assigned_branch_catalog();
drop trigger if exists branch_active_degree_guard on public.academic_branches;
drop trigger if exists branch_active_degree_insert_guard on public.academic_branches;
drop trigger if exists branch_active_degree_update_guard on public.academic_branches;
create trigger branch_active_degree_insert_guard before insert on public.academic_branches
for each row execute function public.guard_branch_active_degree();
drop trigger if exists branch_active_degree_update_guard on public.academic_branches;
create trigger branch_active_degree_update_guard before update of degree_id, archived_at on public.academic_branches
for each row execute function public.guard_branch_active_degree();
drop trigger if exists assigned_degree_archive_guard on public.academic_degrees;
create trigger assigned_degree_archive_guard before update on public.academic_degrees
for each row execute function public.guard_assigned_degree_archive();

-- Function ownership is explicit. Execution halts if postgres/privileges do
-- not match verified staging facts; no RLS policy is changed here.
alter function public.set_platform_user_role(uuid, uuid, text) owner to postgres;
alter function public.approve_teacher_with_branches(uuid, uuid[]) owner to postgres;
alter function public.set_teacher_branches(uuid, uuid[]) owner to postgres;
alter function public.set_platform_user_suspension(uuid, boolean, text) owner to postgres;
alter function public.lock_teacher_catalog_mutation() owner to postgres;
alter function public.guard_teacher_branch_assignment() owner to postgres;
alter function public.assert_teacher_has_branch() owner to postgres;
alter function public.guard_teacher_profile_degree() owner to postgres;
alter function public.guard_assigned_branch_catalog() owner to postgres;
alter function public.guard_branch_active_degree() owner to postgres;
alter function public.guard_assigned_degree_archive() owner to postgres;

revoke all on function public.set_platform_user_role(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_platform_user_role(uuid, uuid, text) to service_role;
revoke all on function public.approve_teacher_with_branches(uuid, uuid[]) from public, anon, service_role;
revoke all on function public.set_teacher_branches(uuid, uuid[]) from public, anon, service_role;
revoke all on function public.set_platform_user_suspension(uuid, boolean, text) from public, anon, service_role;
revoke all on function public.lock_teacher_catalog_mutation() from public, anon, authenticated, service_role;
grant execute on function public.approve_teacher_with_branches(uuid, uuid[]) to authenticated;
grant execute on function public.set_teacher_branches(uuid, uuid[]) to authenticated;
grant execute on function public.set_platform_user_suspension(uuid, boolean, text) to authenticated;
revoke all on function public.guard_teacher_branch_assignment() from public, anon, authenticated, service_role;
revoke all on function public.assert_teacher_has_branch() from public, anon, authenticated, service_role;
revoke all on function public.guard_teacher_profile_degree() from public, anon, authenticated, service_role;
revoke all on function public.guard_assigned_branch_catalog() from public, anon, authenticated, service_role;
revoke all on function public.guard_branch_active_degree() from public, anon, authenticated, service_role;
revoke all on function public.guard_assigned_degree_archive() from public, anon, authenticated, service_role;

-- Remove service-role direct mutations of role/branch/suspension-state data.
-- The API currently reads the role tables, but directly writes branch rows
-- and suspension rows; shut those handlers down before applying this block.
revoke insert, update, delete, truncate, references, trigger
  on public.academic_staff, public.academic_staff_branches, public.platform_user_status
  from service_role;
-- TRUNCATE does not fire INSERT/UPDATE/DELETE triggers (including statement
-- triggers above), and TRUNCATE CASCADE can remove dependent rows without the
-- row-level audit path. Deny it to browser/service roles on every protected
-- relationship, catalog, status, and audit table. Table owners/superusers
-- remain privileged and must be excluded from application credentials.
revoke truncate on public.academic_profiles, public.academic_degrees,
  public.academic_branches, public.academic_staff, public.academic_staff_branches,
  public.platform_user_status, public.platform_audit_logs
  from public, anon, authenticated, service_role;
grant select on public.academic_staff, public.academic_staff_branches, public.platform_user_status
  to service_role;

commit;
