# Collection Tracker

A web application for tracking physical video games, toys-to-life figures (amiibo, Skylanders, Starlink), digital backups, and collection acquisition provenance. Built with Angular and Cloudflare Workers.

## Features

- **Game & Release Tracking**: Tracks games across 50+ platforms. Distinguishes intellectual property, commercial retail releases, and individual physical media (cartridges, discs, bonus/demo discs).
- **Announced & Upcoming Physical Games Pipeline**: Tracks games from initial reveal through launch with fine-grained lifecycle states (`announced_unreleased`, `physical_pending`, `likely_physical`, `digital_only`, `released`) and automated launch-day status transitions.
- **Physical Release Verification**: Reconciles items against canonical No-Intro and Redump XML DAT catalogs. Clean ROM titles can override displayed titles, matching filenames used by ROM managers.
- **Multi-Disc Sets**: Groups multi-disc releases with inline disc expansion trays to track backup status per disc.
- **Collection Journal (Provenance & Cost Basis)**: Records acquisition date (with approximate date flags), purchase price / cost basis, merchant attribution, gift provenance, receipt verification URLs, and private notes behind authenticated access.
- **Toy Collection**: Supports amiibo, Skylanders, and Starlink figures and cards with series tracking, variant classification, and metadata from AmiiboAPI and SCL.
- **Discovery Pipeline**: Integrated search across IGDB and AmiiboAPI to identify uncollected titles, sequels, and figures with automated variant matching.
- **Model Context Protocol (MCP) Server**: Edge-native Streamable HTTP JSON-RPC 2.0 server (`/mcp` and `/api/mcp`) exposing 8 read-only tools for AI assistants (Google Gemini, Claude, Cursor) to quickly query game and toy ownership, physical completeness, market valuations, and deals with sub-millisecond indexed responses.
- **Pricing & Market Valuations**: Tracks loose, CIB (Complete in Box), and new market values for games and toys with aggregate collection valuation metrics and direct PriceCharting links.
- **Boutique Physical Announcements & Deal Alerts**: Monitors limited-print boutique distributors (Limited Run Games, Super Rare Games, iam8bit, Fangamer, Strictly Limited Games) and retail price drops (Best Buy, VGP, PNP Games), dispatching Web Push notifications (RFC 8291 / RFC 8292) with region awareness, stock availability gating, and ownership suppression.
- **Command Palette & Mobile Gestures**: Global Command Palette (`Ctrl+K` / `Cmd+K`) for rapid title search, view switching, and quick actions; touch-driven swipeable bottom-sheet modal drawer with velocity physics, rubber-banding, and drag-to-dismiss; independent scroll, filter, and sort state isolation between Games and Toys tabs.
- **Themes & Responsive Layout**: Light, dark, and system-automatic modes with full-bleed desktop header and fixed mobile bottom navigation bar; installable progressive web app (PWA) with offline listing access.

## Tech Stack

- **Frontend**: Angular 21 (Standalone Components, Signals)
- **Styling**: Modern CSS using Material 3 design tokens (`--m3-*`)
- **Testing**: Vitest
- **Build**: Angular CLI (`ng build` with esbuild)
- **Edge API & Hosting**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite-compatible) in production; SQLite (`better-sqlite3`) for local staging
- **Storage**: Cloudflare R2 for automated daily snapshots

## Architecture & Data Model

### Data Hierarchy

The database models collection items across four tiers:

1. **Game (`games` table)**: The title/intellectual property for a platform (e.g., _Final Fantasy VII_ on PlayStation). Stores series classifications, physical status, genres, and pricing.
2. **Release**: The commercial retail SKU published in a territory. The collection list view displays one card per release.
3. **Media (`game_releases` table)**: Physical discs, cartridges, or ROM images within that release. A multi-disc game or package with a pack-in demo has multiple `game_releases` records linked to the same `game_id`. Individual media rows are displayed in the item detail view under "Physical Discs / ROMs".
4. **Journal Entry (`journal_entries` table)**: Private provenance, purchase price, purchase date, approximate date flag, merchant attribution, gift provenance (`gifted_by`), receipt verification URL, and personal notes for a game or toy.

