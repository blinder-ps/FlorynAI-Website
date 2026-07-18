begin;

create or replace function public.dashboard_summary(
  p_model_id uuid default null,
  p_start timestamptz default now() - interval '30 days',
  p_end timestamptz default now()
) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public
as $$
  with allowed as (
    select id from public.models
    where status <> 'disabled'
      and (p_model_id is null or id=p_model_id)
      and public.can_view_model(id)
  ), tx as (
    select t.* from public.transactions t join allowed a on a.id=t.model_id
    where t.occurred_at>=p_start and t.occurred_at<p_end and t.transaction_status='completed'
  ), metrics as (
    select coalesce(sum(d.message_count),0)::bigint messages,
           coalesce(max(d.total_users),0)::bigint total_users,
           coalesce(max(d.active_users),0)::bigint active_users
    from public.daily_model_metrics d join allowed a on a.id=d.model_id
    where d.metric_date>=p_start::date and d.metric_date<=p_end::date
  )
  select jsonb_build_object(
    'total_stars',coalesce(sum(tx.stars),0)::bigint,
    'total_revenue_cents',coalesce(sum(tx.gross_amount_cents),0)::bigint,
    'total_sales',count(*)::bigint,
    'unique_buyers',count(distinct tx.source_buyer_id)::bigint,
    'messages',(select messages from metrics),
    'total_users',(select total_users from metrics),
    'active_users',(select active_users from metrics),
    'model_count',(select count(*) from allowed)
  ) from tx;
$$;

create or replace function public.dashboard_revenue_history(
  p_model_id uuid default null,
  p_start timestamptz default now() - interval '30 days',
  p_end timestamptz default now(),
  p_timezone text default 'UTC'
) returns table(metric_date date,revenue_cents bigint,stars bigint,sales bigint)
language sql stable security invoker set search_path=pg_catalog,public
as $$
  select (t.occurred_at at time zone p_timezone)::date,
         coalesce(sum(t.gross_amount_cents),0)::bigint,
         coalesce(sum(t.stars),0)::bigint,
         count(*)::bigint
  from public.transactions t
  where t.occurred_at>=p_start and t.occurred_at<p_end
    and t.transaction_status='completed'
    and (p_model_id is null or t.model_id=p_model_id)
    and public.can_view_model(t.model_id)
  group by 1 order by 1;
$$;

create or replace function public.dashboard_models(
  p_start timestamptz default now() - interval '30 days',
  p_end timestamptz default now()
) returns table(id uuid,display_name text,slug text,profile_image_url text,currency text,total_revenue_cents bigint,total_stars bigint,total_sales bigint)
language sql stable security invoker set search_path=pg_catalog,public
as $$
  select m.id,m.display_name,m.slug,m.profile_image_url,m.currency,
         coalesce(sum(t.gross_amount_cents) filter(where t.transaction_status='completed'),0)::bigint,
         coalesce(sum(t.stars) filter(where t.transaction_status='completed'),0)::bigint,
         count(t.id) filter(where t.transaction_status='completed')::bigint
  from public.models m left join public.transactions t on t.model_id=m.id and t.occurred_at>=p_start and t.occurred_at<p_end
  where m.status<>'disabled' and public.can_view_model(m.id)
  group by m.id order by 6 desc;
$$;

create or replace function public.dashboard_sync_health(p_model_id uuid default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public
as $$
  with latest as (
    select s.completed_at,s.error_summary
    from public.sync_runs s
    where s.status='succeeded' and (p_model_id is null or s.model_id=p_model_id)
      and s.model_id is not null and public.can_view_model(s.model_id)
    order by s.completed_at desc limit 1
  ), values as (select completed_at,extract(epoch from(now()-completed_at))/60 minutes from latest)
  select jsonb_build_object(
    'last_successful_sync_at',(select completed_at from values),
    'next_expected_sync_at',(select completed_at+interval '30 minutes' from values),
    'minutes_since_success',round((select minutes from values)),
    'status',case when not exists(select 1 from values) then 'never_synced'
      when (select minutes from values)<=45 then 'fresh'
      when (select minutes from values)<=60 then 'delayed' else 'stale' end
  );
$$;

grant execute on function public.dashboard_summary(uuid,timestamptz,timestamptz),public.dashboard_revenue_history(uuid,timestamptz,timestamptz,text),public.dashboard_models(timestamptz,timestamptz),public.dashboard_sync_health(uuid) to authenticated;
revoke all on function public.dashboard_summary(uuid,timestamptz,timestamptz),public.dashboard_revenue_history(uuid,timestamptz,timestamptz,text),public.dashboard_models(timestamptz,timestamptz),public.dashboard_sync_health(uuid) from anon;
commit;
