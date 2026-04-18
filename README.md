# Gagglog Collection Tracker

A premium, high-performance collection tracking application built with **Angular 21**.

## 🚀 Key Features

- **Immersive UI Architecture**: A modern aesthetic that prioritizes content. Item details are presented directly on the background without redundant container panels.
- **Durable Metadata**: Deep integration with IGDB for verified game status, genres, and regional data.
- **Regional Art Overlays**: Intelligent UI that overlays regional markers (e.g., NA, EU, JP) directly onto game art for a clean, consistent look.
- **Signals-First Architecture**: Leveraging Angular 21 Signals for high-performance state management and reactive delivery.

## 🛠️ Architecture & Technical Standards

### Visual System
The UI utilizes a minimalist approach to structure:
- **Collection Grid**: Uses subtle glass-morphism panels to provide structure to the grid items.
- **Detail Pages**: Removes standard dashboard panels in favor of a flat, immersive layout that places focus on the item's metadata and artwork.
- **Badge Consolidation**: Status markers (Owned, Played, IGDB) are consolidated into high-level pill groups in the header.

### Navigation & Scroll Restoration
The application implements a robust manual scroll restoration system to ensure a seamless "back-to-list" experience:
- **State Persistence**: The `CollectionService` persists the list's filters, pagination state (`displayLimit`), and exact scroll coordinates in memory and `sessionStorage`.
- **Race Condition Handling**: Restoration is synchronized with asynchronous data fetching. The UI awaits data arrival and uses a "double-scroll" technique (re-applying scroll position on the next animation frame) to handle layout shifts caused by lazy-loading and dynamic rendering.
- **Layout Stability**: To guarantee restoration accuracy, the system avoids `translateY` animations and `content-visibility: auto` shifts during the restoration phase, ensuring the scroll target remains constant.

## 📦 Getting Started

1.  **Clone the repository**
2.  **Install dependencies**: `npm install`
3.  **Run Local API Proxy**: `npx tsx scripts/local_server.ts`
4.  **Launch Frontend**: `npx ng serve`
5.  **View locally**: `http://localhost:4200/`

## 🛡️ Engineering Standards
- **In-Code Comments**: All complex logic is thoroughly documented explaining the technical intent.
- **Colocated Testing**: Unit tests reside alongside the components they validate.
- **Premium Aesthetics**: Curated HSL palettes and sleek dark modes used throughout the application.
