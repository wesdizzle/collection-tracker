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
- **Boutique Physical Announcements & Deal Alerts**: Monitors limited-print boutique distributors (Limited Run Games, Super Rare Games, iam8bit, Fangamer, Strictly Limited Games) and retail price drops (Best Buy, VGP, PNP Games), dispatching Web Push notifications (RFC 8291 / RFC 8292) with region awareness, stock availability gating, and ownership suppression.
- **OIDC 1.0 / OAuth 2.1 + PKCE (`S256`) Authentication**: Integrates with any standard OpenID Connect identity provider using Authorization Code Flow with PKCE (`S256`), `ES256`/`RS256` JWKS verification, automatic user provisioning, and zero-read stateless HMAC session cookies (`app_user_session`), plus a direct link to the identity provider's Account & Security Hub (`${OIDC_ISSUER}/account`).
- **Command Palette & Mobile Gestures**: Global Command Palette (`Ctrl+K` / `Cmd+K`) for rapid title search, view switching, and quick actions; touch-driven swipeable bottom-sheet modal drawer with velocity physics, rubber-banding, and drag-to-dismiss; independent scroll, filter, and sort state isolation between Games and Toys tabs.
- **Themes & Responsive Layout**: Light, dark, and system-automatic modes with full-bleed desktop header and fixed mobile bottom navigation bar; installable progressive web app (PWA) with offline listing access.

## Tech Stack

- **Frontend**: Angular 21 (Standalone Components, Signals)
- **Styling**: Modern CSS using Material 3 design tokens (`--m3-*`)
- **Testing**: Vitest
- **Build**: Angular CLI (`ng build` with esbuild)
- **Edge API & Hosting**: Cloudflare Workers (`worker/worker.ts`), unified across production edge and local development via a `better-sqlite3` `D1Database` adapter (`scripts/local_server.ts`)
- **Database**: Cloudflare D1 (SQLite-compatible) in production; Wrangler local D1 SQLite (`better-sqlite3`) for local staging and development
- **Storage**: Cloudflare R2 for automated daily snapshots

## Architecture & Data Model

### Data Hierarchy & Multi-User Architecture

The database models catalog and collection items across structured tiers:

1. **Catalog Game (`games` table)**: The shared title/intellectual property for a platform (e.g., _Final Fantasy VII_ on PlayStation). Stores platform ID, series classifications, physical status, genres, and retail deal availability.
2. **Catalog Media (`game_releases` table)**: Physical discs, cartridges, or verified ROM images within a commercial retail SKU. A multi-disc game or package with a pack-in demo has multiple `game_releases` records linked to the same `game_id`. Individual media rows are displayed in the item detail view under "Physical Discs / ROMs".
3. **User Collection & Ownership (`users`, `user_game_releases`, `user_games`, `user_toys` tables)**: Decoupled per-user state tracking ownership status (`owned`, `wishlist`), completeness (`has_case`, `has_manual`), backup status, and play status (`unplayed`, `playing`, `completed`, `abandoned`). Supports multiple user profiles on a single shared catalog instance.
4. **Public Profiles & Route Reuse Isolation (`/u/:username`)**: Users can share public profile views (`/u/:username/games`, `/u/:username/toys`). Private collections (`is_public = 0`) return 404 with edge-cache privacy guards (`Cache-Control: private, no-cache`). Angular's custom `CollectionRouteReuseStrategy` isolates detached tab DOM caches by full URL route keys (`u/alice/games` vs `collection/games`), preventing cross-profile state leakage.
5. **Private Acquisition Journal (`journal_entries` table)**: Private provenance, purchase price / cost basis, purchase date, approximate date flag, merchant attribution, gift provenance (`gifted_by`), receipt verification URL, and personal notes for a game or toy, protected behind authenticated session verification.

### OIDC 1.0 / OAuth 2.1 + PKCE (`S256`) Authentication Flow

Authentication uses standard OpenID Connect Authorization Code Flow with PKCE (`S256`) in `worker/auth.ts` and `worker/worker.ts`:

1. **`GET /api/auth/login` (and `/admin/login`)**:
   - Generates a cryptographic 32-byte `code_verifier`, computes `code_challenge = BASE64URL(SHA256(code_verifier))`, and generates random `state` and `nonce` values.
   - Signs and sets a short-lived (10-minute) `HttpOnly; SameSite=Lax` state cookie (`app_oidc_state`) and redirects (`302`) to `${OIDC_ISSUER}/authorize`.
   - On `localhost` when `OIDC_ISSUER` is not configured, automatically mints a local development session cookie for frictionless local testing.
