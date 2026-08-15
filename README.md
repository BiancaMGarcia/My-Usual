# My Usual v29

My Usual is a pastel pink-and-purple restaurant and order-saving PWA with private user accounts, ZIP-code restaurant discovery, personalized Top 5 menu recommendations, ratings, and a guided taste profile.

## GitHub Pages files

Upload these thirteen files to the repository root:

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`
- `manifest.webmanifest`
- `icon-192.png`
- `icon-512.png`
- `avatar-husky-blue.png`
- `avatar-brown-peach.png`
- `avatar-samoyed-lavender.png`
- `avatar-white-mint.png`
- `avatar-spitz-pink.png`
- `avatar-shepherd-yellow.png`

Keep the filenames exactly as shown. The homepage must be named `index.html`.

In GitHub, open **Settings → Pages**, select **Deploy from a branch**, then choose the main branch and `/ (root)`.

## Required Supabase database update

Before testing v28 saving, run all of `LINKS_RATINGS_MIGRATION.sql` once in the Supabase **SQL Editor**.

It adds restaurant website and Maps links, restaurant ratings, item descriptions and links, and item ratings. Without it, saving may fail because the new columns do not exist.

For a database that has not previously been converted to separate user accounts, run `MULTIUSER_MIGRATION.sql` first, followed by `LINKS_RATINGS_MIGRATION.sql`.

## Top 5 recommendation function

Use `TOP_PICKS_MULTIUSER.ts` as the contents of the Supabase Edge Function named `top-picks`, then deploy it again.

The function requires a Supabase secret named `GEMINI_API_KEY`. It verifies the signed-in user, reads that user's taste profile and saved orders, and returns five personalized dishes with a reason, description, and an official item link when one can be identified confidently.

## Restaurant discovery

Replace the contents of the Supabase Edge Function named `search-restaurants` with `SEARCH_RESTAURANTS_V2_RADIUS.ts`, then deploy it. It logs `SEARCH_RESTAURANTS_VERSION=v2-radius-live-search` on every request so the deployed version is easy to verify.

Discovery accepts a five-digit ZIP code as a starting point and an adjustable 5–50 mile radius. The function uses live Google Search, asks for up to 15 results across nearby cities, and supports partial-name and spelling-variation matching. Users may search by restaurant/cuisine or tap a suggested category.

## Required Supabase avatar update

Run `PROFILE_AVATAR_MIGRATION.sql` once in the Supabase SQL Editor. This adds the saved profile-avatar choice for each user.

## Manual restaurant details function

Create or replace the Supabase Edge Function named `lookup-restaurant` with `LOOKUP_RESTAURANT_V1.ts`, then deploy it. It uses the existing `GEMINI_API_KEY` secret and logs `LOOKUP_RESTAURANT_VERSION=v1-live-details-did-you-mean`.

## v29 features

- Six selectable pastel cartoon dog profile avatars
- Saved avatar replaces the generic person emoji across devices
- Manual restaurant form can find official menu, website, and Google Maps links
- “Did you mean?” restaurant matches for partial or misspelled names
- Clear Menu, Restaurant website, and Google Maps link labels

- Adjustable 5–50 mile restaurant-search radius
- Remembers the user's last selected radius
- Sends structured ZIP and radius data to restaurant search
- Encourages expanding the radius when no nearby matches are found

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
- Ground Top 5 recommendations in the selected location's current menu before ranking dishes
- Fall back through grounded search, URL context, direct official-site reading, and strict menu lookup
- Force a fresh service-worker load so restaurant emoji updates appear immediately
- Replace homepage links with the discovered menu/order page after menu analysis
- Rate saved items from a dedicated five-star dialog
- Find and populate descriptions and links for manually added items
- Store and display distinct item, menu, restaurant-website, and Maps link types
- Sign up and sign in with email and password
- Offer “Did you mean?” choices when a manually entered item name is not an exact menu match
- Rerun item lookup automatically after the user selects a suggested menu name
- Retry restaurant and item saving safely when link-type columns have not propagated to the schema cache
- Populate manual-item descriptions only from text attached to the exact item on the retrieved menu
- Leave descriptions blank instead of generating generic dish summaries

## Refreshing after deployment

v29 uses new cache identifiers. After GitHub Pages finishes deploying, refresh the page. If an older version remains visible, close the installed app or browser tab and reopen it. As a last resort, clear the site's stored data or uninstall and reinstall the home-screen app.
