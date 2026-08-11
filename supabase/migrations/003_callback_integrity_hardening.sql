-- Callback integrity, privacy and dispatch hardening.
-- Run after 002_founder_memory_upgrade.sql.

alter table public.call_sessions add column if not exists dispatch_claimed_at timestamptz;
alter table public.call_sessions add column if not exists dispatch_attempts integer not null default 0;
alter table public.call_sessions add column if not exists dispatch_last_error text;

create index if not exists call_sessions_unresolved_recipient_idx
  on public.call_sessions(company_id, member_id, requested_by, requested_at desc)
  where status not in ('completed','failed','cancelled','canceled','no_answer','busy','declined','expired','voicemail');

drop function if exists public.update_callback_profile_for_user(uuid,uuid,text,boolean,text);
create or replace function public.update_callback_profile_for_user(
  target_company uuid,
  target_user uuid,
  callback_phone text,
  callback_consent boolean,
  callback_timezone text,
  callback_quiet_hours_start time,
  callback_quiet_hours_end time
)
returns table(phone_last_four char(4), call_consent boolean, timezone text, quiet_hours_start time, quiet_hours_end time)
language plpgsql
security definer
set search_path = public
as $$
declare
  member_row public.company_members%rowtype;
  normalized_phone text;
begin
  select * into member_row
  from public.company_members
  where company_id = target_company and user_id = target_user and status = 'active'
  for update;

  if member_row.id is null then raise exception 'Active company membership not found'; end if;
  if (callback_quiet_hours_start is null) <> (callback_quiet_hours_end is null) then
    raise exception 'Quiet hours require both a start and end time';
  end if;

  normalized_phone := nullif(regexp_replace(coalesce(callback_phone, ''), '[^+0-9]', '', 'g'), '');
  if callback_consent and normalized_phone is null then normalized_phone := member_row.phone_e164; end if;
  if callback_consent and (normalized_phone is null or normalized_phone !~ '^\+[1-9][0-9]{7,14}$') then
    raise exception 'Enter a valid E.164 phone number';
  end if;

  if normalized_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 0));
    if exists (
      select 1 from public.company_members
      where phone_e164 = normalized_phone and user_id is distinct from target_user and status = 'active'
    ) then raise exception 'That callback number is already connected to another account'; end if;
  end if;

  update public.company_members
  set phone_e164 = case when callback_consent then normalized_phone else null end,
      phone_last_four = case when callback_consent then right(normalized_phone, 4)::char(4) else null end,
      call_consent = callback_consent,
      timezone = coalesce(nullif(trim(callback_timezone), ''), member_row.timezone),
      quiet_hours_start = callback_quiet_hours_start,
      quiet_hours_end = callback_quiet_hours_end
  where id = member_row.id
  returning company_members.phone_last_four, company_members.call_consent, company_members.timezone,
    company_members.quiet_hours_start, company_members.quiet_hours_end
  into phone_last_four, call_consent, timezone, quiet_hours_start, quiet_hours_end;

  return next;
end $$;
revoke all on function public.update_callback_profile_for_user(uuid,uuid,text,boolean,text,time,time) from public, anon, authenticated;
grant execute on function public.update_callback_profile_for_user(uuid,uuid,text,boolean,text,time,time) to service_role;