### Metadata Ingestion & Physical Reconciliation

Heavy scraping and data indexing are performed locally against staging SQLite and synchronized to Cloudflare D1:

- **Canonical DAT Sync (`scripts/sync_canonical_dats.ts`)**: Parses No-Intro and Redump XML DAT files in `dats/` to build the `canonical_releases` index.
- **Title Matching Strategies (`scripts/lib/title_matching.ts`)**:
  - _Strategy 1 (Exact Match)_: Compares normalized titles with diacritics stripped, punctuation cleaned, and common publisher prefixes removed.
  - _Strategy 2 (Segment/Subtitle Matching)_: Splits titles on colons and dashes to match base games against subtitle variations.
  - _Strategy 3 (Middle-Segment Stripping)_: Handles mission packs and multi-segment naming patterns.
  - _Strategy 4 (Bonus Disc Matching)_: Uses parenthetical identifiers to resolve pack-in discs.
- **Physical vs. Digital Distinction**: Disregards digital installers (`.pkg`), Virtual Console re-releases, and mini-console wrappers. For PlayStation Vita, canonical retail cartridge serials (`PCSE`, `PCSB`, `PCSG`, `PCSA`) are tagged as `is_verified_physical = 1` while digital-only PSN titles are tagged `0`.
- **Bundles & Download Vouchers**: When physical releases include digital vouchers for companion games, the voucher details are shown as an informative note on the parent release without penalizing physical media backup status.

### Edge Background Automation Engine

The Cloudflare Worker implements an edge-native background engine (`worker/worker.ts`) triggered on a **30-minute cron cadence** (`*/30 * * * *`):

1. **Rolling GAMEYE / PriceCharting Valuations**: Fetches loose, CIB, and new valuations in batches of 25 games and 11 toys using persistent primary-key cursors (`gameye_game_cursor`, `gameye_toy_cursor`) stored in `sync_state`, avoiding full-table scans.
2. **Rolling IGDB Series & Franchise Sync**: Refreshes upstream IGDB series, franchises, and canonical grouping in 100-game batches using a persistent cursor (`igdb_sync_offset`), refreshing the full 4,337-game catalog every 21.7 hours in a single subrequest per run.
3. **Hourly Boutique Storefront Feeds**: Scrapes limited-print physical storefront feeds (LRG, SRG, iam8bit, Fangamer, Strictly Limited) every 55 minutes, evaluating stock availability, region alignment, and existing collection ownership before dispatching push alerts.
4. **Automated Daily R2 Snapshots**: Dumps all D1 tables into structured, timestamped JSON backups in Cloudflare R2 at 23:30 UTC whenever data has changed, automatically pruning snapshots older than 30 days.
5. **Launch-Day Transitions**: Automatically transitions announced titles (`announced_unreleased`, `physical_pending`) whose release date has arrived into the active catalog.

### Model Context Protocol (MCP) Edge Server

The application implements an edge-native **Model Context Protocol (MCP)** server over **Streamable HTTP** (JSON-RPC 2.0) at `/mcp` and `/api/mcp` without external runtime dependencies:

- **Read-Only Conversational Tools**:
  1. `check_game_ownership`: Checks if a game is owned, returning region, completeness (CIB vs Loose vs Digital), backup status, estimated USD market value, and direct clickable web URL.
  2. `search_collection`: Multi-criteria search across games by title, series, platform, ownership, or backup status.
  3. `get_game_details`: Deep inspection of physical media, multi-disc layouts, demo discs, voucher pack-ins, and price guide.
  4. `check_toy_ownership`: Quick verification of amiibo, Skylander, or Starlink figure/card ownership with web detail URL.
  5. `search_toys`: Filters figures and cards by product line, series, and ownership.
  6. `get_collection_stats`: Returns total games, owned count, backed up count, missing backups, backup completion %, total toys, and total estimated collection value in USD.
  7. `get_platforms`: Primary platforms catalog (child platforms like PSVR and 64DD are subsumed into parent platforms).
  8. `get_active_deals`: Current retail price cuts from Best Buy, VGP, and PNP Games with store and collection URLs.
