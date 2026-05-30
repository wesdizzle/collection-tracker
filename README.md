# Gagglog Collection Tracker

A collection tracking application built with **Angular 21**.

## 🚀 Key Features

- **Toy Collection & Grounding**: Full support for amiibo, Skylanders, and Starlink with verified metadata, regional tracking, and automated discovery.
- **Durable Metadata**: Deep integration with IGDB for games and AmiiboAPI/SCL for toys.
- **Physical Release Reconciliation & ROM Display**: Reconciliation of distinct physical release variants using No-Intro and Redump XML DAT files. All releases (including regional versions and revisions) are displayed as individual items in the UI to allow tracking of multiple copies. When a game matches a physical release, the frontend dynamically overrides the displayed game title with the clean ROM filename (excluding its file extension). This clean ROM title is used everywhere in the UI and is fully supported by the name/series filter search.
- **Manual Discovery Pipeline**: A suggestion-based matching workflow for ambiguous items, surfaced through a generated discovery report for human-in-the-loop verification.
- **Signals-First Architecture**: Leveraging Angular 21 Signals for high-performance state management and reactive delivery.

## 💻 Tech Stack

- **Frontend**: Angular 21 (Signals, Standalone Components)
- **Styling**: Vanilla CSS with HSL-based design tokens
- **Build/Test**: Vite & Vitest
- **Database**: Cloudflare D1 (SQLite-compatible with game releases table tracking distinct regions and release dates)
- **Backend**: Cloudflare Workers

## 🛠️ Architecture & Technical Standards

### Visual System

The application features a **Material 3 Expressive** interface, prioritizing emotional vibrancy, organic motion, and bold brand expression:

- **Expressive Palette**: Uses high-chroma, vibrant color schemes (Gold/Orange/Purple) that adapt to Light and Dark modes.
- **Organic Shapes**: Implements a progressive shape system with increased corner radii (up to 48px) and fully rounded "pill" targets for a tactile feel.
- **Expressive Typography**: Leverages **Roboto Flex** variable fonts for display and headlines, allowing for dynamic weight and width adjustments to emphasize visual hierarchy.
- **Glassmorphism**: Tonal surfaces utilize backdrop-blur effects (glassmorphism) to create depth and focus in complex layouts.
- **Fluid Motion**: Collection items and UI transitions use expressive, spring-based animations to provide immediate, delightful feedback.
- **Dual-Theme Engine**: Full support for Light, Dark, and System-aware modes with a built-in theme switcher.
- **Interactive Status Pills**: Consolidated status markers (Ownership: Unowned/Owned/Seeking/Ordered, Play Status: Unplayed/Played/Playing/Queued/Paused/Dropped, Backup Status) use high-contrast expressive chip patterns for instant recognition. When running via the local proxy, these pills become fully interactive, allowing users to update metadata statuses directly from the detail pages via a sleek modal interface.
- **Verified Badges**: High-contrast indicator badges on both the collection list game cards and game detail pages. In addition to IGDB verification (`🆔`), a dedicated Physical Release Verified badge (`📦`) identifies physical releases backed by parsed No-Intro and Redump XML DAT files.

### Navigation & Filter Logic

The application prioritizes a consistent browsing context by isolating collection state (filters, pagination, and scroll position) between the **Games** and **Toys** collections:

- **Isolated Contexts**: Your active filters and scroll position on the Games page are stored separately from those on the Toys page. Switching between the two tabs will restore each respective state exactly as you left it.
- **Intelligent Name/Series Filtering**: The name/series filter is case and accent insensitive (e.g., searching for `poke` will match both the `Pokémon` series and items with `Pokémon` in their name/title), and supports substring matching for improved searchability.
- **Persistent Context**: Clicking the "Gagglog" brand logo, using the browser's back button, or navigating via the "Back to Collection" link will all maintain your active context for the current tab.

### Metadata Reconciliation & Discovery

The application includes a robust Node-based pipeline (`scripts/scrape.ts`) for maintaining collection integrity and discovering new content:

