begin;
create or replace function public.validate_model_assignment() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
if not exists(select 1 from public.agency_members where agency_id=new.agency_id and user_id=new.manager_user_id and role='manager' and status='active') then raise exception 'manager_not_in_agency'; end if;
if not exists(select 1 from public.models where id=new.model_id and agency_id=new.agency_id) then raise exception 'model_not_in_agency'; end if;
if not(public.is_platform_admin() or public.is_agency_admin(new.agency_id)) then raise exception 'assignment_not_authorized'; end if;
return new; end$$;
create trigger model_assignment_guard before insert or update on public.model_access_assignments for each row execute function public.validate_model_assignment();
commit;
