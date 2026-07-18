-- Development only. Never run this file automatically in production.
begin;
insert into public.agencies(id,name,slug,timezone) values('10000000-0000-0000-0000-000000000001','Aria Models','aria-models','Australia/Brisbane');
insert into public.models(id,agency_id,display_name,slug,source_system,source_model_key,currency,timezone) values
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Alanna Powell','alanna-powell','telegram','tg-model-alanna','USD','Australia/Brisbane'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Callie Stone','callie-stone','telegram','tg-model-callie','USD','Australia/Brisbane'),
('20000000-0000-0000-0000-000000000003',null,'Maya Vale','maya-vale','telegram','tg-model-maya','USD','Australia/Brisbane');
insert into public.daily_model_metrics(model_id,metric_date,message_count,total_users,active_users) select '20000000-0000-0000-0000-000000000001',current_date-g,20000+g*100,43000,1700 from generate_series(0,29) g;
insert into public.sync_runs(sync_id,source_system,workflow_name,agency_id,model_id,status,payload_hash,records_received,records_created,completed_at) values(gen_random_uuid(),'telegram','telegram-earnings-sync','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','succeeded',repeat('a',64),12,12,now()-interval '10 minutes'),(gen_random_uuid(),'telegram','telegram-earnings-sync','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','failed',repeat('b',64),0,0,now()-interval '35 minutes');
commit;
