-- Operations app: a T&O surgeon's notes per operation.
-- RLS on with no policies: only the server (secret key) reads or writes.

create table if not exists op_operations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region text not null default 'Other',
  subtitle text not null default '',
  -- { kits, techniques, sections, videos, links, questions }: see lib/types.ts
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table op_operations is 'Operations app. One row per operation: steps, videos, links, op tech and knowledge in content. Server-only.';

create table if not exists op_revisions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references op_operations(id) on delete cascade,
  name text not null,
  region text not null,
  subtitle text not null,
  content jsonb not null,
  source text not null default 'manual', -- manual | ai | undo
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists op_revisions_operation_idx on op_revisions (operation_id, created_at desc);
comment on table op_revisions is 'Operations app. The page as it was before each save, so nothing is lost. Server-only.';

create table if not exists op_consultants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
comment on table op_consultants is 'Operations app. Consultants whose preferences can be marked on any step. Server-only.';

alter table op_operations enable row level security;
alter table op_revisions enable row level security;
alter table op_consultants enable row level security;
