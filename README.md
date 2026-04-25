# Gagglog Collection Tracker

A collection tracking application built with **Angular 21**.

## 🚀 Key Features

- **Toy Collection & Grounding**: Full support for amiibo, Skylanders, and Starlink with verified metadata, regional tracking, and automated discovery.
- **Durable Metadata**: Deep integration with IGDB for games and AmiiboAPI/SCL for toys.
- **Manual Discovery Pipeline**: A suggestion-based matching workflow for ambiguous items, surfaced through a generated discovery report for human-in-the-loop verification.
- **Signals-First Architecture**: Leveraging Angular 21 Signals for high-performance state management and reactive delivery.

## 💻 Tech Stack

- **Frontend**: Angular 21 (Signals, Standalone Components)
- **Styling**: Vanilla CSS with HSL-based design tokens
- **Build/Test**: Vite & Vitest
- **Database**: Cloudflare D1 (SQLite-compatible)
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
- **Status Pills**: Consolidated status markers (Owned, Played, Backed Up) use high-contrast expressive chip patterns for instant recognition.

### Navigation & Filter Logic
The application prioritizes a consistent browsing context by isolating collection state (filters, pagination, and scroll position) between the **Games** and **Toys** collections:
- **Isolated Contexts**: Your active filters and scroll position on the Games page are stored separately from those on the Toys page. Switching between the two tabs will restore each respective state exactly as you left it.
- **Intelligent Series Filtering**: The series filter is case and accent insensitive (e.g., searching for `poke` will match `Pokémon`), and supports substring matching for improved searchability.
- **Persistent Context**: Clicking the "Gagglog" brand logo, using the browser's back button, or navigating via the "Back to Collection" link will all maintain your active context for the current tab.
### Metadata Reconciliation & Discovery
The application includes a robust Node-based pipeline (`scripts/scrape.ts`) for maintaining collection integrity and discovering new content:
- **Multi-Pass Search**: Automatically falls back to simplified title searches if a direct platform match isn't found, handling complex bundle and special edition naming patterns.
- **Confidence Scoring**: Uses word-overlap and category heuristics to automatically reconcile high-confidence matches. Ambiguous items are offloaded to a manual `discovery_report.md` for user verification.
- **Verification Signals**: Uses the presence of an `igdb_id` or `pricecharting_url` as a permanent verification signal, preventing the scraper from overwriting manually curated metadata.
- **Local D1 Synchronization**: A dedicated sync script ensures changes made to the local SQLite source-of-truth are propagated to Wrangler's internal state.
- **Database Integrity Guard**: A dedicated test suite (`scripts/lib/db_integrity.spec.ts`) protects the core SQLite file from accidental deletions or additions by asserting precise counts for games and toys, including granular "Owned" vs "Wanted" status tracking for all collection lines.


## 📦 Getting Started

1.  **Clone the repository**
2.  **Install dependencies**: `npm install`
3.  **Run Local API Proxy**: `npx tsx scripts/local_server.ts`
4.  **Metadata Scraping**:
    - **Reconcile**: `npx tsx scripts/scrape.ts` (Processes unmatched games and toys)
    - **Discover**: `npx tsx scripts/scrape.ts --discovery` (Finds missing games/toys in your series)
    - **Toy Sync**: `npx tsx scripts/sync_toys.ts` (Updates toy metadata from external sources)
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

- [ ] **Worker-Side Image Caching**: Implement a KV-based cache for IGDB cover art to reduce external API dependency.
- [ ] **Heuristic Scrubber**: Introduce an automated web-search heuristic to determine physical release status for IGDB games and only track those with physical releases.