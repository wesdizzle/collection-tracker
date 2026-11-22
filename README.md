# Collection Tracker

A web application for tracking physical video games, individual discs/cartridges/cards, toys-to-life figures (amiibo, Skylanders, Starlink), and collection acquisition provenance. Built with Angular and Cloudflare Workers.

## Features

- **Game & Release Tracking**: Tracks games across 50+ platforms. Distinguishes intellectual property, commercial retail releases, and individual physical media (cartridges, discs, bonus/demo discs).
- **Physical Classification & Release Tracking**: Tracks games across `verified_physical`, `likely_physical`, `unverified`, and `digital_only` classifications alongside release lifecycle states (`announced_unreleased`, `released`) and automated launch-day notifications.
- **Physical Release Verification**: Reconciles items against canonical No-Intro and Redump XML DAT catalogs. Clean titles can override displayed titles and match standard release filenames.
- **Admin Ownership Verification Scanner (`/admin/verify-ownership`)**: Admin-only in-browser scanner using the File System Access API (`window.showDirectoryPicker`) and `<input type="file" webkitdirectory>` fallback to crawl local media directories by filename only (zero file bytes read, hashed, or uploaded) to verify individual disc/cartridge ownership (`has_media`). Gracefully ignores digital-only and unmatched files, proposes **Ownership Switches** when a scanned entry matches a different regional or revision SKU of an already-owned game (preserving `has_case` and `has_manual`), and presents a diff review screen before applying updates.
- **Multi-Disc Sets & Optional Individual Media Tracking**: Opt-in per-user `trackIndividualMedia` preference reveals per-disc/cartridge ownership indicators, a per-disc checklist modal on multi-disc games, and inline disc expansion trays without cluttering standard views or public profiles.
- **Collection Journal (Provenance & Cost Basis)**: Records acquisition date (with approximate date flags), purchase price / cost basis, merchant attribution, gift provenance, receipt verification URLs, and private notes behind authenticated access.
- **Live eBay Market Valuation (Ephemeral 6h Engine)**: Estimates current replacement value (Loose, CIB, New/Sealed) for physical games and toys-to-life items via the official eBay Browse API using IQR outlier rejection and 25th-percentile active-floor estimation, strictly honoring eBay's 6-hour freshness limit with zero eBay data persisted in D1 or backup snapshots (shared across devices via an 8-shard L1 `caches.default` + L2 ephemeral R2 `cache/ebay-prices/` cache and L3 ephemeral IndexedDB). Includes collection-wide valuation scans, cost-basis ROI comparison in Insights, custom query overrides, and a public `/privacy` disclosure route.
- **Toy Collection**: Supports amiibo, Skylanders, and Starlink figures and cards with series tracking, variant classification, and metadata from AmiiboAPI and SCL.
- **Admin Center (`/admin`) & Autonomous Pipelines**: Protected admin dashboard for monitoring cron execution health and triggering catalog seeding, boutique pre-order auto-ingestion, retail deal auto-ingestion, and watched-series IGDB discovery—without exposing manual third-party catalog search to regular users.
- **Watched-Series Alerts, Boutique Drops & Retail Deals**: Monitors followed game series (`notify_watched_series`), limited-print boutique distributors (Limited Run Games, Super Rare Games, iam8bit, Fangamer, Strictly Limited Games), and retail price drops (Best Buy, VGP, PNP Games), dispatching Web Push notifications (RFC 8291 / RFC 8292) with region awareness, stock availability gating, and ownership suppression.
- **OIDC 1.0 / OAuth 2.1 + PKCE (`S256`) Authentication**: Integrates with any standard OpenID Connect identity provider using Authorization Code Flow with PKCE (`S256`), `ES256`/`RS256` JWKS verification, automatic user provisioning, and zero-read stateless HMAC session cookies (`app_user_session`), plus a direct link to the identity provider's Account & Security Hub (`${OIDC_ISSUER}/account`).
- **Command Palette & Mobile Gestures**: Global Command Palette (`Ctrl+K` / `Cmd+K`) for rapid title search, view switching, and quick actions; touch-driven swipeable bottom-sheet modal drawer with velocity physics, rubber-banding, and drag-to-dismiss; independent scroll, filter, and sort state isolation between Games and Toys tabs.
- **Themes & Responsive Layout**: Light, dark, and system-automatic modes with full-bleed desktop header and fixed mobile bottom navigation bar; installable progressive web app (PWA) with offline listing access.

