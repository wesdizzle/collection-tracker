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

### Data Hierarchy & Multi-User Architecture

The database models catalog and collection items across structured tiers:

1. **Catalog Game (`games` table)**: The shared title/intellectual property for a platform (e.g., _Final Fantasy VII_ on PlayStation). Stores platform ID, series classifications, physical status, genres, and pricing.
2. **Catalog Media (`game_releases` table)**: Physical discs, cartridges, or verified ROM images within a commercial retail SKU. A multi-disc game or package with a pack-in demo has multiple `game_releases` records linked to the same `game_id`. Individual media rows are displayed in the item detail view under "Physical Discs / ROMs".
3. **User Collection & Ownership (`users`, `user_game_releases`, `user_games`, `user_toys` tables)**: Decoupled per-user state tracking ownership status (`owned`, `wishlist`), completeness (`has_case`, `has_manual`), backup status, and play status (`unplayed`, `playing`, `completed`, `abandoned`). Supports multiple user profiles on a single shared catalog instance.
4. **Public Profiles & Route Reuse Isolation (`/u/:username`)**: Users can share public profile views (`/u/:username/games`, `/u/:username/toys`). Private collections (`is_public = 0`) return 404 with edge-cache privacy guards (`Cache-Control: private, no-cache`). Angular's custom `CollectionRouteReuseStrategy` isolates detached tab DOM caches by full URL route keys (`u/alice/games` vs `collection/games`), preventing cross-profile state leakage.
5. **Private Acquisition Journal (`journal_entries` table)**: Private provenance, purchase price / cost basis, purchase date, approximate date flag, merchant attribution, gift provenance (`gifted_by`), receipt verification URL, and personal notes for a game or toy, protected behind authenticated session verification.

### Public Authoritative Sources & Aggregation Architecture

The application is designed as an aggregator and organizer over public, authoritative backing data. Anyone who spins up a fresh fork of this repository can populate all catalog details, canonical physical signatures, budget line statuses, and toy metadata from scratch using publicly available sources without needing private databases:

- **Official No-Intro Datomatic v4 XML Datafiles**: Downloaded from the public Spludlow mirror (`https://data.spludlow.co.uk/no-intro/no-intro/<System>.xml`), providing canonical physical ROM signatures, SHA1/CRC hashes, and serial codes, with automatic fallback to libretro-database mirrors.
- **Redump Live Web Tables & Cross-Links**: Dynamically aggregates optical disc editions, serials, barcodes, and pack-in cross-links from `http://redump.org/discs/system/<slug>/`, disc pages `/disc/<id>/`, and `/disc/<id>/sfv/`.
- **Wikipedia MediaWiki Action API**: Fetches and parses official manufacturer budget line wikitables (`Nintendo_Selects`, `PlayStation_Hits`, `Essentials_(PlayStation)`, `Platinum_Hits`) to extract regional induction dates across all console generations.
- **Nintendo Revised Community Catalog**: Syncs verified cartridge revision and reprint data from the community Google Spreadsheet across Nintendo Switch 1 & 2.
- **AmiiboAPI**: Master REST catalog for all Amiibo figures, cards, and series (`https://amiiboapi.com/api/amiibo/`).
- **Skylanders Character List (SCL)**: Visual sitemaps (`post-sitemap.xml`, etc.) parsing every figure URL, variant, and high-res image.
- **PriceCharting & Starlink Fandom Wiki API**: Full catalog and high-res assets for Starlink: Battle for Atlas modular ships, pilots, and weapons.
- **IGDB API**: Commercial releases, platforms, franchises, categories, and cover art.

### Deterministic Budget Line Status Engine

Budget line re-releases are deterministically classified to distinguish whether a physical release was _only ever_ released under a budget banner vs. sometimes in standard packaging and sometimes in budget packaging:

- **Budget Only (`variants = <Label>`, Solid Amber Badge)**: Assigned when a physical cartridge or revised edition was exclusively manufactured and sold under a budget banner in that region.
- **Standard and Budget (`also_released_as = <Label>`, Dashed Amber Badge `± <Label>`)**: Assigned when the release initially launched at full retail in standard packaging prior to the budget-line induction date, with subsequent printings also available under the budget line.
- **Temporal Induction Rule**: Evaluates the physical release launch date $D_{\text{release}}(R)$ against the regional budget-line induction date $D_{\text{budget}}(R)$ parsed from Wikipedia:
  - _Example 1 (Animal Crossing: New Leaf - Welcome amiibo in USA)_: Cartridge `CTR-P-EAAE` launched December 2, 2016, which is $\ge$ the North American Nintendo Selects induction date of August 26, 2016. Because standard non-Selects packaging never existed for the US _Welcome amiibo_ physical cartridge, it is deterministically classified as **`variants: 'Nintendo Selects'`** (`budget_only`).
  - _Example 2 (Animal Crossing: New Leaf - Welcome amiibo in Europe)_: Cartridge `CTR-P-EAAP` launched November 25, 2016, which is $<$ the European Nintendo Selects induction date of June 29, 2018. It is classified as **`also_released_as: 'Nintendo Selects'`** (`standard_and_budget`).
  - _Example 3 (Original Animal Crossing: New Leaf)_: Launched 2012/2013 prior to budget line induction in all regions -> Classified as **`also_released_as: 'Nintendo Selects'`**.

