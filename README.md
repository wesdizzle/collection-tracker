# 🎮 Gagglog: Collection Tracker

A technical portal for tracking and reconciling video game and figure collections. Built with **Angular 21**, the system utilizes a **Signals-based, Zoneless architecture** and a modern dark-mode aesthetic.

## 🚀 Technical Architecture

The system utilizes a **Hybrid Architecture** to balance local development stability with production performance:

*   **Production**: Cloudflare Workers + D1 (SQLite) + Workers Assets v3.
*   **Development**: Standalone Node.js API Server + Angular Dev Server (to bypass local Cloudflare runtime restrictions).
*   **Frontend**: Angular 21 (Signals/Zoneless).
*   **Database**: Cloudflare D1 (managed as `collection.sqlite` locally).
*   **External API**: IGDB (Twitch API) for automated metadata reconciliation.

### Data Integrity & Regional Reconciliation
The system includes a dedicated regional metadata pipeline that enforces strict assignments for specific titles (JP, EU, SEA) through a manual override map in `scripts/lib/igdb.ts`. This ensures that regional variants of games like *Mother 3* or *Chrono Cross* are correctly categorized regardless of automated heuristic defaults.

## 🎨 Aesthetics & Design
The application utilizes a curated visual theme defined by:
- **Color Palette**: A dark foundation utilizing deep purples (`#1A0B2E`) and slate-blues, with high-contrast fuchsia (`#f0abfc`) and pink accents for highlights, interactive elements, and ambient glows.
- **Typography**: Uses **Outfit** for headings and **Inter** for body text via Google Fonts.
- **Iconography**: A custom **SVG favicon** featuring the "G" character set in the Outfit font against a deep purple circular background.

## 🛠️ Data Model & Schema
The project uses a normalized SQLite schema in Cloudflare D1:

*   **Games Table**: Tracks titles, IGDB IDs, and regional assignments. Normalized to `platform_id`.
*   **Platforms Table**: Supports hardware hierarchies (e.g., PS VR as a child of PS4) via `parent_platform_id`.
*   **Figures Table**: Tracks physical collectible metadata and series lines.

## 🏗️ Deployment Workflow

The project uses the **Workers Assets (v3)** model for deployment:

1.  **Build**: `npm run build` generates the Angular application.
2.  **Deploy**: `npm run deploy` triggers a database migration, builds the assets, and deploys the Standalone Worker (`worker/worker.ts`) and static assets to Cloudflare via Wrangler.

## 🔍 Local Development

The project uses a dedicated local orchestrator to manage the dev environment:

1.  **Orchestrator**: Managed via `npx tsx scripts/dev.ts` (or `npm run dev`).
2.  **Standalone API**: A local Node.js server (`scripts/local_server.ts`) serves the collection data directly from `collection.sqlite` on Port 3000, bypassing `wrangler dev` for increased stability on local machines.
3.  **Sync Database**: Propagation of local SQLite state to the hidden Wrangler cache for CLI testing.
4.  **Discovery Phase**: A dedicated report (`discovery_report.md`) identifies ambiguous titles for manual reconciliation via the web interface.
