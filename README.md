# Operations

A T&O surgeon's notes on every operation, built for the phone.

Each operation has **Steps** (sections of bullets and numbered lines), **Videos**, **Links**, **Op tech** (one per kit) and **Knowledge** (questions with answers). A line in the steps can be marked for one kit, one technique (e.g. Mako) or one consultant; the filters at the top hide lines that don't apply to today's case.

The page is always editable and saves itself:
- Tap any text to change it. Enter adds the next line, Backspace on an empty line removes it, Tab indents (on a keyboard).
- Hold ⋮⋮ and drag to move a line or a whole part. Tap ⋮⋮ for options: mark a line for a kit, mode or consultant, bullet or numbered, indent, delete; make a part a sub-part of the one above.
- Kits, modes and consultants are chips at the top: tap to filter, tap the selected one to rename or remove it, + to add one. Consultants are shared by every operation.
- Paste a link into Videos or Links and its title fills itself in.
- Undo steps back through every change.

Or type or dictate into the bar at the bottom and Claude shows its change (what it adds and removes) before anything is saved. From the home screen, "Add a learning to any operation" finds the right operation first, creating it if needed.

Search matches every word anywhere on every page.

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