### Pack-In Demo & Companion Disc Provenance

Retail packages containing bonus discs, soundtrack CDs, or pack-in demos (such as _The Misadventures of Tron Bonne_ on PS1 including the _Mega Man Legends 2_ playable demo disc) are aggregated deterministically:

- Redump disc pages expose cross-links in their comments table (`Includes <a href=/disc/13075/>Mega Man Legends 2 (USA) (Demo)</a>` and `Bundled with <a href=/disc/13074/>The Misadventures of Tron Bonne</a>`).
- In `canonical_releases`, companion pack-in discs are linked to the host game via `packin_host_normalized_title` (e.g. `themisadventuresoftronbonne`) and store their `redump_disc_id`.
- During ingestion and collection detail views, companion discs are cleanly nested inside the host game's release tray under "Physical Discs / ROMs", preventing namesake base games (e.g. standalone _Mega Man Legends 2_) from stealing pack-in demo backups.

### Metadata Ingestion & Physical Reconciliation

Heavy scraping and data indexing are performed locally against staging SQLite and synchronized to Cloudflare D1:

- **Canonical DAT & Source Sync (`npm run sources:sync`)**: Syncs DAT files in `dats/`, aggregates Wikipedia budget lines, resolves pack-in provenance, and updates `canonical_releases`.
- **Title Matching Strategies (`scripts/lib/title_matching.ts`)**:
  - _Strategy 1 (Exact Match)_: Compares normalized titles with diacritics stripped, punctuation cleaned, and common publisher prefixes removed.
  - _Strategy 2 (Segment/Subtitle Matching)_: Splits titles on colons and dashes to match base games against subtitle variations.
  - _Strategy 3 (Middle-Segment Stripping)_: Handles mission packs and multi-segment naming patterns.
  - _Strategy 4 (Bonus Disc Matching)_: Uses parenthetical identifiers and pack-in host metadata to resolve companion discs.
