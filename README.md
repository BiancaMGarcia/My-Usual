# My Usual v18

My Usual is a pastel pink-and-purple restaurant and order-saving PWA with private user accounts, ZIP-code restaurant discovery, personalized Top 5 menu recommendations, ratings, and a guided taste profile.

## GitHub Pages files

Upload these seven files to the repository root:

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`
- `manifest.webmanifest`
- `icon-192.png`
- `icon-512.png`

Keep the filenames exactly as shown. The homepage must be named `index.html`.

In GitHub, open **Settings → Pages**, select **Deploy from a branch**, then choose the main branch and `/ (root)`.

## Required Supabase database update

Before testing v18 saving, run all of `LINKS_RATINGS_MIGRATION.sql` once in the Supabase **SQL Editor**.

It adds restaurant website and Maps links, restaurant ratings, item descriptions and links, and item ratings. Without it, saving may fail because the new columns do not exist.

For a database that has not previously been converted to separate user accounts, run `MULTIUSER_MIGRATION.sql` first, followed by `LINKS_RATINGS_MIGRATION.sql`.

## Top 5 recommendation function

Use `TOP_PICKS_MULTIUSER.ts` as the contents of the Supabase Edge Function named `top-picks`, then deploy it again.

The function requires a Supabase secret named `GEMINI_API_KEY`. It verifies the signed-in user, reads that user's taste profile and saved orders, and returns five personalized dishes with a reason, description, and an official item link when one can be identified confidently.

## Restaurant discovery

The app's `search-restaurants` Edge Function must already be deployed. Discovery accepts a five-digit ZIP code and searches within the requested area. Users may search by restaurant/cuisine or tap a suggested category.

## v18 features

- Save all five recommendations or only selected dishes
- Store saved dishes under their restaurant
- Preserve dish descriptions and links
- Open saved restaurants, menus, maps, and linked items
- Add 1–5 star restaurant and item ratings
- Add manual restaurant and item links
- Close every dialog using an X
- Tap `+` suggestions throughout taste-profile onboarding
- Loading animation for searches, recommendations, saving, and network activity
- Pastel pink-and-purple theme and matching mascot app icon
- Properly spaced Top 5 ranking numbers and dish text
- Animated in-card “Pick for me” result
- Context-aware food emojis for restaurants and dishes
- Back-to-results and close controls on discovered restaurant details
- Delete owned restaurants and individual saved items
- Favorite saved dishes and automatically show favorites first
- Prevent Top 5 results from carrying into later restaurant searches
- Animated “Pick for me” selection within new-restaurant recommendations
- Copy dish names directly from restaurant-search recommendations
- Open direct item links from Top 5 cards when available
- More specific restaurant emojis, including 🧋 for boba and ☕ for coffee

## Refreshing after deployment

v18 uses new cache identifiers. After GitHub Pages finishes deploying, refresh the page. If an older version remains visible, close the installed app or browser tab and reopen it. As a last resort, clear the site's stored data or uninstall and reinstall the home-screen app.