## Tech Stack

- **Frontend**: Angular 21 (Standalone Components, Signals)
- **Styling**: Modern CSS using Material 3 design tokens (`--m3-*`)
- **Testing**: Vitest
- **Build**: Angular CLI (`ng build` with esbuild)
- **Edge API & Hosting**: Cloudflare Workers (`worker/worker.ts`), unified across production edge and local Wrangler development (`npx wrangler dev --local --port 8787`)
- **Isomorphic Domain Library (`shared/`)**: Pure TypeScript modules (`shared/ownership_verifier.ts`, `shared/title_matching.ts`, `shared/canonical_releases.ts`, `shared/switch_revisions.ts`, `shared/queries.ts`, `shared/retail.ts`, `shared/physical_feeds.ts`) shared directly between the Angular browser app and Cloudflare Worker without Node.js dependencies
- **Database**: Cloudflare D1 (SQLite-compatible) in production; Wrangler local D1 SQLite for local staging and development
- **Storage**: Cloudflare R2 for automated daily snapshots

## Architecture & Data Model

### Data Hierarchy & Multi-User Architecture

#### Conceptual Domain Model vs. Physical D1 Schema

The application thinks in three conceptual tiers (**Platform Game → Retail Release (SKU) → Physical Media**) while intentionally flattening the lower two tiers in Cloudflare D1 to avoid extra join hops and write amplification on the D1 Free Tier:

| Conceptual Tier          | Meaning                                                                                                                                                                        | Physical D1 / API Representation                                                                                                                                                                                                                                                                                            |
| :----------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform Game**        | A title on a specific console or handheld (e.g., _Chrono Trigger_ on SNES vs. DS; optional `igdb_id` links cross-platform editions).                                           | [games](migrations/schema.sql) (`stable_id`, `platform_id`, `igdb_id`) + `user_games` (`play_status`, `queued`).                                                                                                                                                                                                            |
| **Retail Release (SKU)** | A specific commercial version/packaging on that platform (Region + Edition/Revision, carrying box/manual completeness and release ownership).                                  | **No separate SQL table.** Grouped virtually on the frontend via [release-grouping.ts](src/app/core/models/release-grouping.ts) (`RetailReleaseView`) on `(game_id, region, variants, getRomGroupingKey)`. Toggling SKU flags (`ownership_status`, `has_case`, `has_manual`) fans out atomically across sibling media rows. |
| **Physical Media**       | An individual disc, cartridge, or card inside a SKU (typically backed by a DAT CRC/name, Redump disc ID, or Nintendo Revised entry). Each release has 1+ physical media items. | `game_releases` + `canonical_releases` (1 row per media item) + `user_game_releases.has_media`. List/chunk APIs emit flat 1-row-per-media `CatalogMediaRow` records (`O(1)` overlay merging) that roll up into `RetailReleaseView.mediaItems[]`.                                                                            |

Keeping `game_releases` 1-row-per-media avoids inserting across two indexed catalog tables on every single-disc ingestion and skips an extra `LEFT JOIN` on every catalog read. Release ownership (`ownership_status`) and individual media verification (`has_media`) are likewise kept independent (no hard cross-table constraint) so opted-out tracking (`track_individual_media = 0`), box/manual-only ownership, and verification discrepancy audits all work naturally.

The database tables model this hierarchy as follows:

