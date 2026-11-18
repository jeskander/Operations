# Operations

A T&O surgeon's notes on every operation, built for the phone.

Each operation has **Steps** (sections of bullets and numbered lines), **Videos**, **Links**, **Op tech** (one per kit) and **Knowledge** (questions with answers). A line in the steps can be marked for one kit, one technique (e.g. Mako) or one consultant; the filters at the top hide lines that don't apply to today's case.

Add or change anything by typing or dictating into the bar at the bottom. Claude shows its change (what it adds and removes) before anything is saved, and every save can be undone. From the home screen, "Add a learning to any operation" finds the right operation first, creating it if needed. Edit changes the page by hand; steps are plain text: `- ` bullet, `1. ` numbered, two spaces to indent, `[Attune]` / `[Mako]` / `[Mr Smith]` at the end of a line to mark it.

Search matches every word anywhere on every page. Consultants are shared across operations and managed from the home screen.

## Run

```bash
cp .env.example .env.local   # fill in the keys
npm install
npm run dev
```

| Variable | |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase secret (service role) key. Server only. |
| `APP_PASSWORD` | Password for signing in. Sign-in lasts a year and renews with use. |

The schema is in `supabase/migrations/`. Tables are prefixed `op_`, share the Theatres Supabase project, and have row-level security on with no policies: only the server reads or writes. Every save keeps the previous version in `op_revisions`.
