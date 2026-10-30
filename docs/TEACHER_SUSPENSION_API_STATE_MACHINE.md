# Suspension API State-Machine Specification

**REVIEW ONLY — NOT APPROVED FOR EXECUTION.** This is a contract for future API work, not implemented code. See [system design](TEACHER_SUSPENSION_RESTORATION_DESIGN.md) and [SQL draft](../supabase-migrations/20261105_teacher_suspension_operations_draft.sql).

## Request contract

Admin UI remains disabled. The eventual server endpoint accepts `target_user_id`, desired action, and a stable idempotency UUID. Actor identity comes only from the verified bearer JWT (`auth.uid()` in user-scoped RPCs). It never accepts an actor ID from request JSON. The server validates a student target and bounded reason and confirms active Super Admin. Claim, phase recording and finalization use the caller's bearer token. Dispatch authorization is a server-only service-role RPC because its response contains a one-time secret; the server passes the actor ID derived from the verified bearer, keeps the token in memory, and never serializes or logs it. Auth Admin calls use the server-only secret.

For every retry, the caller resubmits the same operation UUID, target and direction. Reusing that UUID with changed inputs is `409 idempotency_key_reused`. A competing operation for the target is `409 operation_in_progress` and includes only a safe operation status/reference, not sensitive Auth data. Never silently replace an active operation.

## State and transitions

```text
No operation
  └─ claim ─> pending / claimed
                 └─ one-time dispatch authorization ─> pending / dispatch_authorized
                       ├─ token holder gets Auth success and confirms ─> pending / auth_confirmed
                       │                                                  └─ finalize ─> completed / finalized
                       ├─ token holder reports uncertainty ─> reconciliation_required
                       └─ handler crash/token lost ─> pending / dispatch_authorized (unresolved)
                       └─ operator-only reconciliation ─> completed (resolved outcome recorded)
```

The mutable operation row retains `desired_suspended` as the original request and stores `resolved_suspended` as the actual final latch outcome. `resolution_kind='requested'` is valid only when both values match; operator reconciliation sets `resolution_kind='operator_override'` and may resolve either direction. Append-only `platform_user_suspension_operation_events` records transitions; the operation row itself is mutable current state.

There is no ordinary cancellation transition. Once claimed, an operation remains active until completed or explicitly reconciled. This avoids releasing a claim based on process-local knowledge.

### Suspend

1. `claim_platform_user_suspension(id,target,true,reason)` commits the latch before any Auth call. If claim fails or times out, make no Auth call; retry the same ID and inspect durable state.
2. After re-verifying the bearer and active Super Admin status, the server calls service-role-only `authorize_platform_user_suspension_auth_dispatch(verified_actor_id,operation_id,generation)`. The actor ID is server-derived, never client input. Exactly one call can change `claimed` to `dispatch_authorized` and receive the one-time token. A repeated/concurrent call returns no token and must not contact Auth. `authenticated` has no EXECUTE on this token-returning RPC, so a browser cannot retrieve the token directly through PostgREST.
3. The winning handler stores the token only in server memory and issues exactly one `auth.admin.updateUserById(target,{ban_duration:'876000h'})` request. It must not log the token or enable SDK/proxy retries.
4. On a definitive Auth success response, read back the effective Auth state and call `record_platform_user_suspension_phase(...,'auth_confirmed',dispatch_token,auth_observed_banned)`, where `auth_observed_banned` must equal the operation's `desired_suspended` (`true` for suspension, `false` for restoration); then finalize. The RPC rejects a missing or mismatching observation. The latch remains in place until finalization.
5. On any Auth error or ambiguous result, the handler may use its token once to mark `reconciliation_required`. It cannot obtain another token or retry Auth. If it crashes or loses the token, the operation stays `pending/dispatch_authorized`; it remains latched and only operator reconciliation can resolve it.

### Restore

1. Claim restore. Retain the existing latch or arm a protective DB latch if absent. This ensures that even an Auth/DB status mismatch remains blocked during recovery.
2. Obtain one-time dispatch authorization. Only the winning handler receives the token; repeated requests receive no token.
3. The handler stores the token only in server memory and issues exactly one `auth.admin.updateUserById(target,{ban_duration:'none'})` request, without automatic retries.
4. On success, verify Auth state and record `auth_confirmed` using the token and `banned=false`; finalization checks the Auth row, removes the latch and writes the unique restore audit atomically.
5. If any result is uncertain or the handler terminates after authorization, keep the latch. Ordinary API retries cannot re-dispatch or transition a reconciliation-required operation. A new suspend or restore operation remains blocked pending operator-only reconciliation. Reconciliation may resolve opposite to the request only after explicit operator verification; the response must include both original `desired_suspended` and final `resolved_suspended`.

