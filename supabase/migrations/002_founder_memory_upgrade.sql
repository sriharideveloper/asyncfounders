-- Founder memory, callback identity and company administration upgrade.
-- Run after 001_production_schema.sql.

alter table public.companies
  add column if not exists agent_instructions text not null default '',
  add column if not exists updated_at timestamptz not null default now();

grant update(name, description, timezone, agent_instructions, updated_at)
  on public.companies to authenticated;

drop policy if exists "source_update_own" on public.sources;
create policy "source_update_own" on public.sources for update
  using (public.is_company_member(company_id) and added_by = auth.uid())
  with check (public.is_company_member(company_id) and added_by = auth.uid());
drop policy if exists "source_delete_own" on public.sources;
create policy "source_delete_own" on public.sources for delete
  using (public.is_company_member(company_id) and added_by = auth.uid());

create or replace function public.update_callback_profile_for_user(
  target_company uuid,
  target_user uuid,
  callback_phone text,
  callback_consent boolean,
  callback_timezone text
)
returns table(phone_last_four char(4), call_consent boolean, timezone text)
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

  if member_row.id is null then
    raise exception 'Active company membership not found';
  end if;

  normalized_phone := nullif(regexp_replace(coalesce(callback_phone, ''), '[^+0-9]', '', 'g'), '');
  if callback_consent and normalized_phone is null then
    normalized_phone := member_row.phone_e164;
  end if;
  if callback_consent and (normalized_phone is null or normalized_phone !~ '^\+[1-9][0-9]{7,14}$') then
    raise exception 'Enter a valid E.164 phone number';
  end if;

  if normalized_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 0));
    if exists (
      select 1 from public.company_members
      where phone_e164 = normalized_phone
        and user_id is distinct from target_user
        and status = 'active'
    ) then
      raise exception 'That callback number is already connected to another account';
    end if;
  end if;

  update public.company_members
  set phone_e164 = case when callback_consent then normalized_phone else null end,
      phone_last_four = case when callback_consent then right(normalized_phone, 4)::char(4) else null end,
      call_consent = callback_consent,
      timezone = coalesce(nullif(trim(callback_timezone), ''), member_row.timezone)
  where id = member_row.id
  returning company_members.phone_last_four, company_members.call_consent, company_members.timezone
  into phone_last_four, call_consent, timezone;

  return next;
end $$;
revoke all on function public.update_callback_profile_for_user(uuid,uuid,text,boolean,text) from public, anon, authenticated;
grant execute on function public.update_callback_profile_for_user(uuid,uuid,text,boolean,text) to service_role;

create or replace function public.create_memory_item(
  target_company uuid,
  memory_type public.memory_kind,
  memory_title text,
  memory_body text,
  memory_status public.memory_status,
  memory_confidence numeric,
  memory_evidence text,
  memory_audience jsonb default '["team"]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  author_id uuid;
  next_version bigint;
  new_id uuid;
begin
  select id into author_id from public.company_members
  where company_id = target_company and user_id = auth.uid() and status = 'active';
  if author_id is null then raise exception 'Active company membership required'; end if;
  if char_length(trim(memory_title)) < 2 or char_length(trim(memory_body)) < 2 then
    raise exception 'Memory title and detail are required';
  end if;

  update public.companies set current_version = current_version + 1, updated_at = now()
  where id = target_company returning current_version into next_version;

  insert into public.memory_items(
    company_id, version, kind, title, body, status, confidence,
    author_member_id, source_excerpt, audience
  ) values (
    target_company, next_version, memory_type, trim(memory_title), trim(memory_body),
    memory_status, greatest(0, least(1, memory_confidence)), author_id,
    nullif(trim(memory_evidence), ''), coalesce(memory_audience, '["team"]'::jsonb)
  ) returning id into new_id;
  return new_id;
end $$;
grant execute on function public.create_memory_item(uuid,public.memory_kind,text,text,public.memory_status,numeric,text,jsonb) to authenticated;

create or replace function public.seed_memory_acknowledgements()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.acknowledgements(memory_item_id, member_id, state)
  select new.id, id, case when id = new.author_member_id then 'acknowledged'::public.ack_state else 'unseen'::public.ack_state end
  from public.company_members
  where company_id = new.company_id and status = 'active'
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists memory_item_acknowledgements on public.memory_items;
create trigger memory_item_acknowledgements
after insert on public.memory_items
for each row execute procedure public.seed_memory_acknowledgements();

insert into public.acknowledgements(memory_item_id, member_id, state)
select memory.id, member.id,
  case when member.id = memory.author_member_id then 'acknowledged'::public.ack_state else 'unseen'::public.ack_state end
from public.memory_items memory
join public.company_members member on member.company_id = memory.company_id and member.status = 'active'
on conflict do nothing;

create index if not exists company_members_phone_lookup_idx
  on public.company_members(phone_e164) where phone_e164 is not null and status = 'active';

-- Fail closed if historical rows already contain one number across distinct accounts.
-- The affected people must re-enter their own number; no ambiguous row remains callable.
with conflicted_phones as (
  select phone_e164
  from public.company_members
  where phone_e164 is not null and status = 'active'
  group by phone_e164
  having count(distinct user_id) > 1
)
update public.company_members member
set phone_e164 = null, phone_last_four = null, call_consent = false
from conflicted_phones conflict
where member.phone_e164 = conflict.phone_e164;

create index if not exists memory_items_company_kind_status_idx
  on public.memory_items(company_id, kind, status, version desc);
create index if not exists sources_company_created_idx
  on public.sources(company_id, created_at desc);
