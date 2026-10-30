-- REVIEW ONLY — NOT APPROVED FOR EXECUTION.
-- Companion: docs/TEACHER_SUSPENSION_RESTORATION_DESIGN.md
-- No live schema/owner/RLS/Auth verification or runtime testing has been done.
-- Requires review against the exact Supabase/PostgreSQL version and local
-- migration 20261104_teacher_approval_atomic.sql before any staging approval.
-- This draft adds durable operation history and fenced RPCs; it does not alter
-- existing RLS policies or enable any Admin UI action.
-- Operation rows hold mutable current state; operation_events are append-only
-- transition history. Dispatch authorization is durable and never leased
-- or automatically reset. A lost token leaves an operator-reconciliation gate.

begin;

create table public.platform_user_suspension_operations (
  operation_id uuid primary key,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  generation bigint not null check (generation > 0),
  desired_suspended boolean not null,
  resolved_suspended boolean,
  resolution_kind text check (resolution_kind is null or resolution_kind in ('requested','operator_override')),
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_by_principal name,
  state text not null check (state in ('pending','reconciliation_required','completed')),
  phase text not null check (phase in ('claimed','dispatch_authorized','auth_confirmed','finalized')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text not null default '' check (char_length(reason) <= 500),
  auth_observed_banned boolean,
  -- Returned only by the one successful dispatch-authorization RPC call.
  -- Retained while dispatch is unresolved; cleared after auth_confirmed or
  -- reconciliation_required. Direct table reads are revoked.
  dispatch_token uuid,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 100),
  evidence_reference text check (evidence_reference is null or char_length(evidence_reference) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (target_user_id, generation),
  unique (operation_id, generation),
  check ((state = 'completed') = (completed_at is not null)),
  check ((state = 'completed') = (resolved_suspended is not null)),
  check (state <> 'completed' or auth_observed_banned is not distinct from resolved_suspended),
  check ((state = 'completed') = (resolution_kind is not null)),
  check (coalesce(resolution_kind = 'operator_override',false) = (resolved_by is not null)),
  check (coalesce(resolution_kind = 'operator_override',false) = (resolved_by_principal is not null)),
  check (resolution_kind is null or resolution_kind <> 'requested' or resolved_suspended = desired_suspended),
  check (state <> 'completed' or phase = 'finalized'),
  check (state <> 'reconciliation_required' or phase = 'dispatch_authorized'),
  check ((state = 'pending' and phase = 'dispatch_authorized') = (dispatch_token is not null))
);

create unique index platform_user_suspension_one_open_operation
  on public.platform_user_suspension_operations(target_user_id)
  where state in ('pending','reconciliation_required');
create unique index platform_user_suspension_dispatch_token_once
  on public.platform_user_suspension_operations(dispatch_token)
  where dispatch_token is not null;
create index platform_user_suspension_recovery_idx
  on public.platform_user_suspension_operations(state, updated_at)
  where state in ('pending','reconciliation_required');

create table public.platform_user_suspension_operation_events (
  event_id bigint generated always as identity primary key,
  operation_id uuid not null references public.platform_user_suspension_operations(operation_id) on delete restrict,
  generation bigint not null,
  transition text not null check (transition in ('claimed','auth_dispatch_authorized','auth_confirmed','reconciliation_required','finalized')),
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (operation_id, transition),
  foreign key (operation_id, generation)
    references public.platform_user_suspension_operations(operation_id, generation) on delete restrict
);

-- Maps a dedicated, individually attributable database login to the human
-- operator's Auth UUID. Populate only through a separately reviewed DBA
-- procedure. Never map a shared API/PostgREST login. The login must not be
-- usable by application endpoints or ordinary Supabase API roles.
create table public.platform_user_suspension_operator_principals (
  database_principal name primary key check (database_principal not in
    ('authenticator','service_role','authenticated','anon','postgres','suspension_reconciler')),
  operator_id uuid not null references auth.users(id) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (operator_id)
);

-- The definer owner must own these tables (or receive equivalent narrowly
-- reviewed DML privileges). Verify postgres exists/has BYPASSRLS and that the
-- migration executor may transfer ownership before considering application.
alter table public.platform_user_suspension_operations owner to postgres;
alter table public.platform_user_suspension_operation_events owner to postgres;
alter table public.platform_user_suspension_operator_principals owner to postgres;

alter table public.platform_user_suspension_operations enable row level security;
alter table public.platform_user_suspension_operation_events enable row level security;
alter table public.platform_user_suspension_operator_principals enable row level security;
revoke all on public.platform_user_suspension_operations,
  public.platform_user_suspension_operation_events,
  public.platform_user_suspension_operator_principals from public, anon, authenticated, service_role;

-- State-transition deduplication in the existing durable audit ledger.
-- Index creation must be checked for existing matching metadata before use.
create unique index platform_audit_suspension_transition_once
  on public.platform_audit_logs
    ((metadata ->> 'suspension_operation_id'), (metadata ->> 'transition'))
  where action in ('suspend_student','restore_student','suspension_reconciled')
    and metadata ? 'suspension_operation_id'
    and metadata ? 'transition';

create or replace function public.claim_platform_user_suspension(
  p_operation_id uuid,
  p_target_id uuid,
  p_desired_suspended boolean,
  p_reason text default ''
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.platform_user_suspension_operations%rowtype;
  v_generation bigint;
  v_has_latch boolean;
  v_latch_inserted boolean := false;
begin
  if v_actor is null or p_operation_id is null or p_target_id is null or p_target_id=v_actor or p_desired_suspended is null then
    raise exception 'Authenticated actor, operation ID, target and direction are required.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(7710064291::bigint);
  perform pg_advisory_xact_lock(hashtextextended(p_target_id::text, 55001));
  perform u.id from auth.users u where u.id = any(array[v_actor,p_target_id]) order by u.id for update;
  if not exists (select 1 from auth.users where id=v_actor)
     or exists (select 1 from auth.users where id=v_actor and banned_until > now())
     or exists (select 1 from public.platform_user_status where user_id=v_actor)
     or not exists (select 1 from public.academic_staff where user_id=v_actor and role='super_admin') then
    raise exception 'Active Super Admin access is required.' using errcode='42501';
  end if;
  if not exists (select 1 from auth.users where id=p_target_id) then
    raise exception 'Target account not found.' using errcode='P0002';
  end if;
  select * into v_existing from public.platform_user_suspension_operations
    where operation_id=p_operation_id for update;
  if found then
    if v_existing.actor_id <> v_actor or v_existing.target_user_id <> p_target_id or v_existing.desired_suspended <> p_desired_suspended
       or v_existing.reason <> left(coalesce(p_reason,''),500) then
      raise exception 'Operation ID was already used with different inputs.' using errcode='22023';
    end if;
    return jsonb_build_object('operation_id',v_existing.operation_id,'generation',v_existing.generation,
      'state',v_existing.state,'phase',v_existing.phase,'desired_suspended',v_existing.desired_suspended,
      'resolved_suspended',v_existing.resolved_suspended,'resolution_kind',v_existing.resolution_kind);
  end if;
  if exists (select 1 from public.academic_staff where user_id=p_target_id) then
    raise exception 'Only student accounts can use this operation.' using errcode='42501';
  end if;
  if exists (select 1 from public.platform_user_suspension_operations
             where target_user_id=p_target_id and state in ('pending','reconciliation_required')) then
    raise exception 'Another suspension operation requires completion or reconciliation.' using errcode='23505';
  end if;
  select coalesce(max(generation),0)+1 into v_generation
    from public.platform_user_suspension_operations where target_user_id=p_target_id;
  select exists(select 1 from public.platform_user_status where user_id=p_target_id)
    into v_has_latch;

  if p_desired_suspended and not v_has_latch then
    insert into public.platform_user_status(user_id,suspended_by,reason)
    values (p_target_id,v_actor,left(coalesce(p_reason,''),500));
    v_latch_inserted := true;
  end if;

  -- Restoration always arms/retains the DB latch before Auth is called. This
  -- also repairs a legacy Auth-ban/DB-status mismatch without opening access.
  if not p_desired_suspended and not v_has_latch then
    insert into public.platform_user_status(user_id,suspended_by,reason)
      values (p_target_id,v_actor,'Restore pending; access held until Auth confirmation.');
    v_has_latch := true;
    v_latch_inserted := true;
  end if;

  insert into public.platform_user_suspension_operations(
    operation_id,target_user_id,generation,desired_suspended,state,phase,actor_id,reason
  ) values (p_operation_id,p_target_id,v_generation,p_desired_suspended,'pending','claimed',v_actor,left(coalesce(p_reason,''),500));
  insert into public.platform_user_suspension_operation_events(operation_id,generation,transition)
    values (p_operation_id,v_generation,'claimed');
  if v_latch_inserted then
    insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
      values (v_actor,'suspend_student','user',p_target_id::text,
        jsonb_build_object('suspension_operation_id',p_operation_id,'transition','suspend','generation',v_generation,
          'desired_suspended',p_desired_suspended,'resolved_suspended',null,'resolution_kind',null,
          'latch_reason',case when p_desired_suspended then 'requested_suspension' else 'protective_restore_latch' end));
  end if;
  return jsonb_build_object('operation_id',p_operation_id,'generation',v_generation,'state','pending','phase','claimed',
    'desired_suspended',p_desired_suspended,'resolved_suspended',null,'resolution_kind',null);
end;
$$;

-- Dispatch authorization is service-role-only so its one-time token cannot be
-- obtained by a browser calling an authenticated PostgREST RPC directly. The
-- API must verify the bearer JWT and supply that verified actor ID internally.
drop function if exists public.authorize_platform_user_suspension_auth_dispatch(uuid,bigint);
create or replace function public.authorize_platform_user_suspension_auth_dispatch(
  p_actor_id uuid,p_operation_id uuid,p_generation bigint
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_actor uuid := p_actor_id; v_op public.platform_user_suspension_operations%rowtype; v_target uuid; v_dispatch_token uuid;
begin
  if v_actor is null or p_operation_id is null or p_generation is null then
    raise exception 'Verified actor, operation and generation are required.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(7710064291::bigint);
  select target_user_id into v_target from public.platform_user_suspension_operations
    where operation_id=p_operation_id and generation=p_generation;
  if not found then raise exception 'Stale or unknown operation generation.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_target::text,55001));
  perform u.id from auth.users u where u.id=any(array[v_actor,v_target]) order by u.id for update;
  select * into v_op from public.platform_user_suspension_operations
    where operation_id=p_operation_id and generation=p_generation for update;
  if not found then raise exception 'Stale or unknown operation generation.' using errcode='P0002'; end if;
  if not exists(select 1 from public.academic_staff where user_id=v_actor and role='super_admin')
     or exists(select 1 from public.platform_user_status where user_id=v_actor)
     or exists(select 1 from auth.users where id=v_actor and banned_until > now()) then
    raise exception 'Active Super Admin access is required.' using errcode='42501';
  end if;
  if v_op.actor_id <> v_actor then
    raise exception 'Verified actor does not match operation actor.' using errcode='42501';
  end if;
  if v_op.state <> 'pending' then
    raise exception 'Only a pending operation can authorize Auth dispatch.' using errcode='23514';
  end if;
  if v_op.phase <> 'claimed' then
    -- A repeat never returns or creates another dispatch token.
    return jsonb_build_object('authorized',false,'operation_id',p_operation_id,'generation',p_generation,'state',v_op.state,'phase',v_op.phase);
  end if;
  v_dispatch_token := gen_random_uuid();
  update public.platform_user_suspension_operations set phase='dispatch_authorized',dispatch_token=v_dispatch_token,updated_at=now()
    where operation_id=p_operation_id and generation=p_generation and state='pending' and phase='claimed';
  if not found then raise exception 'Dispatch authorization lost a concurrent transition.' using errcode='40001'; end if;
  insert into public.platform_user_suspension_operation_events(operation_id,generation,transition)
    values (p_operation_id,p_generation,'auth_dispatch_authorized');
  return jsonb_build_object('authorized',true,'operation_id',p_operation_id,'generation',p_generation,'dispatch_token',v_dispatch_token);
end;
$$;

create or replace function public.record_platform_user_suspension_phase(
  p_operation_id uuid,p_generation bigint,p_phase text,p_dispatch_token uuid,
  p_auth_observed_banned boolean default null,p_error_code text default null
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_actor uuid := auth.uid(); v_op public.platform_user_suspension_operations%rowtype; v_target uuid;
begin
  if v_actor is null or p_phase is null or p_phase not in ('auth_confirmed','reconciliation_required') or p_dispatch_token is null then
    raise exception 'Invalid operation phase.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(7710064291::bigint);
  select target_user_id into v_target from public.platform_user_suspension_operations where operation_id=p_operation_id;
  if not found then raise exception 'Unknown operation.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_target::text,55001));
  perform u.id from auth.users u where u.id=any(array[v_actor,v_target]) order by u.id for update;
  select * into v_op from public.platform_user_suspension_operations
   where operation_id=p_operation_id and generation=p_generation for update;
  if not found then raise exception 'Stale or unknown operation generation.' using errcode='P0002'; end if;
  if not exists(select 1 from public.academic_staff where user_id=v_actor and role='super_admin')
     or exists(select 1 from public.platform_user_status where user_id=v_actor)
     or exists(select 1 from auth.users where id=v_actor and banned_until > now()) then
    raise exception 'Active Super Admin access is required.' using errcode='42501';
  end if;
  if v_op.actor_id <> v_actor then
    raise exception 'Actor does not match operation actor.' using errcode='42501';
  end if;
  if v_op.state='reconciliation_required' then
    raise exception 'Reconciliation-required operations cannot be changed through the normal API.' using errcode='42501';
  end if;
  if v_op.state='completed' then
    return jsonb_build_object('operation_id',p_operation_id,'generation',p_generation,'state',v_op.state,
      'phase',v_op.phase,'desired_suspended',v_op.desired_suspended,'resolved_suspended',v_op.resolved_suspended,
      'resolution_kind',v_op.resolution_kind);
  end if;
  if p_phase='auth_confirmed' then
    if v_op.phase <> 'dispatch_authorized' or p_dispatch_token is null
       or v_op.dispatch_token is distinct from p_dispatch_token
       or p_auth_observed_banned is distinct from v_op.desired_suspended then
      raise exception 'Auth state confirmation does not match this operation.' using errcode='23514';
    end if;
    update public.platform_user_suspension_operations set phase='auth_confirmed',state='pending',
      auth_observed_banned=p_auth_observed_banned,dispatch_token=null,last_error_code=null,updated_at=now()
      where operation_id=p_operation_id and generation=p_generation and state='pending' and phase='dispatch_authorized';
    if not found then raise exception 'Operation phase changed concurrently.' using errcode='40001'; end if;
  elsif p_phase='reconciliation_required' then
    if v_op.phase <> 'dispatch_authorized' or p_dispatch_token is null
       or v_op.dispatch_token is distinct from p_dispatch_token then
      raise exception 'Only the authorized handler may mark its ambiguous dispatch for reconciliation.' using errcode='42501';
    end if;
    update public.platform_user_suspension_operations set state='reconciliation_required',
      dispatch_token=null,last_error_code=left(p_error_code,100),updated_at=now()
      where operation_id=p_operation_id and generation=p_generation and state='pending' and phase='dispatch_authorized';
    if not found then raise exception 'Operation phase changed concurrently.' using errcode='40001'; end if;
  else
    raise exception 'Unsupported phase transition.' using errcode='22023';
  end if;
  insert into public.platform_user_suspension_operation_events(operation_id,generation,transition,event_data)
    values (p_operation_id,p_generation,p_phase,jsonb_build_object('error_code',left(p_error_code,100),'auth_banned',p_auth_observed_banned));
  return jsonb_build_object('operation_id',p_operation_id,'generation',p_generation,'state',
    case when p_phase='reconciliation_required' then 'reconciliation_required' else 'pending' end,'phase',p_phase,
    'desired_suspended',v_op.desired_suspended,'resolved_suspended',null,'resolution_kind',null);
end;
$$;

create or replace function public.finalize_platform_user_suspension(
  p_operation_id uuid,p_generation bigint,p_auth_banned_confirmed boolean
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_actor uuid := auth.uid(); v_op public.platform_user_suspension_operations%rowtype;
  v_target uuid; v_target_banned_until timestamptz;
begin
  if v_actor is null or p_auth_banned_confirmed is null then raise exception 'Confirmation is required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(7710064291::bigint);
  select target_user_id into v_target from public.platform_user_suspension_operations where operation_id=p_operation_id;
  if not found then raise exception 'Unknown operation.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_target::text,55001));
  perform u.id from auth.users u where u.id=any(array[v_actor,v_target]) order by u.id for update;
  select * into v_op from public.platform_user_suspension_operations
    where operation_id=p_operation_id and generation=p_generation for update;
  if not found then raise exception 'Stale or unknown operation generation.' using errcode='P0002'; end if;
  if not exists(select 1 from public.academic_staff where user_id=v_actor and role='super_admin')
     or exists(select 1 from public.platform_user_status where user_id=v_actor)
     or exists(select 1 from auth.users where id=v_actor and banned_until > now()) then
    raise exception 'Active Super Admin access is required.' using errcode='42501';
  end if;
  if v_op.actor_id <> v_actor then
    raise exception 'Actor does not match operation actor.' using errcode='42501';
  end if;
  if v_op.state='completed' then return jsonb_build_object('operation_id',p_operation_id,'generation',p_generation,
    'state','completed','desired_suspended',v_op.desired_suspended,'resolved_suspended',v_op.resolved_suspended,
    'resolution_kind',v_op.resolution_kind,'replayed',true); end if;
  select banned_until into v_target_banned_until from auth.users where id=v_target;
  if not found then raise exception 'Target Auth account not found.' using errcode='P0002'; end if;
  -- Never trust the caller's assertion alone. Read the effective Auth row state.
  if (v_target_banned_until is not null and v_target_banned_until > now()) is distinct from p_auth_banned_confirmed then
    raise exception 'Auth state does not match the caller confirmation.' using errcode='23514';
  end if;
  if v_op.state <> 'pending' or v_op.phase <> 'auth_confirmed'
     or v_op.auth_observed_banned is distinct from v_op.desired_suspended
     or p_auth_banned_confirmed is distinct from v_op.desired_suspended then
    raise exception 'Operation lacks matching confirmed Auth state.' using errcode='23514';
  end if;
  if v_op.desired_suspended then
    if not exists(select 1 from public.platform_user_status where user_id=v_op.target_user_id) then
      raise exception 'Suspension latch is missing; refusing completion.' using errcode='23514';
    end if;
  else
    if not exists(select 1 from public.platform_user_status where user_id=v_op.target_user_id) then
      raise exception 'Restoration latch is unexpectedly missing.' using errcode='23514';
    end if;
    delete from public.platform_user_status where user_id=v_op.target_user_id;
    insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values (v_actor,'restore_student','user',v_op.target_user_id::text,
      jsonb_build_object('suspension_operation_id',p_operation_id,'transition','restore','generation',p_generation,
        'desired_suspended',false,'resolved_suspended',false,'resolution_kind','requested'));
  end if;
  update public.platform_user_suspension_operations set state='completed',phase='finalized',
    resolved_suspended=v_op.desired_suspended,resolution_kind='requested',
    completed_at=now(),updated_at=now(),last_error_code=null where operation_id=p_operation_id;
  insert into public.platform_user_suspension_operation_events(operation_id,generation,transition,event_data)
    values (p_operation_id,p_generation,'finalized',jsonb_build_object(
      'desired_suspended',v_op.desired_suspended,'resolved_suspended',v_op.desired_suspended,
      'resolution_kind','requested'));
  return jsonb_build_object('operation_id',p_operation_id,'generation',p_generation,'state','completed',
    'desired_suspended',v_op.desired_suspended,'resolved_suspended',v_op.desired_suspended,
    'resolution_kind','requested','replayed',false);
end;
$$;

-- Operator-only reconciliation. It derives the human audit identity from the
-- dedicated database login in session_user; caller-supplied UUIDs are never
-- accepted. The evidence reference is an audit pointer, not authorization.
-- Operators must independently establish Auth state and that no old request
-- can still complete; a DB observation alone is not a request fence.
create or replace function public.reconcile_platform_user_suspension(
  p_operation_id uuid,p_generation bigint,p_auth_banned_confirmed boolean,
  p_evidence_reference text,p_resolution text
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_op public.platform_user_suspension_operations%rowtype; v_target_banned_until timestamptz;
  v_target uuid; v_operator uuid; v_resolved_suspended boolean; v_old_latch boolean;
begin
  if p_auth_banned_confirmed is null or p_resolution is null
     or nullif(btrim(p_evidence_reference),'') is null or char_length(p_evidence_reference) > 200
     or p_resolution not in ('keep_suspended','restore_active') then
    raise exception 'Confirmed Auth state, evidence reference and resolution are required.' using errcode='22023';
  end if;
  if not pg_has_role(session_user,'suspension_reconciler','member') then
    raise exception 'Dedicated reconciliation database principal required.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(7710064291::bigint);
  select m.operator_id into v_operator
    from public.platform_user_suspension_operator_principals m
    where m.database_principal=session_user and m.enabled
    for share;
  if not found then raise exception 'Database principal is not mapped to an enabled operator.' using errcode='42501'; end if;
  select target_user_id into v_target from public.platform_user_suspension_operations where operation_id=p_operation_id;
  if not found then raise exception 'Unknown operation.' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_target::text,55001));
  perform u.id from auth.users u where u.id=any(array[v_operator,v_target]) order by u.id for update;
  select * into v_op from public.platform_user_suspension_operations
    where operation_id=p_operation_id and generation=p_generation for update;
  if not found then
    raise exception 'Operation is not eligible for reconciliation.' using errcode='P0002';
  end if;
  v_resolved_suspended := p_resolution='keep_suspended';
  if p_auth_banned_confirmed is distinct from v_resolved_suspended then
    raise exception 'Auth state does not match resolved outcome.' using errcode='23514';
  end if;
  if v_op.state='completed' then
    if v_op.resolution_kind='operator_override'
       and v_op.resolved_by=v_operator
       and v_op.resolved_by_principal=session_user
       and v_op.evidence_reference=left(p_evidence_reference,200)
       and v_op.resolved_suspended=v_resolved_suspended
       and v_op.auth_observed_banned=p_auth_banned_confirmed then
      return jsonb_build_object('operation_id',p_operation_id,'generation',p_generation,'state','completed',
        'desired_suspended',v_op.desired_suspended,'resolved_suspended',v_op.resolved_suspended,
        'resolution_kind',v_op.resolution_kind,'resolution',p_resolution,'replayed',true);
    end if;
    raise exception 'Completed operation cannot be reconciled with different evidence or outcome.' using errcode='23514';
  end if;
  if v_op.state not in ('pending','reconciliation_required') then
    raise exception 'Operation is not eligible for reconciliation.' using errcode='P0002';
  end if;
  select banned_until into v_target_banned_until from auth.users where id=v_op.target_user_id;
  if not found then raise exception 'Target Auth account not found.' using errcode='P0002'; end if;
  if (v_target_banned_until is not null and v_target_banned_until > now()) is distinct from p_auth_banned_confirmed then
    raise exception 'Auth state does not match the reconciliation evidence.' using errcode='23514';
  end if;
  select exists(select 1 from public.platform_user_status where user_id=v_op.target_user_id)
    into v_old_latch;
  if p_resolution='keep_suspended' then
    insert into public.platform_user_status(user_id,suspended_by,reason)
      values (v_op.target_user_id,v_operator,v_op.reason) on conflict(user_id) do nothing;
    if found then
      insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
      values (v_operator,'suspend_student','user',v_op.target_user_id::text,
        jsonb_build_object('suspension_operation_id',p_operation_id,'transition','suspend','generation',p_generation,
          'desired_suspended',v_op.desired_suspended,'resolved_suspended',v_resolved_suspended,
          'operator_principal',session_user,'evidence_reference',left(p_evidence_reference,200)));
    end if;
  else
    if not exists(select 1 from public.platform_user_status where user_id=v_op.target_user_id) then
      raise exception 'Restoration latch is unexpectedly missing.' using errcode='23514';
    end if;
    delete from public.platform_user_status where user_id=v_op.target_user_id;
    insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
    values (v_operator,'restore_student','user',v_op.target_user_id::text,
      jsonb_build_object('suspension_operation_id',p_operation_id,'transition','restore','generation',p_generation,
        'desired_suspended',v_op.desired_suspended,'resolved_suspended',v_resolved_suspended,
        'operator_principal',session_user,'evidence_reference',left(p_evidence_reference,200)));
  end if;
  insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values (v_operator,'suspension_reconciled','user',v_op.target_user_id::text,
    jsonb_build_object('suspension_operation_id',p_operation_id,
      'transition','reconcile_' || p_resolution,'generation',p_generation,
      'desired_suspended',v_op.desired_suspended,'resolved_suspended',v_resolved_suspended,
      'old_latch',v_old_latch,'new_latch',v_resolved_suspended,
      'operator_principal',session_user,'evidence_reference',left(p_evidence_reference,200),
      'auth_banned',p_auth_banned_confirmed));
  update public.platform_user_suspension_operations set state='completed',phase='finalized',
    auth_observed_banned=p_auth_banned_confirmed,dispatch_token=null,
    evidence_reference=left(p_evidence_reference,200),resolved_suspended=v_resolved_suspended,
    resolution_kind='operator_override',resolved_by=v_operator,resolved_by_principal=session_user,
    completed_at=now(),updated_at=now()
    where operation_id=p_operation_id;
  insert into public.platform_user_suspension_operation_events(operation_id,generation,transition,event_data)
    values (p_operation_id,p_generation,'finalized',jsonb_build_object('operator_id',v_operator,
      'operator_principal',session_user,'evidence_reference',left(p_evidence_reference,200),
      'desired_suspended',v_op.desired_suspended,'resolved_suspended',v_resolved_suspended,
      'resolution',p_resolution));
  return jsonb_build_object('operation_id',p_operation_id,'generation',p_generation,'state','completed',
    'desired_suspended',v_op.desired_suspended,'resolved_suspended',v_resolved_suspended,
    'resolution_kind','operator_override','resolution',p_resolution);
end;
$$;

-- Internal recovery scanner. It returns operation metadata only, never tokens,
-- Auth secrets, or reason text. The worker must not blindly replay ambiguous
-- Auth requests; it uses the design's reconciliation procedure.
create or replace function public.list_platform_user_suspension_recovery(p_limit integer default 50)
returns table(operation_id uuid,target_user_id uuid,generation bigint,desired_suspended boolean,state text,phase text,updated_at timestamptz)
language sql security definer
set search_path = pg_catalog, public
as $$
  select o.operation_id,o.target_user_id,o.generation,o.desired_suspended,o.state,o.phase,o.updated_at
  from public.platform_user_suspension_operations o
  where o.state in ('pending','reconciliation_required')
  order by o.updated_at,o.target_user_id
  limit least(greatest(coalesce(p_limit,50),1),200);
$$;

alter function public.claim_platform_user_suspension(uuid,uuid,boolean,text) owner to postgres;
alter function public.authorize_platform_user_suspension_auth_dispatch(uuid,uuid,bigint) owner to postgres;
alter function public.record_platform_user_suspension_phase(uuid,bigint,text,uuid,boolean,text) owner to postgres;
alter function public.finalize_platform_user_suspension(uuid,bigint,boolean) owner to postgres;
alter function public.reconcile_platform_user_suspension(uuid,bigint,boolean,text,text) owner to postgres;
alter function public.list_platform_user_suspension_recovery(integer) owner to postgres;

revoke all on function public.claim_platform_user_suspension(uuid,uuid,boolean,text) from public,anon,service_role;
revoke all on function public.authorize_platform_user_suspension_auth_dispatch(uuid,uuid,bigint) from public,anon,authenticated,service_role;
revoke all on function public.record_platform_user_suspension_phase(uuid,bigint,text,uuid,boolean,text) from public,anon,service_role;
revoke all on function public.finalize_platform_user_suspension(uuid,bigint,boolean) from public,anon,service_role;
revoke all on function public.reconcile_platform_user_suspension(uuid,bigint,boolean,text,text) from public,anon,authenticated,service_role;
revoke all on function public.list_platform_user_suspension_recovery(integer) from public,anon,authenticated;
grant execute on function public.claim_platform_user_suspension(uuid,uuid,boolean,text) to authenticated;
grant execute on function public.authorize_platform_user_suspension_auth_dispatch(uuid,uuid,bigint) to service_role;
grant execute on function public.record_platform_user_suspension_phase(uuid,bigint,text,uuid,boolean,text) to authenticated;
grant execute on function public.finalize_platform_user_suspension(uuid,bigint,boolean) to authenticated;
grant execute on function public.list_platform_user_suspension_recovery(integer) to service_role;
-- Required pre-created, NOLOGIN group role. Individual operator database
-- login principals are members; no API/PostgREST role may be a member.
grant execute on function public.reconcile_platform_user_suspension(uuid,bigint,boolean,text,text)
  to suspension_reconciler;

-- Remove the old direct status-transition RPC so callers cannot bypass the
-- operation journal. The API compatibility shutdown must ship first.
revoke all on function public.set_platform_user_suspension(uuid,boolean,text)
  from public,anon,authenticated,service_role;

commit;
