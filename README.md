# Operations

A T&O surgeon's notes on every operation, built for the phone.

Each operation has **Steps** (sections of bullets and numbered lines), **Videos**, **Links**, **Op tech** (one per kit) and **Knowledge** (questions with answers). A line in the steps can be marked for one kit, one technique (e.g. Mako) or one consultant; the filters at the top hide lines that don't apply to today's case.

The page is always editable and saves itself. Steps work like Notion blocks:
- Type at the start of a block: `> ` part (a toggle), `- ` / `* ` / `+ ` bullet, `1. ` numbered, `# ` heading.
- Enter adds a block (inside an open part, the first line of it), Shift+Enter a line break, Tab / Shift+Tab nest and un-nest, Backspace at the start turns a block back into text and then joins it to the one above, Ctrl/Cmd+D duplicates, arrow keys move between blocks.
- `@` tags a block with a kit, mode or consultant (or makes a new one). A tag on a part applies to everything inside it.
- Hold ⋮⋮ and drag to move a block with everything nested in it. Tap ⋮⋮ for its menu: rename, turn into, indent, unindent, tags, duplicate, delete.
- On a phone, a bar above the keyboard has unindent, indent, @, part, bullet, numbered and the block menu.
- Kits, modes and consultants are chips at the top: tap to filter, tap the selected one to rename or remove it, + to add one. Consultants are shared by every operation.
- Paste a link into Videos or Links and its title fills itself in. Undo steps back through every change.

Or type or dictate into the bar at the bottom and Claude shows its change (what it adds and removes) before anything is saved. From the home screen, "Add a learning to any operation" finds the right operation first, creating it if needed.

Search matches every word anywhere on every page.

**Feedback** keeps a P1–P3 checklist of changes to the app, as in Theatres; "feedback: …" in any Claude bar adds to it. **Settings** holds Claude's standing instructions (added to every change), the parts a new operation starts with, the groups on the home screen, and the consultants.

**Locking.** Type the password and press Enter. The app locks after 10 minutes without use and when the browser closes. The password is never stored: the sign-in field has no form and is marked for browsers and password managers to skip, and the cookie holds only a signed time of last use, which the server refuses once it's 10 minutes old. Pages and data are sent with `Cache-Control: no-store`.

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
| `APP_PASSWORD` | Password for signing in. |

The schema is in `supabase/migrations/`. Tables are prefixed `op_`, share the Theatres Supabase project, and have row-level security on with no policies: only the server reads or writes. Every save keeps the previous version in `op_revisions`.