create or replace function public.claim_call_session(target_session uuid, target_user uuid, expected_fingerprint text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare session_row public.call_sessions%rowtype;
begin
  select * into session_row from public.call_sessions where id = target_session for update;
  if session_row.id is null then raise exception 'Callback preview not found'; end if;
  if session_row.requested_by <> target_user then raise exception 'Callback requester mismatch'; end if;
  if session_row.member_id is distinct from (
    select id from public.company_members
    where company_id = session_row.company_id and user_id = target_user and status = 'active'
  ) then raise exception 'Requester is no longer the active callback recipient'; end if;
  if session_row.payload_fingerprint <> expected_fingerprint then raise exception 'Callback fingerprint mismatch'; end if;

  if session_row.status = 'previewed' then
    update public.call_sessions
    set status = 'dispatching', confirmed_at = now(), dispatch_claimed_at = now(),
        dispatch_attempts = dispatch_attempts + 1, dispatch_last_error = null
    where id = target_session;
  elsif session_row.status = 'dispatching' and session_row.provider_call_id is null then
    update public.call_sessions
    set dispatch_claimed_at = now(), dispatch_attempts = dispatch_attempts + 1, dispatch_last_error = null
    where id = target_session;
  else
    raise exception 'Callback is not claimable';
  end if;
  return jsonb_build_object('id', target_session, 'status', 'dispatching');
end $$;
revoke all on function public.claim_call_session(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_call_session(uuid,uuid,text) to service_role;

drop function if exists public.ingest_call_memory(uuid,jsonb);
create or replace function public.ingest_call_memory(target_session uuid, target_user uuid, memory_payload jsonb)
returns integer language plpgsql security definer set search_path = public
as $$
declare session_row public.call_sessions%rowtype; item jsonb; next_version bigint; inserted_count integer := 0;
begin
  select * into session_row from public.call_sessions where id = target_session for update;
  if session_row.id is null or session_row.memory_ingested_at is not null then return 0; end if;
  if session_row.requested_by <> target_user or session_row.provider_call_id is null then
    raise exception 'Callback is not authorized for memory ingestion';
  end if;
  if session_row.member_id is distinct from (
    select id from public.company_members
    where company_id = session_row.company_id and user_id = target_user and status = 'active'
  ) then raise exception 'Requester is no longer the active callback recipient'; end if;
  if memory_payload is null or jsonb_typeof(memory_payload) <> 'array' or jsonb_array_length(memory_payload) > 30 then
    raise exception 'Memory payload is invalid';
  end if;

  for item in select * from jsonb_array_elements(memory_payload)
  loop
    update public.companies set current_version = current_version + 1, updated_at = now()
    where id = session_row.company_id returning current_version into next_version;
    insert into public.memory_items(company_id,version,kind,title,body,status,confidence,author_member_id,source_call_id,source_excerpt,audience)
    values(session_row.company_id,next_version,(item->>'type')::public.memory_kind,item->>'title',item->>'body',(item->>'status')::public.memory_status,coalesce((item->>'confidence')::numeric,0.5),session_row.member_id,session_row.id,item->>'source_excerpt',coalesce(item->'audience','["team"]'::jsonb));
    inserted_count := inserted_count + 1;
  end loop;
  update public.call_sessions set memory_ingested_at = now() where id = target_session;
  return inserted_count;
end $$;
revoke all on function public.ingest_call_memory(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_call_memory(uuid,uuid,jsonb) to service_role;

create or replace function public.advance_call_briefing(target_session uuid, target_user uuid, target_version bigint)
returns boolean language plpgsql security definer set search_path = public
as $$
declare session_row public.call_sessions%rowtype; preview_version bigint;
begin
  select * into session_row from public.call_sessions where id = target_session for update;
  if session_row.id is null or session_row.requested_by <> target_user or session_row.provider_call_id is null or session_row.mode <> 'catchup' then
    raise exception 'Callback is not authorized to advance briefing state';
  end if;
  if session_row.member_id is distinct from (
    select id from public.company_members
    where company_id = session_row.company_id and user_id = target_user and status = 'active'
  ) then raise exception 'Requester is no longer the active callback recipient'; end if;
  preview_version := (session_row.preview->>'contextVersion')::bigint;
  if preview_version is distinct from target_version then raise exception 'Briefing cursor does not match the approved preview'; end if;
  update public.company_members
  set last_briefed_version = greatest(last_briefed_version, target_version)
  where id = session_row.member_id and company_id = session_row.company_id and user_id = target_user and status = 'active';
  return found;
end $$;
revoke all on function public.advance_call_briefing(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.advance_call_briefing(uuid,uuid,bigint) to service_role;

drop policy if exists "call_read" on public.call_sessions;
create policy "call_read" on public.call_sessions for select
  using (requested_by = auth.uid() and public.is_company_member(company_id));

update public.call_sessions
set result = jsonb_strip_nulls(jsonb_build_object(
  'taskCompleted', result->'taskCompleted',
  'confidenceScore', coalesce(result->'confidenceScore', result#>'{confidence,score}'),
  'outcome', result->'outcome',
  'memoryItemsCreated', result->'memoryItemsCreated',
  'simulated', result->'simulated'
))
where result ? 'transcriptEvidence' or result ? 'providerEvidence' or result ? 'evidence';

create or replace function public.create_call_preview(
  target_session uuid,
  target_company uuid,
  target_member uuid,
  target_user uuid,
  target_mode text,
  target_provider text,
  target_fingerprint text,
  target_preview jsonb
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare existing_session record;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_company::text || ':' || target_member::text || ':' || target_user::text, 0));
  if target_member is distinct from (
    select id from public.company_members
    where id = target_member and company_id = target_company and user_id = target_user and status = 'active'
  ) then raise exception 'Requester is not the active callback recipient'; end if;
  if (target_preview->>'previewId') is distinct from target_session::text
    or (target_preview->>'companyId') is distinct from target_company::text
    or (target_preview->>'memberId') is distinct from target_member::text
    or (target_preview->>'requestedBy') is distinct from target_user::text
    or (target_preview->>'mode') is distinct from target_mode
    or (target_preview->>'provider') is distinct from target_provider
    or (target_preview->>'fingerprint') is distinct from target_fingerprint
  then raise exception 'Preview payload mismatch'; end if;

  update public.call_sessions
  set status = 'expired'
  where company_id = target_company and member_id = target_member and requested_by = target_user
    and status = 'previewed'
    and case
      when coalesce(preview->>'expiresAt','') ~ '^\d{4}-\d{2}-\d{2}T' then (preview->>'expiresAt')::timestamptz < now()
      else true
    end;

  select id,status,provider_call_id into existing_session
  from public.call_sessions
  where company_id = target_company and member_id = target_member and requested_by = target_user
    and status not in ('completed','failed','cancelled','canceled','no_answer','busy','declined','expired','voicemail')
  order by requested_at desc limit 1;

  if existing_session.id is not null then
    return jsonb_build_object('created',false,'previewId',existing_session.id,'status',existing_session.status,'providerCallId',existing_session.provider_call_id);
  end if;

  insert into public.call_sessions(id,company_id,member_id,requested_by,mode,provider,status,payload_fingerprint,preview)
  values(target_session,target_company,target_member,target_user,target_mode,target_provider,'previewed',target_fingerprint,target_preview);
  return jsonb_build_object('created',true,'previewId',target_session,'status','previewed');
end $$;
revoke all on function public.create_call_preview(uuid,uuid,uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_call_preview(uuid,uuid,uuid,uuid,text,text,text,jsonb) to service_role;
