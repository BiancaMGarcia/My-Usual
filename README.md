# My Usual V4 — Multi-user + Onboarding

This version changes My Usual from one shared family profile to separate user accounts.

## What changes
- Each user signs up / signs in with Supabase Auth.
- Each user gets their own `profiles` row.
- Each user gets their own `taste_profile`.
- Restaurants are owned by a user through `restaurants.user_id`.
- Orders are private because ownership is inherited through the restaurant.
- New users get a 4-step taste-profile onboarding.
- Guests can still use restaurant discovery, but saving/personalization requires an account.

## Before deploying
Run `MULTIUSER_MIGRATION.sql` in Supabase SQL Editor.

## Existing V3 data
Existing restaurants will have `user_id = null`.
After signing into V4, either recreate those restaurants or assign them to your account manually:
`update public.restaurants set user_id = '<YOUR-USER-UUID>' where user_id is null;`

## Important
The `top-picks` Edge Function should also be updated to read the authenticated user's taste profile and restaurants only. A separate file for that can be added next.