2. **`GET /api/auth/callback`**:
   - Verifies the signed `app_oidc_state` cookie and compares the `state` query parameter in constant time.
   - Exchanges `code` + `code_verifier` at `POST ${OIDC_ISSUER}/token`.
   - Verifies the returned `id_token` signature (`ES256` P-256 or `RS256`) against `${OIDC_ISSUER}/.well-known/jwks.json` (cached in isolate memory with a 60-second unknown-`kid` refetch cooldown) and validates `iss`, `aud`, `exp`, and `nonce`.
   - Resolves or auto-provisions the user in D1 `users` (executing a diff-only `UPDATE` when `email`, `preferred_username`, or `role` changes) and mints the stateless HMAC-SHA256 `app_user_session` cookie so all subsequent read requests require **0 D1 user queries**.
3. **`GET /api/auth/account`**:
   - Redirects authenticated users to the centralized Account & Security Hub (`${OIDC_ISSUER}/account`) where they can manage their profile, username, email, passkeys, and 2FA.

### Public Authoritative Sources & Aggregation Architecture

The application is designed as an aggregator and organizer over public, authoritative backing data. Anyone who spins up a fresh fork of this repository can populate all catalog details, canonical physical signatures, budget line statuses, and toy metadata from scratch using publicly available sources without needing private databases:

- **Official No-Intro Datomatic v4 XML Datafiles**: Downloaded from the public Spludlow mirror (`https://data.spludlow.co.uk/no-intro/no-intro/<System>.xml`), providing canonical physical ROM signatures, SHA1/CRC hashes, and serial codes, with automatic fallback to libretro-database mirrors.
- **Redump Live Web Tables & Cross-Links**: Dynamically aggregates optical disc editions, serials, barcodes, and pack-in cross-links from `http://redump.org/discs/system/<slug>/`, disc pages `/disc/<id>/`, and `/disc/<id>/sfv/`.
- **Wikipedia MediaWiki Action API**: Fetches and parses official manufacturer budget line wikitables (`Nintendo_Selects`, `PlayStation_Hits`, `Essentials_(PlayStation)`, `Platinum_Hits`) to extract regional induction dates across all console generations.
- **Nintendo Revised Community Catalog**: Syncs verified cartridge revision and reprint data from the community Google Spreadsheet across Nintendo Switch 1 & 2.
- **AmiiboAPI**: Master REST catalog for all Amiibo figures, cards, and series (`https://amiiboapi.com/api/amiibo/`).
- **Skylanders Character List (SCL)**: Visual sitemaps (`post-sitemap.xml`, etc.) parsing every figure URL, variant, and high-res image.
- **Starlink Fandom Wiki API**: Full catalog and high-res assets for Starlink: Battle for Atlas modular ships, pilots, and weapons.
- **IGDB API**: Commercial releases, platforms, franchises, categories, and cover art.

### Deterministic Budget Line Status Engine

Budget line re-releases are deterministically classified to distinguish whether a physical release was _only ever_ released under a budget banner vs. sometimes in standard packaging and sometimes in budget packaging:

- **Budget Only (`variants = <Label>`, Solid Amber Badge)**: Assigned when a physical cartridge or revised edition was exclusively manufactured and sold under a budget banner in that region.
- **Standard and Budget (`also_released_as = <Label>`, Dashed Amber Badge `± <Label>`)**: Assigned when the release initially launched at full retail in standard packaging prior to the budget-line induction date, with subsequent printings also available under the budget line.
- **Temporal Induction Rule**: Evaluates the physical release launch date $D_{\text{release}}(R)$ against the regional budget-line induction date $D_{\text{budget}}(R)$ parsed from Wikipedia.

### Pack-In Demo & Companion Disc Provenance

Retail packages containing bonus discs, soundtrack CDs, or pack-in demos (such as _The Misadventures of Tron Bonne_ on PS1 including the _Mega Man Legends 2_ playable demo disc) are aggregated deterministically:

- Redump disc pages expose cross-links in their comments table (`Includes <a href=/disc/13075/>Mega Man Legends 2 (USA) (Demo)</a>` and `Bundled with <a href=/disc/13074/>The Misadventures of Tron Bonne</a>`).
- In `canonical_releases`, companion pack-in discs are linked to the host game via `packin_host_normalized_title` and store their `redump_disc_id`.
- During ingestion and collection detail views, companion discs are cleanly nested inside the host game's release tray under "Physical Discs / ROMs", preventing namesake base games from stealing pack-in demo backups.

