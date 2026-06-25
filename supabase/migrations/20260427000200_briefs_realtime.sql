-- Phase 2 polish: stream brief status changes to the browser so the tab spinner
-- clears the instant Claude's submit_brief tool call lands, instead of polling.
do $$ begin
  alter publication supabase_realtime add table briefs;
exception when duplicate_object then null; when undefined_object then null; end $$;
