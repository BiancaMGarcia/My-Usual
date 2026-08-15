# My Usual V2 — Supabase Sync

This version uses Supabase as the shared database.

- Public users can browse, search, pick, and copy orders without logging in.
- The admin signs in with the Supabase account created for My Usual.
- Only users listed in `public.admin_users` can add, edit, or delete.
- Admin can optionally import the old V1 localStorage data from the current device.

Deploy by replacing the existing GitHub Pages repo files with the contents of this folder.
