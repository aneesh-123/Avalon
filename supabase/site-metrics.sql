-- Tables for the /admin page (server/metrics.js). Run once in the Supabase
-- dashboard: SQL Editor → New query → paste → Run. Safe to run again.

create table if not exists site_events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  kind    text not null,              -- 'visit' | 'game_start' | 'game_end'
  game    text,                       -- 'avalon' | 'imposter' | 'trivia'
  visitor text,                       -- random id kept on the player's device
  data    jsonb not null default '{}' -- page, source, device, players
);
create index if not exists site_events_at on site_events (at);

create table if not exists site_feedback (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  message text not null,
  rating  text,                       -- 'up' | 'down' | null
  game    text,
  contact text,
  visitor text,
  device  text
);
create index if not exists site_feedback_at on site_feedback (at);

-- Only the server (service key) reads or writes these.
alter table site_events   enable row level security;
alter table site_feedback enable row level security;