- **Cloudflare Free Tier Preservation**:
  - Queries leverage case-insensitive B-Tree indexes (`idx_games_title_nocase`, `idx_toys_name_nocase`) reading only **1 to 5 rows** per query instead of performing full table scans.
  - Strict parameterized queries with hard `LIMIT` clauses prevent churn and read amplification.
  - Worker CPU execution time stays below $\approx 2\text{ ms}$ (well within the 10 ms free tier ceiling).
- **Client Configuration (`mcp_config.json`)**:
  ```json
  {
    "mcpServers": {
      "collection-tracker": {
        "url": "https://<your-worker-domain>/mcp"
      }
    }
  }
  ```
- **Authentication**: Publicly readable by default for zero-friction AI assistant integration. If an `MCP_AUTH_KEY` secret is set on Cloudflare, it automatically enforces `Authorization: Bearer <key>` or `?token=<key>`.

### Web Push Notifications Engine

- **Web Crypto Standards**: Push payload encryption (`aes128gcm`) is implemented natively in `worker/web_push.ts` using the W3C Web Cryptography API (`crypto.subtle`) with ECDH key agreement (P-256) and RFC 8292 VAPID authorization.
- **Granular Notification Settings**: Users can configure push alert preferences via an interactive modal:
  - **Retail Deals**: Minimum discount threshold percentage, store toggles (Best Buy, VGP, PNP Games), and platform selection.
  - **Physical Announcements**: Scope filters (`all_unowned`, `uncataloged_only`, `wishlist_only`) for boutique storefront pre-orders (Limited Run Games, Super Rare Games, iam8bit, Fangamer, Strictly Limited Games) and new physical edition drops.
- **Subscription Maintenance**: Automatically purges dead endpoints when push services return `404 Not Found` or `410 Gone`.

## Getting Started

### Local Development Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd collection-tracker
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Initialize local database**:
   ```bash
   npm run db:init
   ```
   Creates local `collection.sqlite` with canonical schema, platforms, and default taxonomies.
4. **Configure environment variables**:
   Create a `.dev.vars` file in the root directory:
   ```env
   TWITCH_CLIENT_ID=your_twitch_client_id
   TWITCH_CLIENT_SECRET=your_twitch_client_secret
   VAPID_PUBLIC_KEY=your_vapid_public_key
   VAPID_PRIVATE_KEY=your_vapid_private_key
   ADMIN_EMAIL=admin@example.com
   ```
5. **Start local development server**:
   ```bash
   npm run dev
   ```

### Cloudflare Deployment

1. **Create Cloudflare D1 database**:
   ```bash
   npx wrangler d1 create collection-db
   ```
2. **Update `wrangler.toml`**: Set `database_id` to the ID returned above.
3. **Apply schema migrations**:
   Execute migrations against remote D1 using Wrangler:
   ```bash
   npx wrangler d1 execute collection-db --remote --file=migrations/0001_initial_schema.sql -y
   # Apply subsequent migrations sequentially, e.g.:
   npx wrangler d1 execute collection-db --remote --file=migrations/0021_cron_performance_indexes.sql -y
   ```
4. **Create R2 backup bucket**:
   Create a bucket named `collection-backups` in the Cloudflare Dashboard or via Wrangler:
   ```bash
   npx wrangler r2 bucket create collection-backups
   ```
5. **Configure Worker Secrets**:
   ```bash
   npx wrangler secret put TWITCH_CLIENT_ID
   npx wrangler secret put TWITCH_CLIENT_SECRET
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put ADMIN_EMAIL
   ```
6. **Deploy**:
   ```bash
   ALLOW_LOCAL_DEPLOY=true npm run deploy
   ```

## CLI Commands

### Database & Scraper Scripts

