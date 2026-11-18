-- Operations app: the surgeon's feedback list about the app, and key/value settings.
create table if not exists op_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  text text not null default '',
  priority text not null default 'P2' check (priority in ('P1', 'P2', 'P3')),
  done_at timestamptz
);
comment on table op_feedback is 'Operations app. The surgeon''s own checklist of problems and changes to the app, P1-P3. Server-only.';

create table if not exists op_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table op_settings is 'Operations app. Settings: Claude''s standing instructions, the parts a new operation starts with, the groups. Server-only.';

alter table op_feedback enable row level security;
alter table op_settings enable row level security;
