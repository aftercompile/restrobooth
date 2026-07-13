-- Custom SQL migration file, put your code below! --

-- docs/ERD.md §1: an outlet's GSTIN must be registered in the outlet's own
-- state. A cross-state assignment is always a data-entry mistake, not a
-- legitimate configuration — GST registration is inherently per-state.
create function check_outlet_gstin_state() returns trigger
language plpgsql
as $$
declare
  gst_state char(2);
  outlet_state text;
begin
  select state_code into gst_state from gst_registrations where id = new.gst_registration_id;
  outlet_state := new.address ->> 'state_code';
  if outlet_state is null then
    raise exception 'outlet address must include a state_code key';
  end if;
  if gst_state is distinct from outlet_state then
    raise exception 'outlet GSTIN state (%) does not match outlet address state (%)', gst_state, outlet_state;
  end if;
  return new;
end;
$$;

create trigger outlet_gstin_state_match
  before insert or update of gst_registration_id, address on outlets
  for each row execute function check_outlet_gstin_state();