### Metadata Ingestion & Physical Reconciliation

Heavy scraping and data indexing are performed locally against staging SQLite and synchronized to Cloudflare D1:

- **Canonical DAT & Source Sync (`npm run sources:sync`)**: Syncs DAT files in `dats/`, aggregates Wikipedia budget lines, resolves pack-in provenance, and updates `canonical_releases`.
- **Title Matching Strategies (`scripts/lib/title_matching.ts`)**:
  - _Strategy 1 (Exact Match)_: Compares normalized titles with diacritics stripped, punctuation cleaned, and common publisher prefixes removed.
  - _Strategy 2 (Segment/Subtitle Matching)_: Splits titles on colons and dashes to match base games against subtitle variations.
  - _Strategy 3 (Middle-Segment Stripping)_: Handles mission packs and multi-segment naming patterns.
  - _Strategy 4 (Bonus Disc Matching)_: Uses parenthetical identifiers and pack-in host metadata to resolve companion discs.
- **Strict Physical-Only Boundary**: The catalog tracks physical media exclusively. Ingestion pipelines and DAT parsers reject digital installers (`.pkg`), mini-console extractions, and Virtual Console wrappers at the ingestion boundary.
- **Amiibo Multi-Pose Figures & Card Sets**: Amiibo entities with multiple swappable physical figures (e.g. Mr. Game & Watch's 4 poses: Default, Parachute, Bell, and Judge) are deterministically expanded into unique catalog entries with canonical pose qualifiers, distinct stable IDs, and pose-specific slugs.
- **Nintendo Switch & Switch 2 Cartridge Revisions (`scripts/sync_switch_revisions.ts`)**:
  - Ingests verified cartridge revision and reprint data from the Nintendo Revised community catalog across Switch 1 and Switch 2 tabs.
  - Automatically resolves `Title [TitleID][vVersion].xci` dump filenames to corresponding canonical revisions and cartridge patch versions.

### Cloudflare Edge Caching & Cache Invalidation

- **Edge Cache API (`caches.default`)**: Public read endpoints (`/api/games`, `/api/toys`, `/api/platforms`) are cached at the edge with `public, max-age=60, s-maxage=3600, stale-while-revalidate=86400`.
- **Normalized Cache Key Purging**: Cache keys strip transient parameters (`bust`, `purge`, `refresh`). Issuing `GET /api/games?bust=1` or `x-cache-purge: true` automatically purges and revalidates the canonical `/api/games` edge entry.

### Cloudflare D1 Quota Preservation & Pre-Flight Cost Guard

Managed serverless databases enforce daily read and write limits (e.g. Cloudflare D1's 100,000 writes/day free tier). The project employs a strict pre-flight protection architecture:

- **Zero-Cost R2 Baseline Hydration (`npm run db:pull-r2`)**: Downloads automated R2 snapshots (`snapshots/latest.json`) to hydrate a local clone (`data/remote_baseline.db`) without consuming any D1 read or write quota.
- **Index Write Amplification Accounting ($1 + K$)**: Every inserted, updated, or deleted row in a table with $K$ secondary indexes incurs $1 + K$ billable writes.
- **Standalone Pre-Flight Cost Guard (`scripts/lib/d1_cost_guard.ts`)**: Audits `EXPLAIN QUERY PLAN` for unindexed table scans on large tables, dry-runs execution in a sandbox clone to calculate exact $\sum (\Delta \text{rows} \times (1 + K))$ write costs, and hard-aborts if projected writes exceed `--max-writes`.

### Edge Background Automation Engine

The Cloudflare Worker implements an edge-native background engine (`worker/worker.ts`) triggered on a **30-minute cron cadence** (`*/30 * * * *`):

1. **Rolling IGDB Series & Franchise Sync**: Refreshes upstream IGDB series, franchises, and canonical grouping in 100-game batches using a persistent cursor (`igdb_sync_offset`).
2. **Hourly Boutique Storefront Feeds**: Scrapes limited-print physical storefront feeds (LRG, SRG, iam8bit, Fangamer, Strictly Limited) every 55 minutes, evaluating stock availability, region alignment, and existing collection ownership before dispatching push alerts.
3. **Automated Daily R2 Snapshots**: Dumps all D1 tables into structured, timestamped JSON backups in Cloudflare R2 at 23:30 UTC whenever data has changed, automatically pruning snapshots older than 30 days.
4. **Launch-Day Transitions**: Automatically transitions announced titles (`announced_unreleased`, `physical_pending`) whose release date has arrived into the active catalog.

### Web Push Notifications Engine

- **Web Crypto Standards**: Push payload encryption (`aes128gcm`) is implemented natively in `worker/web_push.ts` using the W3C Web Cryptography API (`crypto.subtle`) with ECDH key agreement (P-256) and RFC 8292 VAPID authorization, guarded by an explicit HTTPS push-service hostname allowlist to prevent SSRF.
- **Granular Notification Settings**: Users can configure push alert preferences for retail deals and boutique physical announcements via an interactive modal.
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
   Creates local Wrangler D1 SQLite database with canonical schema, platforms, and default taxonomies.
4. **Configure environment variables**:
   Create a `.dev.vars` file in the root directory (gitignored):
   ```env
   D1_DATABASE_ID=your_cloudflare_d1_database_uuid
   OIDC_ISSUER=https://id.example.com
   OIDC_CLIENT_ID=collection-tracker
   SESSION_SECRET=your_random_32_byte_session_secret
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
   Starts the Angular dev server alongside `scripts/local_server.ts`, which executes the production Cloudflare Worker (`worker/worker.ts`) directly in Node.js backed by Wrangler's local D1 SQLite database via a `better-sqlite3` `D1Database` adapter.

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

## Privacy-Preserving Deployment & CI/CD

No Cloudflare account IDs, D1 database UUIDs, personal domains, or secret keys are committed to tracked files (`wrangler.toml` keeps `database_id = "local-dev-db"` in Git).

### Configuration Matrix: Code vs. Cloudflare Secrets vs. GitHub Actions Secrets

| Location                              | Variable / Setting                                                                                                                                                                                                              | Purpose                                                                                                                                                                    |
| :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tracked Code (`wrangler.toml`)**    | `database_id = "local-dev-db"`                                                                                                                                                                                                  | Placeholder for local Wrangler dev and clean git history.                                                                                                                  |
| **Local `.dev.vars` (gitignored)**    | `D1_DATABASE_ID`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `SESSION_SECRET`, `TWITCH_*`, `VAPID_*`, `APP_*`                                                                                                                             | Used by `npm run dev`, `npm run secrets:push`, and local `npm run deploy`.                                                                                                 |
| **Cloudflare Worker Secrets**         | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `APP_NAME`, `APP_SHORT_NAME`, `APP_TAGLINE`, `APP_REPO_URL` | Runtime secrets injected into `env` on the Cloudflare Worker edge. Uploaded via `npm run secrets:push` or `npx tsx scripts/deploy.ts --put-secret <KEY>`.                  |
| **GitHub Actions Repository Secrets** | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `D1_DATABASE_ID`                                                                                                                                                               | Used by `.github/workflows/ci.yml` (`deploy` job) to inject `D1_DATABASE_ID` into `wrangler.toml` in-memory during `npm run deploy` and restore `wrangler.toml` afterward. |

### Registering `collection-tracker` with Your OIDC Identity Provider

Configure a public OIDC client in your identity provider with Authorization Code Flow + PKCE (`S256`):

- **`client_id`**: `collection-tracker`
- **`redirect_uris`**:
  - `https://<your-tracker-domain>/api/auth/callback`
  - `http://localhost:8787/api/auth/callback`
  - `http://localhost:4200/api/auth/callback`

### Deploying to Cloudflare Workers

1. **Create Cloudflare D1 database & R2 backup bucket**:
   ```bash
   npx wrangler d1 create collection-db
   npx wrangler r2 bucket create collection-backups
   ```
2. **Add `D1_DATABASE_ID` and runtime secrets to `.dev.vars`** and push Worker secrets to Cloudflare:
   ```bash
   npm run secrets:push
   # Or upload a single secret:
   npx tsx scripts/deploy.ts --put-secret OIDC_ISSUER
   npx tsx scripts/deploy.ts --put-secret OIDC_CLIENT_ID
   ```
3. **Deploy locally or via GitHub Actions**:
   - **Local deploy**: `npm run deploy` (builds the Angular bundle, temporarily substitutes `D1_DATABASE_ID` into `wrangler.toml`, runs `npx wrangler deploy`, and restores `wrangler.toml` in a `finally` block).
   - **GitHub Actions CI/CD**: Pushing to `main` or `master` runs `build-and-test` (`format:check`, `type-check`, `lint`, `test`, `build`) followed by the `deploy` job using `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `D1_DATABASE_ID`.

## CLI Commands

### Database & Scraper Scripts

| Command                                                  | Description                                                                             |
| :------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `npm run db:init`                                        | Initializes fresh local Wrangler D1 SQLite database from schema and migrations          |
| `npm run db:backup`                                      | Exports atomic WAL-safe binary, SQL, and JSON backups locally                           |
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
| `npm run scrape`                                         | Runs multi-tier IGDB and canonical DAT reconciliation against local collection          |
| `npm run scrape -- --discovery`                          | Discovers missing games and all toy lines (Amiibo, Skylanders, Starlink) as Wanted      |
| `npm run scan-backups`                                   | Scans local backup directories to detect ROM files and match against games              |
| `npm run local-api`                                      | Runs local Express adapter forwarding `/api/*` requests to the Cloudflare Worker        |
| `npm run sync:bestbuy`                                   | Manually scrapes current retail game deals from Best Buy, VGP, and PNP Games            |

### Development, Deployment & Quality Gates

| Command                | Description                                                                  |
| :--------------------- | :--------------------------------------------------------------------------- |
| `npm start`            | Runs Angular dev server via `ng serve`                                       |
| `npm run dev`          | Runs local Worker API server and Angular frontend concurrently               |
| `npm run build`        | Compiles production Angular bundle to `dist/tracker`                         |
| `npm run deploy`       | Builds bundle and deploys Worker + Assets with secret-injected `database_id` |
| `npm run secrets:push` | Uploads configured secrets from `.dev.vars` / env to Cloudflare Worker       |
| `npm test`             | Runs frontend (`test:ng`) and script/worker (`test:node`) test suites        |
| `npm run test:ng`      | Runs frontend unit tests via Vitest                                          |
| `npm run test:node`    | Runs backend worker and scraper tests via Vitest                             |
| `npm run type-check`   | Runs TypeScript compiler checks (`tsc --noEmit`)                             |
| `npm run lint`         | Runs ESLint                                                                  |
| `npm run format:check` | Verifies codebase formatting via Prettier                                    |
| `npm run ci-check`     | Runs lint, type-check, tests, and production build sequentially              |

## Custom Branding & Environment Configuration

The app defaults to **Collection Tracker** as a neutral instance name. Deployers can customize branding, OIDC authentication, and notifications via environment variables or Cloudflare Worker secrets:

| Variable               | Description                                                                | Default                                  |
| :--------------------- | :------------------------------------------------------------------------- | :--------------------------------------- |
| `OIDC_ISSUER`          | OIDC Identity Provider issuer URL (e.g. `https://id.example.com`)          | _(Optional on localhost; required prod)_ |
| `OIDC_CLIENT_ID`       | OIDC Client ID registered with the identity provider                       | `collection-tracker`                     |
| `SESSION_SECRET`       | Dedicated HMAC-SHA256 secret for signing `app_user_session` & OIDC cookies | _(Recommended)_                          |
| `ADMIN_SESSION_DAYS`   | Duration in days for signed `app_user_session` cookies                     | `30`                                     |
| `ADMIN_EMAIL`          | Contact email used in VAPID `mailto:` claim and admin role fallback        | _(Optional)_                             |
| `ADMIN_KEY`            | Optional secret token for headless CLI / API administrative access         | _(Optional)_                             |
| `APP_NAME`             | Title shown in header, page titles, and exports                            | `Collection Tracker`                     |
| `APP_SHORT_NAME`       | Short name for PWA home screen tiles                                       | `Tracker`                                |
| `APP_TAGLINE`          | Tagline for SEO and metadata                                               | `Physical Game & Toy Collection Tracker` |
| `APP_AUTHOR`           | Author credit in exported CSV and DAT files                                | `Collection Tracker`                     |
| `APP_REPO_URL`         | Optional repository URL rendered as a GitHub icon link in the app header   | _(Optional)_                             |
| `CUSTOM_FAVICON_SVG`   | Optional raw SVG string served at `/favicon.svg`                           | Cartridge emblem (`/favicon.svg`)        |
| `TWITCH_CLIENT_ID`     | Twitch Client ID for real-time IGDB metadata discovery                     | _(Optional)_                             |
| `TWITCH_CLIENT_SECRET` | Twitch Client Secret for IGDB OAuth authentication                         | _(Optional)_                             |
| `BESTBUY_API_KEY`      | Optional Best Buy API key for enhanced deal scanning                       | _(Optional)_                             |
| `VAPID_PUBLIC_KEY`     | Web Push VAPID application public key (RFC 8292)                           | _(Built-in default)_                     |
| `VAPID_PRIVATE_KEY`    | Web Push VAPID private key (secret)                                        | _(Optional)_                             |

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
