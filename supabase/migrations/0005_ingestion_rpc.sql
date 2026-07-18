begin;
create or replace function public.ingest_earnings_sync(p_payload jsonb,p_payload_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_model public.models%rowtype; v_sync_id uuid; v_created int:=0; v_updated int:=0; v_ignored int:=0; v_item jsonb; v_date date;
begin
  v_sync_id := (p_payload->>'sync_id')::uuid;
  if exists(select 1 from public.sync_runs where sync_id=v_sync_id) then raise exception using errcode='23505',message='duplicate_sync'; end if;
  select * into v_model from public.models where source_system=p_payload#>>'{model,source_system}' and source_model_key=p_payload#>>'{model,source_model_key}' and status<>'disabled';
  if not found then raise exception using errcode='P0002',message='unknown_model'; end if;
  insert into public.sync_runs(sync_id,source_system,workflow_name,agency_id,model_id,status,payload_hash,records_received) values(v_sync_id,v_model.source_system,p_payload->>'workflow_name',v_model.agency_id,v_model.id,'processing',p_payload_hash,jsonb_array_length(p_payload->'transactions'));
  for v_item in select * from jsonb_array_elements(p_payload->'transactions') loop
    insert into public.transactions(model_id,source_system,source_transaction_id,source_buyer_id,telegram_user_id,stars,gross_amount_cents,currency,conversion_rate_micros,transaction_type,transaction_status,occurred_at,synced_at)
    values(v_model.id,v_model.source_system,v_item->>'source_transaction_id',v_item->>'source_buyer_id',v_item->>'telegram_user_id',(v_item->>'stars')::integer,(v_item->>'gross_amount_cents')::bigint,v_item->>'currency',nullif(v_item->>'conversion_rate_micros','')::integer,v_item->>'transaction_type',v_item->>'transaction_status',(v_item->>'occurred_at')::timestamptz,now())
    on conflict(source_system,source_transaction_id) do nothing;
    if found then v_created:=v_created+1; else v_ignored:=v_ignored+1; end if;
  end loop;
  for v_item in select * from jsonb_array_elements(p_payload->'daily_metrics') loop
    v_date:=(v_item->>'metric_date')::date;
    insert into public.daily_model_metrics(model_id,metric_date,message_count,total_users,active_users)
    values(v_model.id,v_date,coalesce((v_item->>'message_count')::bigint,0),coalesce((v_item->>'total_users')::integer,0),coalesce((v_item->>'active_users')::integer,0))
    on conflict(model_id,metric_date) do update set message_count=excluded.message_count,total_users=excluded.total_users,active_users=excluded.active_users,updated_at=now();
    v_updated:=v_updated+1;
  end loop;
  update public.sync_runs set status='succeeded',records_created=v_created,records_updated=v_updated,records_ignored=v_ignored,completed_at=now() where sync_id=v_sync_id;
  return jsonb_build_object('success',true,'sync_id',v_sync_id,'model_id',v_model.id,'records_received',jsonb_array_length(p_payload->'transactions'),'records_created',v_created,'records_updated',v_updated,'records_ignored',v_ignored);
exception when others then
  update public.sync_runs set status='failed',completed_at=now(),error_summary=left(sqlerrm,500) where sync_id=v_sync_id;
  raise;
end$$;
revoke all on function public.ingest_earnings_sync(jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_earnings_sync(jsonb,text) to service_role;
commit;