1. **Platform Game (`games` table)**: A title on a specific platform (e.g., _Final Fantasy VII_ on PlayStation). Stores platform ID, optional cross-platform `igdb_id`, series classifications, physical status, genres, and retail deal availability.
2. **Physical Media / Catalog Releases (`game_releases` table)**: One row per individual disc, cartridge, or game card within a commercial retail SKU. A multi-disc release has multiple `game_releases` rows sharing `(game_id, region, variants)` and a common `getRomGroupingKey(rom_name)`; companion pack-in discs link via `bundle_parent_id` or `COMPANION_DISC1_PAIRS` and appear in item detail under "Included Discs / Cartridges".
3. **User Collection & Ownership (`users`, `user_game_releases`, `user_games`, `user_toys` tables)**: Decoupled per-user state tracking SKU release ownership status (`owned`, `wishlist`), completeness (`has_case`, `has_manual`), individual physical media verification (`has_media`), per-user display opt-in (`track_individual_media`), and play status (`unplayed`, `playing`, `completed`, `abandoned`). Supports multiple user profiles on a single shared catalog instance.
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
- During ingestion and collection detail views, companion discs are cleanly nested inside the host game's release tray under "Included Discs / Cartridges", preventing namesake base games from stealing pack-in demo media ownership.

### Metadata Reconciliation & Ownership Verification Scanning

Catalog matching, release reconciliation, and admin ownership verification run through pure isomorphic modules in `shared/`:

- **Title Matching Strategies (`shared/title_matching.ts`)**:
  - _Strategy 1 (Exact Match)_: Compares normalized titles with diacritics stripped, punctuation cleaned, and common publisher prefixes removed.
  - _Strategy 2 (Segment/Subtitle Matching)_: Splits titles on colons and dashes to match base games against subtitle variations.
  - _Strategy 3 (Middle-Segment Stripping)_: Handles mission packs and multi-segment naming patterns.
  - _Strategy 4 (Bonus Disc Matching)_: Uses parenthetical identifiers and pack-in host metadata to resolve companion discs.
- **Admin Ownership Verification Scanner (`shared/ownership_verifier.ts`)**:
  - Evaluates local directory trees by filename only, supporting both multi-platform roots (auto-detecting platform subdirectories) and single-platform folders to verify individual physical discs, cartridges, and cards (`has_media`).
  - Matches Switch TitleIDs (`[16-hex]`) and version tags (`[vN]`), optical/cartridge serial codes (`SLUS-01041`), Redump/No-Intro parenthetical region/revision/disc tags, and normalized titles.
  - Gracefully ignores digital-only titles, Switch update/DLC files (`[UPD]`, `[DLC]`, non-`000` TitleIDs), and unmatched files in a collapsible summary drawer.
  - Detects **Ownership Switches** when a game has an owned release SKU without a matched file in the scan while a different SKU of the same game is matched by the scan, proposing an atomic ownership transfer that preserves `has_case` and `has_manual` while keeping `user_games` and `journal_entries` untouched.
