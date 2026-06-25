-- Phase 3: artifact storage. Server uploads markdown bodies via the service
-- role; the client downloads them via signed URLs minted by the agent route.
-- Bucket stays private — no public policy needed.
insert into storage.buckets (id, name, public)
values ('artifacts', 'artifacts', false)
on conflict (id) do nothing;