| Command                                               | Description                                                                        |
| :---------------------------------------------------- | :--------------------------------------------------------------------------------- |
| `npm run db:init`                                     | Initializes fresh local `collection.sqlite` from schema and migrations             |
| `npm run db:backup`                                   | Exports binary, SQL, and JSON backups locally                                      |
| `npm run db:pull`                                     | Pulls latest production snapshot from Cloudflare R2 into local staging SQLite      |
| `npm run dats:download`                               | Downloads latest No-Intro and Redump XML DATs into `dats/`                         |
| `npm run dats:update`                                 | Downloads latest DATs and updates `canonical_releases`                             |
| `npm run dats:sync`                                   | Indexes local DAT releases into `canonical_releases`                               |
| `npm run dats:sync:platform -- --platform=<name\|id>` | Runs scoped DAT sync for a single platform to minimize D1 write quota              |
| `npm run dats:dry-run`                                | Analyzes DATs and estimates Cloudflare D1 write quota usage without modifying data |
| `npm run scan-backups`                                | Scans local backup directories to detect ROM files and match against games         |
| `npm run reconcile-ownership`                         | Reconciles physical ownership status and backup flags across catalog releases      |
| `npm run local-api`                                   | Runs standalone local Express API server proxying collection requests              |
| `npx tsx scripts/sync_bestbuy.ts`                     | Manually scrapes current retail game deals from Best Buy                           |
| `npx tsx scripts/reconcile_toy_pricing.ts`            | Manually reconciles toy pricing and GAMEYE IDs                                     |

### Development & Quality Gates

| Command              | Description                                                                     |
| :------------------- | :------------------------------------------------------------------------------ |
| `npm start`          | Runs Angular dev server via `ng serve`                                          |
| `npm run dev`        | Runs local API proxy and frontend concurrently                                  |
| `npm run build`      | Compiles production Angular bundle to `dist/tracker`                            |
| `npm test`           | Runs frontend (`test:ng`) and script/worker (`test:node`) test suites           |
| `npm run test:ng`    | Runs frontend unit tests via Vitest                                             |
| `npm run test:node`  | Runs backend worker, scraper, and MCP tests                                     |
| `npm run type-check` | Runs TypeScript compiler checks (`tsc --noEmit`)                                |
| `npm run lint`       | Runs ESLint                                                                     |
| `npm run ci-check`   | Runs lint, type-check, tests, and build sequentially (used by pre-commit hooks) |

## Custom Branding & Environment Configuration

The app defaults to **Collection Tracker** as a neutral instance name. Deployers can customize branding, authentication, and notifications via environment variables or Cloudflare Worker secrets:

| Variable               | Description                                                  | Default                                  |
| :--------------------- | :----------------------------------------------------------- | :--------------------------------------- |
| `APP_NAME`             | Title shown in header, page titles, and exports              | `Collection Tracker`                     |
| `APP_SHORT_NAME`       | Short name for PWA home screen tiles                         | `Tracker`                                |
| `APP_TAGLINE`          | Tagline for SEO and metadata                                 | `Physical Game & Toy Collection Tracker` |
| `APP_AUTHOR`           | Author credit in exported CSV and DAT files                  | `Collection Tracker`                     |
| `CUSTOM_FAVICON_SVG`   | Optional raw SVG string served at `/favicon.svg`             | Cartridge emblem (`/favicon.svg`)        |
| `MCP_AUTH_KEY`         | Optional Bearer / query token to protect the `/mcp` endpoint | _(None - public read-only)_              |
| `TWITCH_CLIENT_ID`     | Twitch Client ID for real-time IGDB metadata discovery       | _(Optional)_                             |
| `TWITCH_CLIENT_SECRET` | Twitch Client Secret for IGDB OAuth authentication           | _(Optional)_                             |
| `BESTBUY_API_KEY`      | Optional Best Buy API key for enhanced deal scanning         | _(Optional)_                             |
| `VAPID_PUBLIC_KEY`     | Web Push VAPID application public key (RFC 8292)             | _(Built-in default)_                     |
| `VAPID_PRIVATE_KEY`    | Web Push VAPID private key (secret)                          | _(Optional)_                             |
| `ADMIN_EMAIL`          | Contact email used in VAPID `mailto:` claim and admin checks | _(Optional)_                             |
| `ADMIN_KEY`            | Secret token for direct administrative access                | _(Optional)_                             |
| `ADMIN_SESSION_DAYS`   | Duration in days for admin authentication cookies            | `30`                                     |
| `TEAM_DOMAIN`          | Cloudflare Access team domain for edge role authentication   | _(Optional)_                             |
