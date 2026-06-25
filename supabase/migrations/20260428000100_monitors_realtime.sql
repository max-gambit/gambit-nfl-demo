-- Phase 5: stream monitor inserts/updates so the alerts badge appears without
-- polling, and so the Watch / Re-run flows reflect newly created monitors
-- across browser tabs.
do $$ begin
  alter publication supabase_realtime add table monitors;
exception when duplicate_object then null; when undefined_object then null; end $$;
