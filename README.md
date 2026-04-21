# Gagglog Collection Tracker

A collection tracking application built with **Angular 21**.

## 🚀 Key Features

- **Durable Metadata**: Deep integration with IGDB for verified game status, genres, and regional data.
- **Regional Art Overlays**: Intelligent UI that overlays regional markers (e.g., NA, EU, JP) directly onto game art for a clean, consistent look.
- **Signals-First Architecture**: Leveraging Angular 21 Signals for high-performance state management and reactive delivery.

## 💻 Tech Stack

- **Frontend**: Angular 21 (Signals, Standalone Components)
- **Styling**: Vanilla CSS with HSL-based design tokens
- **Build/Test**: Vite & Vitest
- **Database**: Cloudflare D1 (SQLite-compatible)
- **Backend**: Cloudflare Workers

## 🛠️ Architecture & Technical Standards

### Visual System
The UI utilizes a minimalist approach to structure:
- **Collection Grid**: Uses subtle glass-morphism panels to provide structure to the grid items.
- **Detail Pages**: Removes standard dashboard panels in favor of a flat, immersive layout that places focus on the item's metadata and artwork.
- **Badge Consolidation**: Status markers (Owned, Played, IGDB) are consolidated into high-level pill groups in the header.

### Navigation & Filter Logic
The application prioritizes a consistent browsing context by isolating collection state (filters, pagination, and scroll position) between the **Games** and **Figures** collections:
- **Isolated Contexts**: Your active filters and scroll position on the Games page are stored separately from those on the Figures page. Switching between the two tabs will restore each respective state exactly as you left it.
- **Persistent Context**: Clicking the "Gagglog" brand logo, using the browser's back button, or navigating via the "Back to Collection" link will all maintain your active context for the current tab.
- **Scroll Restoration**: Uses a "double-scroll" technique synced with asynchronous data loading to ensure your exact position is maintained even when content is lazy-loaded.

## 📦 Getting Started

1.  **Clone the repository**
2.  **Install dependencies**: `npm install`
3.  **Run Local API Proxy**: `npx tsx scripts/local_server.ts`
4.  **Launch Frontend**: `npx ng serve`
5.  **View locally**: `http://localhost:4200/`

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

## 📋 Roadmap

- [ ] **Overhaul Series Handling**: Update series and franchise handling to treat IGDB as authoritative.
- [ ] **Worker-Side Image Caching**: Implement a KV-based cache for IGDB cover art to reduce external API dependency.
- [ ] **Automated Watchlists & Discovery**: Use the `collections` and `franchises` data in a standalone script to automatically discover and propose missing games from known series, and surface new releases as 'Wanted'.
- [ ] **Heuristic Scrubber**: Introduce an automated web-search heuristic to determine physical release status for IGDB games and only track those with physical releases.
- [ ] **PWA**: Add support for installation as a PWA and offline use.