- **Strict Physical-Only Boundary**: The catalog tracks physical media exclusively. Ingestion pipelines reject digital installers (`.pkg`), mini-console extractions, and Virtual Console wrappers at the ingestion boundary.
- **Amiibo Multi-Pose Figures & Card Sets (`shared/amiibo_poses.ts`)**: Amiibo entities with multiple swappable physical figures (e.g. Mr. Game & Watch's 4 poses: Default, Parachute, Bell, and Judge) are deterministically expanded into unique catalog entries with canonical pose qualifiers, distinct stable IDs, and pose-specific slugs.
- **Nintendo Switch & Switch 2 Cartridge Revisions (`shared/switch_revisions.ts`)**:
  - Parses verified cartridge revision and reprint data from the Nintendo Revised community catalog across Switch 1 and Switch 2.
  - Automatically resolves `Title [TitleID][vVersion].xci` dump filenames to corresponding canonical revisions and cartridge patch versions.

### Cloudflare Edge Caching & Cache Invalidation

- **Edge Cache API (`caches.default`)**: Public read endpoints (`/api/games`, `/api/toys`, `/api/platforms`) are cached at the edge with `public, max-age=60, s-maxage=3600, stale-while-revalidate=86400`.
- **Normalized Cache Key Purging**: Cache keys strip transient parameters (`bust`, `purge`, `refresh`). Issuing `GET /api/games?bust=1` or `x-cache-purge: true` automatically purges and revalidates the canonical `/api/games` edge entry.

### Cloudflare D1 Quota Preservation & Pre-Flight Cost Guard

Managed serverless databases enforce daily read and write limits (e.g. Cloudflare D1's 100,000 writes/day free tier). The project employs a strict pre-flight protection architecture:

- **Zero-Cost R2 Baseline Hydration (`npm run db:pull`)**: Downloads automated R2 snapshots (`snapshots/latest.json`) to hydrate the local Wrangler D1 database without consuming any D1 read or write quota.
- **Index Write Amplification Accounting ($1 + K$)**: Every inserted, updated, or deleted row in a table with $K$ secondary indexes incurs $1 + K$ billable writes.
- **Standalone Pre-Flight Cost Guard (`scripts/d1_cost_guard.ts`)**: Audits `EXPLAIN QUERY PLAN` for unindexed table scans on large tables, dry-runs execution in a sandbox clone to calculate exact $\sum (\Delta \text{rows} \times (1 + K))$ write costs, and hard-aborts if projected writes exceed `--max-writes`.

### Edge Background Automation Engine

The Cloudflare Worker implements an edge-native background engine (`worker/worker.ts`) triggered on a **30-minute cron cadence** (`*/30 * * * *`):

1. **Rolling IGDB Series & Franchise Sync**: Refreshes upstream IGDB series, franchises, and canonical grouping in 100-game batches using a persistent cursor (`igdb_sync_offset`).
2. **Hourly Boutique Storefront Feeds & Pre-Order Auto-Ingestion**: Scrapes limited-print physical storefront feeds (LRG, SRG, iam8bit, Fangamer, Strictly Limited) every 55 minutes, matching existing titles, auto-ingesting up to 10 new pre-orders per run as `likely_physical` with IGDB metadata enrichment, evaluating tracking rules, and dispatching push alerts.
3. **Daily Switch Revision & Amiibo Catalog Sync**: At 23:30 UTC, synchronizes Nintendo Switch & Switch 2 physical cartridge revisions from the Nintendo Revised community spreadsheet (`syncWorkerSwitchRevisions`) and synchronizes new or updated Amiibo figures/cards from AmiiboAPI (`syncWorkerAmiiboCatalog`), gated by SHA-256 payload hashes in `sync_state` so unchanged days incur 0 D1 writes.
4. **Broad Physical Catalog Promotion & IGDB Backfill**: Gradually promotes verified physical entries from `canonical_releases` into `games` and `game_releases` within daily Free Tier write budgets (`syncWorkerBroadCatalogPopulation`) and enriches bare entries with IGDB metadata (`syncWorkerIgdbMetadataBackfill`).
5. **Watched-Series IGDB Discovery & Retail Auto-Ingestion**: Periodically scans up to 4 active watched series per 2-hour rolling cursor (`syncWorkerWatchedSeriesDiscovery`, up to 10 physical candidates per run) and auto-ingests up to 15 verified retail listings per run (`syncWorkerRetailDeals` with IGDB match or 8–14 digit barcode), evaluating user tracking rules and dispatching watched-series alerts.
6. **Automated Daily R2 Snapshots**: Dumps core D1 tables (`snapshots/latest.json`) and diff-guarded `canonical_releases` (`snapshots/canonical_releases.json`, triggered only when `canonical_releases_dirty = '1'` or row metadata changes) into Cloudflare R2 at 23:30 UTC, automatically pruning snapshots older than 30 days.
7. **Launch-Day Transitions**: Automatically transitions announced titles (`announced_unreleased`) whose release date has arrived into the active catalog.

### Web Push Notifications Engine

- **Web Crypto Standards**: Push payload encryption (`aes128gcm`) is implemented natively in `worker/web_push.ts` using the W3C Web Cryptography API (`crypto.subtle`) with ECDH key agreement (P-256) and RFC 8292 VAPID authorization, guarded by an explicit HTTPS push-service hostname allowlist to prevent SSRF.
- **Granular Notification Settings**: Users can configure push alert preferences for retail deals, boutique physical announcements, and watched series additions (`notify_watched_series`, coalesced into a summary when more than 3 titles arrive together) via an interactive modal.
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
3. **Configure environment variables**:
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
4. **Pull latest R2 snapshot into local D1 (optional)**:
   ```bash
   npm run db:pull
   ```
5. **Start local development server**:
   ```bash
   npm run dev
   ```
   Initializes the local Wrangler D1 database from `migrations/schema.sql` and starts `npx wrangler dev --local --port 8787` alongside the Angular dev server (`ng serve`).

## Privacy-Preserving Deployment & CI/CD

No Cloudflare account IDs, D1 database UUIDs, personal domains, or secret keys are committed to tracked files (`wrangler.toml` keeps `database_id = "local-dev-db"` in Git).

### Configuration Matrix: Code vs. Cloudflare Secrets vs. GitHub Actions Secrets

| Location                              | Variable / Setting                                                                                                                                                                                                                                                                               | Purpose                                                                                                                                                                    |
| :------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tracked Code (`wrangler.toml`)**    | `database_id = "local-dev-db"`                                                                                                                                                                                                                                                                   | Placeholder for local Wrangler dev and clean git history.                                                                                                                  |
| **Local `.dev.vars` (gitignored)**    | `D1_DATABASE_ID`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `SESSION_SECRET`, `TWITCH_*`, `VAPID_*`, `APP_*`                                                                                                                                                                                              | Used by `npm run dev`, `npm run secrets:push`, and local `npm run deploy`.                                                                                                 |
| **Cloudflare Worker Secrets**         | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `MARKET_PRICING_ACCESS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `APP_NAME`, `APP_SHORT_NAME`, `APP_TAGLINE`, `APP_REPO_URL` | Runtime secrets injected into `env` on the Cloudflare Worker edge. Uploaded via `npm run secrets:push` or `npx tsx scripts/deploy.ts --put-secret <KEY>`.                  |
| **GitHub Actions Repository Secrets** | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `D1_DATABASE_ID`                                                                                                                                                                                                                                | Used by `.github/workflows/ci.yml` (`deploy` job) to inject `D1_DATABASE_ID` into `wrangler.toml` in-memory during `npm run deploy` and restore `wrangler.toml` afterward. |

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

### Development, Database & Quality Gates

| Command                                             | Description                                                                            |
| :-------------------------------------------------- | :------------------------------------------------------------------------------------- |
| `npm start`                                         | Runs Angular dev server via `ng serve`                                                 |
| `npm run dev`                                       | Initializes local D1 schema and runs Wrangler local Worker + Angular dev server        |
| `npm run db:pull`                                   | Pulls latest production snapshot + `canonical_releases` from R2 into local D1          |
| `npm run db:bootstrap`                              | Initializes schema, seeds 547 retired toys, and syncs canonical DATs into local SQLite |
| `npm run sources:fetch`                             | Fetches Redump/No-Intro DATs and offline physical sources (`-- --source=...`)          |
| `npm run sources:sync`                              | Syncs DATs, offline sources & `data/sources/community/*.csv`, reconciling releases     |
| `npm run sources:update`                            | Runs `sources:fetch` followed by `sources:sync` for full offline source maintenance    |
| `npm run d1:cost-guard`                             | Verifies static schema index bounds (`1 + K`) and `EXPLAIN QUERY PLAN` on critical SQL |
| `npm run d1:cost-guard -- --file=<sql> [--confirm]` | Pre-flight cost guard validating write budgets and index plans for migrations          |
| `npm run build`                                     | Compiles production Angular bundle to `dist/tracker`                                   |
| `npm run deploy`                                    | Builds bundle and deploys Worker + Assets with secret-injected `database_id`           |
| `npm run secrets:push`                              | Uploads configured secrets from `.dev.vars` / env to Cloudflare Worker                 |
| `npm test`                                          | Runs frontend (`test:ng`) and shared/worker/scripts (`test:node`) test suites          |
| `npm run test:ng`                                   | Runs frontend unit tests via Vitest                                                    |
| `npm run test:node`                                 | Runs isomorphic `shared/`, `worker/`, and `scripts/` tests via Vitest                  |
| `npm run type-check`                                | Runs TypeScript compiler checks (`tsc --noEmit`)                                       |
| `npm run lint`                                      | Runs ESLint                                                                            |
| `npm run format:check`                              | Verifies codebase formatting via Prettier                                              |
| `npm run ci-check`                                  | Runs lint, format:check, type-check, d1:cost-guard, tests, and production build        |

## Custom Branding & Environment Configuration

The app defaults to **Collection Tracker** as a neutral instance name. Deployers can customize branding, OIDC authentication, and notifications via environment variables or Cloudflare Worker secrets:

| Variable                | Description                                                                | Default                                  |
| :---------------------- | :------------------------------------------------------------------------- | :--------------------------------------- |
| `OIDC_ISSUER`           | OIDC Identity Provider issuer URL (e.g. `https://id.example.com`)          | _(Optional on localhost; required prod)_ |
| `OIDC_CLIENT_ID`        | OIDC Client ID registered with the identity provider                       | `collection-tracker`                     |
| `SESSION_SECRET`        | Dedicated HMAC-SHA256 secret for signing `app_user_session` & OIDC cookies | _(Recommended)_                          |
| `ADMIN_SESSION_DAYS`    | Duration in days for signed `app_user_session` cookies                     | `30`                                     |
| `ADMIN_EMAIL`           | Contact email used in VAPID `mailto:` claim and admin role fallback        | _(Optional)_                             |
| `ADMIN_KEY`             | Optional secret token for headless CLI / API administrative access         | _(Optional)_                             |
| `APP_NAME`              | Title shown in header, page titles, and exports                            | `Collection Tracker`                     |
| `APP_SHORT_NAME`        | Short name for PWA home screen tiles                                       | `Tracker`                                |
| `APP_TAGLINE`           | Tagline for SEO and metadata                                               | `Physical Game & Toy Collection Tracker` |
| `APP_AUTHOR`            | Author credit in exported CSV and DAT files                                | `Collection Tracker`                     |
| `APP_REPO_URL`          | Optional repository URL rendered as a GitHub icon link in the app header   | _(Optional)_                             |
| `CUSTOM_FAVICON_SVG`    | Optional raw SVG string served at `/favicon.svg`                           | Cartridge emblem (`/favicon.svg`)        |
| `TWITCH_CLIENT_ID`      | Twitch Client ID for real-time IGDB metadata discovery                     | _(Optional)_                             |
| `TWITCH_CLIENT_SECRET`  | Twitch Client Secret for IGDB OAuth authentication                         | _(Optional)_                             |
| `EBAY_CLIENT_ID`        | eBay Developer Production App ID for live Browse API market valuations     | _(Optional)_                             |
| `EBAY_CLIENT_SECRET`    | eBay Developer Production Cert ID for eBay OAuth client credentials        | _(Optional)_                             |
| `MARKET_PRICING_ACCESS` | Access policy for live eBay valuations (`admin` or `authenticated`)        | `admin`                                  |
| `VAPID_PUBLIC_KEY`      | Web Push VAPID application public key (RFC 8292)                           | _(Built-in default)_                     |
| `VAPID_PRIVATE_KEY`     | Web Push VAPID private key (secret)                                        | _(Optional)_                             |

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