- **Strict Physical-Only Boundary**: The catalog tracks physical media exclusively. Ingestion pipelines and DAT parsers reject digital installers (`.pkg`), mini-console extractions, and Virtual Console wrappers at the ingestion boundary. The obsolete `is_physical` column has been completely purged from the schema, queries, and models, guaranteeing zero digital bloat.
- **Amiibo Multi-Pose Figures & Card Sets**: Amiibo entities with multiple swappable physical figures (e.g. Mr. Game & Watch's 4 poses: Default, Parachute, Bell, and Judge) are deterministically expanded into unique catalog entries with canonical pose qualifiers, distinct stable IDs, and pose-specific slugs. Duplicate card variants across series (such as Animal Crossing and Street Fighter 6 promotional cards) are disambiguated by wave and set markers.
- **Bundles & Download Vouchers**: When physical releases include digital vouchers for companion games, the voucher details are shown as an informative note on the parent release without penalizing physical media backup status.
- **Nintendo Switch & Switch 2 Cartridge Revisions (`scripts/sync_switch_revisions.ts`)**:
  - Ingests verified cartridge revision and reprint data from the Nintendo Revised community catalog across Switch 1 and Switch 2 tabs.
  - _Ground-Truth Regional Attribution_: Explicit regional cartridge codes (`LA-H-XXXXX-USA/EUR/JPN`) and documented regional reprint notes are strictly preserved. Past revisions lacking explicit regional documentation are cataloged as `'World'` releases and displayed across all regional filters.
  - _nxdumptool Integration_: Automatically resolves `Title [TitleID][vVersion].xci` dump filenames to corresponding canonical revisions and cartridge patch versions.

### Cloudflare Edge Caching & Cache Invalidation

- **Edge Cache API (`caches.default`)**: Public read endpoints (`/api/games`, `/api/toys`, `/api/platforms`) are cached at the edge with `public, max-age=60, s-maxage=3600, stale-while-revalidate=86400`.
- **Normalized Cache Key Purging**: Cache keys strip transient parameters (`bust`, `purge`, `refresh`). Issuing `GET /api/games?bust=1` or `x-cache-purge: true` automatically purges and revalidates the canonical `/api/games` edge entry.

### Cloudflare D1 Quota Preservation & Pre-Flight Cost Guard

Managed serverless databases enforce daily read and write limits (e.g. Cloudflare D1's 100,000 writes/day free tier). The project employs a strict pre-flight protection architecture:

- **Zero-Cost R2 Baseline Hydration (`npm run db:pull-r2`)**: Downloads automated R2 snapshots (`snapshots/latest.json`) to hydrate a local clone (`data/remote_baseline.db`) without consuming any D1 read or write quota.
- **Index Write Amplification Accounting ($1 + K$)**: Every inserted, updated, or deleted row in a table with $K$ secondary indexes incurs $1 + K$ billable writes. For example, modifying a row in `game_releases` ($K=8$) incurs 9 billable writes; `games` ($K=11$) incurs 12 billable writes.
- **Standalone Pre-Flight Cost Guard (`scripts/lib/d1_cost_guard.ts`)**: Standalone runner that parses candidate migration SQL, audits `EXPLAIN QUERY PLAN` for unindexed table scans on large tables, dry-runs execution in a sandbox clone to calculate exact $\sum (\Delta \text{rows} \times (1 + K))$ write costs, and hard-aborts if projected writes exceed `--max-writes`. Remote execution occurs only when explicitly confirmed via `--confirm`.

### Edge Background Automation Engine

The Cloudflare Worker implements an edge-native background engine (`worker/worker.ts`) triggered on a **30-minute cron cadence** (`*/30 * * * *`):

1. **Rolling GAMEYE / PriceCharting Valuations**: Fetches loose, CIB, and new valuations in batches of 25 games and 11 toys using persistent primary-key cursors (`gameye_game_cursor`, `gameye_toy_cursor`) stored in `sync_state`, avoiding full-table scans.
2. **Rolling IGDB Series & Franchise Sync**: Refreshes upstream IGDB series, franchises, and canonical grouping in 100-game batches using a persistent cursor (`igdb_sync_offset`), refreshing the full 4,337-game catalog every 21.7 hours in a single subrequest per run.
3. **Hourly Boutique Storefront Feeds**: Scrapes limited-print physical storefront feeds (LRG, SRG, iam8bit, Fangamer, Strictly Limited) every 55 minutes, evaluating stock availability, region alignment, and existing collection ownership before dispatching push alerts.
4. **Automated Daily R2 Snapshots**: Dumps all D1 tables—including `users`, `user_game_releases`, `user_games`, and `user_toys`—into structured, timestamped JSON backups in Cloudflare R2 at 23:30 UTC whenever data has changed, automatically pruning snapshots older than 30 days.
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

### Clean Fork Setup (Populating Catalog from Public Sources)

Anyone spinning up a fork of this repository can populate all non-personal catalog details (game signatures, Switch cartridge revisions, budget line metadata, pack-in demo homing, and toy figures) directly from public authoritative sources:

```bash
# 1. Initialize schema and platforms
npm run db:init

# 2. Download canonical Datomatic v4 XMLs and Redump DATs
npm run dats:download

# 3. Aggregate budget lines, Redump pack-in cross-links, Switch revisions, and populate canonical_releases
npm run sources:sync

# 4. Discover and populate games and all toy lines (Amiibo, Skylanders, Starlink)
npm run scrape -- --discovery
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
   npx wrangler d1 execute collection-db --remote --file=migrations/0025_canonical_edition_and_packin_provenance.sql -y
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

| Command                                                  | Description                                                                             |
| :------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `npm run db:init`                                        | Initializes fresh local `collection.sqlite` from schema and migrations                  |
| `npm run db:backup`                                      | Exports binary, SQL, and JSON backups locally                                           |
| `npm run db:pull`                                        | Pulls latest production snapshot from Cloudflare R2 into local staging SQLite           |
| `npm run db:pull-r2`                                     | Downloads latest R2 snapshot and constructs `data/remote_baseline.db` (0 D1 quota cost) |
| `npm run sources:download`                               | Downloads latest official No-Intro Datomatic v4 XMLs and Redump DATs into `dats/`       |
| `npm run sources:sync`                                   | Aggregates DATs, Wikipedia budget lines, Redump pack-ins, and Switch revisions          |
| `npm run sources:sync:platform -- --platform=<name\|id>` | Runs scoped canonical sync for a single platform to minimize D1 write quota             |
| `npm run sources:update`                                 | Runs `sources:download` and `sources:sync` in a single combined pipeline                |
| `npm run sources:dry-run`                                | Analyzes canonical sources and estimates D1 write quota usage without modifying data    |
| `npm run sources:sync-switch`                            | Synchronizes Switch 1 & 2 revisions from Nintendo Revised spreadsheet                   |
| `npm run d1:cost-guard -- --file=<sql> [--confirm]`      | Pre-flight cost guard validating write budgets and index plans for migrations           |
| `npm run d1:deploy-switch [--confirm]`                   | Deploys Switch cartridge revision delta to remote D1 via the Pre-Flight Cost Guard      |
| `npm run scrape`                                         | Runs multi-tier IGDB and PriceCharting reconciliation against local collection          |
| `npm run scrape -- --discovery`                          | Discovers missing games and all toy lines (Amiibo, Skylanders, Starlink) as Wanted      |
| `npm run scan-backups`                                   | Scans local backup directories to detect ROM files and match against games              |
| `npm run local-api`                                      | Runs standalone local Express API server proxying collection requests                   |
| `npm run sync:bestbuy`                                   | Manually scrapes current retail game deals from Best Buy                                |
| `npx tsx scripts/reconcile_toy_pricing.ts`               | Manually reconciles toy pricing and GAMEYE IDs                                          |

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