- **Multi-Pass Search**: Automatically falls back to simplified title searches if a direct platform match isn't found, handling complex bundle and special edition naming patterns.
- **Confidence Scoring**: Uses word-overlap and category heuristics to automatically reconcile high-confidence matches. Ambiguous items are offloaded to a manual `discovery_report.md` for user verification.
- **amiibo Discovery**: The `--discovery` pass automatically identifies all missing amiibo (including cards) from the canonical AmiiboAPI and adds them to your collection as "Unowned" items.
- **Metadata Refresh**: The `--refresh` pass periodically updates images, technical metadata, and queries IGDB for regional release dates for all verified releases. It also normalizes all database slugs to a canonical format and generates an `update_report.md` summarizing the changes.
- **Physical Release Sync & Title Matching**: The `--sync-dats` pass scans the `/dats/` directory for XML DAT files, parses their structure, and reconciles physical releases using a specialized title matching module (`scripts/lib/title_matching.ts`). It avoids word-scrambling side effects by maintaining natural word order, and employs a multi-strategy sequence:
  - _Strategy 1 (Exact Match)_: Compares normalized titles (lowercased, diacritics normalized, punctuation stripped). Normalization rules include:
    - Early stripping of apostrophe-s (`'s`) to cleanly remove publisher/franchise prefixes (e.g., "Disney's" -> "Disney" -> stripped).
    - Normalizing visual character substitutions such as replacing dollar signs (`$`) with `"s"` (e.g., `"Mega Party Game$!"` -> `"Mega Party Games"`).
    - Stripping trailing platform suffixes (e.g., `ds`, `gba`, `3ds`, `wii`) to match database titles like "Plants vs. Zombies DS".
    - Stripping franchise-specific prefixes like "Lara Croft" (e.g., "Lara Croft Tomb Raider - Legend" -> "Tomb Raider - Legend").
  - _Strategy 2 (Segment/Subtitle Matching)_: Splits titles on colons/dashes to match base games against subtitle variants (e.g., matching "Tomb Raider II" against "Tomb Raider II - Starring Lara Croft" or "Super Mario All-Stars" against "Super Mario All-Stars: Limited Edition").
  - _Strategy 3 (Middle-Segment Stripping)_: Handles mission packs and multi-segment layouts (e.g., matching "Grand Theft Auto: London 1969" against "Grand Theft Auto - Mission Pack 1 - London 1969").
  - _Strategy 4 (Bonus Disc Special Matching)_: Uses parenthetical identifiers to resolve bonus and special discs (e.g., "Pokémon Colosseum Bonus Disc").
    It prevents sequel/season collisions by enforcing a strict digit matching check (e.g., separating "Grand Theft Auto" from "London 1969"), while bypassing it for compilation games (e.g. "Marble Madness / Klax" matching "2 Games in One! - Marble Madness + Klax"). Distinct release variants (e.g. regional versions, revisions, and clean Title ID paths for Vita folder dumps) are inserted into the `game_releases` table to track them independently.
- **Strict Format & Platform Constraints**: The sync scraper filters out digital installer `.pkg` files, unheadered NES ROM `.unh` files, digital/virtual releases containing `(Virtual Console)`, and emulator-wrapped collections like `(Genesis Mini)` or `(Anniversary Collection)`. For PlayStation Vita, it strictly parses physical `.psv` card formats, ignoring digital/homebrew folder dumps and `.vpk` packages.
- **Multi-Disc Grouping Rules**: Multiple discs of a game are grouped together on the collection page only if their stripped ROM filenames are identical except for the disc indicators.
- **Verification Signals**: Uses the presence of an `igdb_id` as a permanent verification signal, preventing the scraper from overwriting manually curated metadata.
- **Local D1 Synchronization**: A dedicated sync script ensures changes made to the local SQLite source-of-truth are propagated to Wrangler's internal state.
- **Database Integrity Guard**: A dedicated test suite (`scripts/lib/db_integrity.spec.ts`) protects the core SQLite file from accidental deletions or additions by asserting precise counts for games and toys, including granular ownership status tracking (Unowned, Owned, Seeking, Ordered) for all collection lines.

## 📦 Getting Started

1.  **Clone the repository**
2.  **Install dependencies**: `npm install`
3.  **Run Local API Proxy**: `npx tsx scripts/local_server.ts`
4.  **Metadata Scraping**:
    - **Reconcile**: `npx tsx scripts/scrape.ts` (Processes unmatched games and toys)
    - **Discover**: `npx tsx scripts/scrape.ts --discovery` (Automatically adds missing amiibo and finds series-based games)
    - **Refresh**: `npx tsx scripts/scrape.ts --refresh` (Refreshes metadata for all verified items, updates slugs, and recomputes canonical series)
    - **Recompute Series**: `npx tsx scripts/scrape.ts --recompute-series` (Only recomputes canonical series for all games)
    - **Sync DATs**: `npx tsx scripts/scrape.ts --sync-dats` (Scans `/dats/` directory, parses No-Intro/Redump XML files, and reconciles distinct physical releases in the database)
    - **Scan Backups**: `npm run scan-backups <path-to-backups>` (Scans a backup directory recursively for filename matches against the database's `rom_name` entries in platform folders, updating their backup status in a strictly read-only manner)
    - **Sync**: `npx tsx scripts/sync_local_d1.ts` (Propagates all local changes to the dev server)
5.  **Launch Frontend**: `npx ng serve`
6.  **View locally**: `http://localhost:4200/`

### 🔑 Environment Configuration

Create a `.env` file in the root directory with your IGDB credentials:

```env
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
```

## 🛡️ Engineering Standards

- **In-Code Comments**: All complex logic is thoroughly documented explaining the technical intent.
- **Colocated Testing**: Unit tests reside alongside the components they validate.
- **Premium Aesthetics**: Curated HSL palettes and sleek dark modes used throughout the application.
- **Local CI Validation**: Developers must run `npm run ci-check` before pushing. This script performs Linting, strict Type-Checking, and Unit Testing sequentially.

## 📱 Mobile & PWA Features

The Collection Tracker is optimized for mobile use:

- **Standalone Mode**: Install it on your iOS or Android device for a full-screen, app-like experience without browser chrome.
- **Offline Access**: The core application shell and game lists are cached locally, allowing you to browse your collection without an active internet connection.
- **Safe Area Support**: Full support for modern phone displays with notches and gesture indicators.
- **Touch-First UI**: Refined touch targets and compact layouts for one-handed use.

### Installation

- **iOS**: Open in Safari, tap "Share", and select "Add to Home Screen".
- **Android**: Open in Chrome/Edge and tap "Install" or "Add to Home Screen" when prompted.

## 📋 Roadmap

### 1. Clean up the toy tracking with better backing data and images.
