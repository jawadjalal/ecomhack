-- Darwin analytics events. Mirrors `AnalyticsEvent` (src/lib/contracts/events.ts), which is
-- PostHog-shaped: event, distinct_id, timestamp, properties (jsonb; PostHog `$` props are kept).
--
-- Written by src/lib/analytics/supabase.ts (service role, fire-and-forget, batched upserts on uuid).
-- The app reads from memory, never from here: this table is for the team's own queries / pipeline.

create table if not exists public.events (
  uuid          text        primary key,               -- uuid v4/v7 from the SDK or the server
  event         text        not null,
  distinct_id   text        not null,
  "timestamp"   timestamptz not null,
  properties    jsonb       not null default '{}'::jsonb,
  inserted_at   timestamptz not null default now(),

  -- Hot properties promoted to columns for cheap filtering (kept in sync automatically).
  visitor_kind  text generated always as (coalesce(properties ->> 'visitor_kind', 'human')) stored,
  agent_name    text generated always as (properties ->> 'agent_name') stored,
  session_id    text generated always as (properties ->> '$session_id') stored,
  pathname      text generated always as (properties ->> '$pathname') stored,
  experiment_id text generated always as (properties ->> 'experiment_id') stored,
  variant       text generated always as (properties ->> 'variant') stored,
  spec_version  integer generated always as (
    case when (properties ->> 'spec_version') ~ '^[0-9]{1,9}$' then (properties ->> 'spec_version')::integer end
  ) stored,
  synthetic     boolean generated always as (coalesce((properties ->> 'synthetic') = 'true', false)) stored,
  revenue       bigint generated always as (                       -- pence, order_completed only
    case when event = 'order_completed' and (properties ->> 'revenue') ~ '^-?[0-9]{1,15}$'
         then (properties ->> 'revenue')::bigint end
  ) stored
);

comment on table public.events is 'Darwin analytics events (PostHog-compatible). Money in pence.';

create index if not exists events_timestamp_idx       on public.events ("timestamp");
create index if not exists events_event_timestamp_idx on public.events (event, "timestamp");
create index if not exists events_distinct_id_idx     on public.events (distinct_id, "timestamp");
create index if not exists events_kind_timestamp_idx  on public.events (visitor_kind, "timestamp");
create index if not exists events_experiment_idx      on public.events (experiment_id, variant) where experiment_id is not null;
create index if not exists events_spec_version_idx    on public.events (spec_version) where spec_version is not null;
create index if not exists events_properties_gin_idx  on public.events using gin (properties jsonb_path_ops);

-- Locked down by default: no policies, so only the service role (which bypasses RLS) can read/write.
alter table public.events enable row level security;

-- Funnel per audience and experiment arm (distinct visitors per standard step).
-- security_invoker so the view respects the table's RLS instead of leaking through the API.
create or replace view public.events_funnel with (security_invoker = true) as
select
  visitor_kind,
  experiment_id,
  variant,
  count(distinct distinct_id) filter (where event in ('$pageview', 'agent_request')) as pageview,
  count(distinct distinct_id) filter (where event = 'product_viewed')                 as product_viewed,
  count(distinct distinct_id) filter (where event = 'product_added')                  as product_added,
  count(distinct distinct_id) filter (where event = 'checkout_started')               as checkout_started,
  count(distinct distinct_id) filter (where event = 'order_completed')                as order_completed,
  coalesce(sum(revenue), 0)                                                            as revenue
from public.events
group by visitor_kind, experiment_id, variant;