### Operator reconciliation boundary

The reconciliation SQL function takes no `operator_id` argument and is not executable by `PUBLIC`, `anon`, `authenticated`, `service_role`, or application/PostgREST roles. A dedicated `suspension_reconciler` database group role is granted EXECUTE; individual direct database login principals are mapped to human Auth UUIDs in the owner-controlled principal table. Inside the SECURITY DEFINER function, `session_user` is checked for group membership and looked up in that mapping; the mapped UUID and database principal populate audit identity. The evidence reference is only a pointer, not proof of authorization. A DBA must verify human identity, approval record, individual credential custody, and mapping before provisioning membership. Shared API logins must never be mapped. If the connection pool does not preserve individual `session_user`, do not enable this path; require an individually attributable direct operator connection or a separately reviewed identity design.

The existing implementation does not yet satisfy this contract: `api/admin.js` calls `coordinateStudentSuspension` from `server/teacherApprovalApi.js`, which uses the legacy status RPC and has no durable operation/generation/dispatch capability. It may infer success by reading Auth after an ambiguous update. The Dashboard controls are hidden/disabled, but the `/api/admin` actions remain callable by a direct request from an active Super Admin; UI disabling alone is not a shutdown. Reject these routes until replaced end-to-end. Installing the SQL draft while they still call the revoked legacy RPC would cause failures, while retaining another legacy function would bypass this protocol. The generic `callAuthenticatedRpc` response must never be forwarded for dispatch because it contains the one-time token. Existing suspension tests exercise the legacy helper and must be replaced or supplemented before accepting the new API.

For `keep_suspended`, the operator must confirm Auth banned=true; final `resolved_suspended=true`. For `restore_active`, confirm Auth banned=false; final `resolved_suspended=false`. These outcomes may differ from the original direction, which remains unchanged in the operation row and in every reconciliation audit event. The SQL requires the observed Auth state to match the selected final outcome and reconciles the latch atomically.

## Timeout and restart semantics

The operation row, not API memory, is the source of truth. On claim timeout, retry the same ID; no Auth call is permitted until dispatch authorization is returned. If the dispatch-authorization response times out after commit, a retry gets no token; the operation remains unresolved and requires operator reconciliation. A restart worker scans open operations but never reauthorizes or replays Auth. A Postgres generation fence rejects stale phase/finalize calls, but cannot cancel a request already sent to Auth.

## Responses

- `200 completed`: response contains `desired_suspended`, `resolved_suspended`, and `resolution_kind`. For ordinary completion the two booleans match; for operator reconciliation they may differ. The latch state equals `resolved_suspended`.
- `202 pending`: a durable operation exists and the access latch remains. Include operation ID, generation, phase and current DB latch state. `dispatch_authorized` is not retryable by normal API.
- `409 operation_in_progress`: another operation is pending for this target; return its opaque operation ID and status endpoint reference.
- `409 stale_generation`: the submitted operation/generation is no longer current.
- `400 invalid_input`; `401 unauthenticated`; `403 not_active_super_admin`; `503 verification_unavailable`.

Never return `active` solely because Auth reports unbanned. The status row must be absent only after successful, generation-matched restore finalization. UI must continue to show pending/blocked until authoritative DB state and operation state agree.

## Audit contract

The operation row is mutable current state; `platform_user_suspension_operation_events` is append-only through supported RPCs (database-owner edits remain privileged). The database writes state-transition audit rows only. A suspend audit is emitted whenever the claim actually creates the latch, including a protective latch for a restore request; restore audit is emitted only when finalization/reconciliation removes it. Reconciliation metadata includes original `desired_suspended`, final `resolved_suspended`, old/new latch state, `resolution_kind`, operation ID, generation, mapped operator UUID, individual database principal, and evidence reference. The evidence reference is not proof of authorization. The unique dispatch event proves one authorization per operation. The API emits no duplicate audit event.

## Provider boundary

Use `ban_duration:'876000h'` only after confirming current project behavior; use `'none'` for unban only after version-specific staging verification. Disable automatic retries in the HTTP/SDK/proxy chain for the single authorized Auth call and verify the installed client behavior. Supabase docs do not document a request idempotency key, compare-and-set generation, cancellation, or linearizable handling of concurrent update calls. The database can ensure one handler receives a dispatch permit; it cannot prevent that handler's transport from duplicating a request. Unknown results therefore remain fenced and fail-closed for manual reconciliation.
