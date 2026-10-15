/**
 * MODEL CONTEXT PROTOCOL (MCP) SERVER
 *
 * Implements the Model Context Protocol (MCP) Streamable HTTP transport (JSON-RPC 2.0)
 * directly at the Cloudflare Worker edge.
 *
 * Exposes fast, read-only tools for AI assistants (like Gemini) to query video game
 * and toy collection ownership, physical completeness, media details, market values,
 * and collection statistics without web scraping.
 *
 * PRESERVATION OF CLOUDFLARE FREE TIER:
 * - All queries are read-only (`SELECT`) with indexed columns (`idx_games_title_nocase`, etc.).
 * - Explicit `LIMIT` clauses guarantee low row reads (typically 1-5 rows per query).
 * - Zero third-party runtime dependencies keeping Worker CPU time < 2.5ms.
 */

import { PLATFORM_MAP } from '../scripts/lib/queries';

export interface McpEnv {
  DB: D1Database;
  MCP_AUTH_KEY?: string;
  APP_NAME?: string;
}

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Standard MCP Prompt definition
 */
export interface McpPrompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

/**
 * Standard MCP Resource definition
 */
export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * Standard MCP 2024-11-05 / 2025-03-26 Tool definition
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Strongly typed database query row interfaces for strict TypeScript compatibility
 */
interface GameReleaseRow {
  game_id: string;
  stable_id: number;
  title: string;
  platform: string;
  platform_id: number;
  release_id: string;
  ownership_status: number;
  backup_status: number;
  has_case: number;
  has_manual: number;
  region: string | null;
  variants: string | null;
  physical_status: string | null;
  release_medium: string | null;
  price_loose: number | null;
  price_cib: number | null;
  price_new: number | null;
}

interface SearchGameRow {
  game_id: string;
  title: string;
  series: string | null;
  canonical_series: string | null;
  platform: string;
  ownership_status: number;
  backup_status: number;
  release_date: string | null;
  price_cib: number | null;
  price_loose: number | null;
}

interface GameDetailRow {
  stable_id: number;
  id: string;
  title: string;
  platform_name: string;
  series: string | null;
  canonical_series: string | null;
  summary: string | null;
  genres: string | null;
  franchises: string | null;
  igdb_url: string | null;
  barcode: string | null;
  release_medium: string | null;
  price_loose: number | null;
  price_cib: number | null;
  price_new: number | null;
  retail_on_sale: number | null;
  retail_store: string | null;
  retail_price: number | null;
  retail_regular_price: number | null;
  retail_discount_pct: number | null;
  retail_url: string | null;
}

interface ReleaseMediaRow {
  id: string;
  region: string | null;
  variants: string | null;
  rom_name: string | null;
  rom_crc: string | null;
  backup_status: number;
  ownership_status: number;
  release_date: string | null;
  has_case: number;
  has_manual: number;
}

interface BundledMediaRow {
  id: string;
  title: string;
  bundle_disc_number: number | null;
  release_medium: string | null;
  rom_name: string | null;
  backup_status: number;
}

interface ToyRow {
  id: string;
  name: string;
  line: string | null;
  series: string | null;
  type: string | null;
  release_date: string | null;
  ownership_status: number;
  amiibo_id: string | null;
  series_name: string | null;
}

interface PlatformRow {
  id: number;
  display_name: string;
  brand: string | null;
  launch_date: string | null;
  owned_games: number;
}

interface DealRow {
  id: string;
  title: string;
  platform: string;
  retail_store: string | null;
  retail_price: number | null;
  retail_regular_price: number | null;
  retail_discount_pct: number | null;
  retail_url: string | null;
  ownership_status: number;
}

/**
 * Common platform aliases to ease natural language matching from user prompts
 */
const COMMON_PLATFORM_ALIASES: Record<string, string> = {
  switch: 'Nintendo Switch',
  ns: 'Nintendo Switch',
  gc: 'Nintendo GameCube',
  gcn: 'Nintendo GameCube',
  gamecube: 'Nintendo GameCube',
  wii: 'Wii',
  'wii u': 'Wii U',
  wiiu: 'Wii U',
  n64: 'Nintendo 64',
  snes: 'Super Nintendo Entertainment System',
  sfc: 'Super Famicom',
  nes: 'Nintendo Entertainment System',
  famicom: 'Famicom',
  gb: 'Game Boy',
  gbc: 'Game Boy Color',
  gba: 'Game Boy Advance',
  ds: 'Nintendo DS',
  nds: 'Nintendo DS',
  '3ds': 'Nintendo 3DS',
  ps1: 'PlayStation',
  psx: 'PlayStation',
  ps2: 'PlayStation 2',
  ps3: 'PlayStation 3',
  ps4: 'PlayStation 4',
  ps5: 'PlayStation 5',
  psp: 'PlayStation Portable',
  vita: 'PlayStation Vita',
  psvita: 'PlayStation Vita',
  'ps vita': 'PlayStation Vita',
  xbox: 'Xbox',
  'original xbox': 'Xbox',
  'xbox 360': 'Xbox 360',
  x360: 'Xbox 360',
  'xbox one': 'Xbox One',
  xone: 'Xbox One',
  'xbox series': 'Xbox Series X/S',
  'series x': 'Xbox Series X/S',
  'series s': 'Xbox Series X/S',
  genesis: 'Sega Genesis',
  'mega drive': 'Sega Mega Drive',
  saturn: 'Sega Saturn',
  dreamcast: 'Sega Dreamcast',
  dc: 'Sega Dreamcast',
  gg: 'Sega Game Gear',
  'game gear': 'Sega Game Gear',
};

/**
 * Formats integer cents into a USD currency string (e.g., 1548 -> "$15.48")
 */
export function formatCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || isNaN(cents)) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Resolves a natural language platform name or abbreviation to its canonical parent platform ID
 * and display name, properly subsuming child platforms (e.g. PSVR -> PS4).
 */
export async function resolvePlatform(
  db: D1Database,
  input: string | undefined | null,
): Promise<{ id: number; displayName: string } | null> {
  if (!input || !input.trim()) return null;
  const cleaned = input.trim().toLowerCase();

  // 1. Check known shorthand aliases
  const aliasTarget = COMMON_PLATFORM_ALIASES[cleaned];
  const searchTerm = aliasTarget || input.trim();

  // 2. Query platforms table by display_name or name
  const row = (await db
    .prepare(
      `SELECT p.id, p.display_name, p.parent_platform_id,
              pp.id as parent_id, pp.display_name as parent_display_name
       FROM platforms p
       LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
       WHERE p.display_name COLLATE NOCASE = ? 
          OR p.name COLLATE NOCASE = ?
          OR p.display_name COLLATE NOCASE LIKE ?
       LIMIT 1`,
    )
    .bind(searchTerm, searchTerm, `%${searchTerm}%`)
    .first()) as {
    id: number;
    display_name: string;
    parent_platform_id: number | null;
    parent_id: number | null;
    parent_display_name: string | null;
  } | null;

  if (!row) {
    // 3. Fallback to PLATFORM_MAP lookup
    const idFromMap = PLATFORM_MAP[searchTerm];
    if (idFromMap) {
      const parentRow = (await db
        .prepare(
          `SELECT p.id, p.display_name, p.parent_platform_id,
                  pp.id as parent_id, pp.display_name as parent_display_name
           FROM platforms p
           LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
           WHERE p.id = ?`,
        )
        .bind(idFromMap)
        .first()) as {
        id: number;
        display_name: string;
        parent_platform_id: number | null;
        parent_id: number | null;
        parent_display_name: string | null;
      } | null;
      if (parentRow) {
        if (parentRow.parent_id) {
          return {
            id: parentRow.parent_id,
            displayName:
              parentRow.parent_display_name || parentRow.display_name,
          };
        }
        return { id: parentRow.id, displayName: parentRow.display_name };
      }
    }
    return null;
  }

  // If this platform has a parent platform, subsume it into the parent
  if (row.parent_id) {
    return {
      id: row.parent_id,
      displayName: row.parent_display_name || row.display_name,
    };
  }

  return { id: row.id, displayName: row.display_name };
}

/**
 * Computes physical completeness description based on case, manual, and format
 */
export function computeCompleteness(
  releaseMedium: string | null | undefined,
  hasCase: number | null | undefined,
  hasManual: number | null | undefined,
): string {
  if (releaseMedium === 'digital') return 'Digital';
  const c = Boolean(hasCase);
  const m = Boolean(hasManual);
  if (c && m) return 'CIB (Complete in Box)';
  if (c && !m) return 'Boxed (Missing Manual)';
  if (!c && m) return 'Manual Only';
  return 'Loose (Disc / Cartridge Only)';
}

/**
 * 8 Available Read-Only MCP Tools
 */
export const MCP_TOOLS: McpTool[] = [
  {
    name: 'check_game_ownership',
    description:
      'Checks whether the user owns a specific physical or digital video game in their collection. Returns ownership status, physical completeness (CIB vs Loose), backup status, estimated market value, and a direct clickable URL to the game detail page.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'The title of the game to check (e.g. "Super Mario Galaxy", "Chrono Trigger", "Halo 3").',
        },
        platform: {
          type: 'string',
          description:
            'Optional platform name or abbreviation (e.g. "Wii", "SNES", "Switch", "GameCube", "PS4"). Child platforms like PSVR are subsumed into their parent.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'search_collection',
    description:
      'Searches the collection for games matching a title, series, platform, ownership status, or backup status. Returns matching titles with platform, status, estimated value, and detail page URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Substring or keyword to search in game titles or series names.',
        },
        platform: {
          type: 'string',
          description:
            'Optional platform name or abbreviation to filter by (e.g. "GameCube", "Nintendo 64").',
        },
        ownership: {
          type: 'string',
          enum: ['owned', 'unowned', 'all'],
          description:
            'Filter by ownership status: "owned" (default), "unowned" (wishlist/catalog), or "all".',
        },
        backup_status: {
          type: 'string',
          enum: ['backed_up', 'missing_backup', 'all'],
          description:
            'Filter by digital backup status: "backed_up", "missing_backup", or "all".',
        },
        series: {
          type: 'string',
          description:
            'Filter by canonical series name (e.g. "The Legend of Zelda", "Metroid", "Final Fantasy").',
        },
        limit: {
          type: 'integer',
          description:
            'Maximum number of results to return (default: 10, max: 25).',
        },
      },
    },
  },
  {
    name: 'get_game_details',
    description:
      'Retrieves complete media breakdown, multi-disc layout, vouchers, completeness, price guide (loose/CIB/new), and IGDB summary for a specific game.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'The unique game or release ID (e.g. "super-mario-galaxy-wii").',
        },
        title: {
          type: 'string',
          description: 'Title of the game (if ID is not known).',
        },
        platform: {
          type: 'string',
          description: 'Platform name (used with title if ID is not known).',
        },
      },
    },
  },
  {
    name: 'check_toy_ownership',
    description:
      'Checks whether the user owns a specific amiibo, Skylander, or Starlink figure or card. Returns ownership status, series, release date, and web detail URL.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Figure or card name (e.g. "Wolf Link", "Solaire of Astora", "Spyro").',
        },
        line: {
          type: 'string',
          description:
            'Optional product line: "amiibo", "Skylanders", or "Starlink".',
        },
        series: {
          type: 'string',
          description:
            'Optional series name (e.g. "The Legend of Zelda", "Super Smash Bros.").',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'search_toys',
    description:
      'Searches the toy/figure collection with filtering by name, product line, series, and ownership status.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword to search in figure or card names.',
        },
        line: {
          type: 'string',
          description: 'Product line: "amiibo", "Skylanders", or "Starlink".',
        },
        series: {
          type: 'string',
          description: 'Series name.',
        },
        ownership: {
          type: 'string',
          enum: ['owned', 'unowned', 'all'],
          description: 'Filter by ownership status (default: "owned").',
        },
        limit: {
          type: 'integer',
          description:
            'Maximum number of results to return (default: 15, max: 50).',
        },
      },
    },
  },
  {
    name: 'get_collection_stats',
    description:
      'Retrieves high-level collection metrics: total games tracked, total owned games, total backed up games, missing backup count, backup completion percentage, total toys owned, estimated collection market value in USD, and top platform breakdown.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description:
            'Optional platform name to isolate metrics to a specific system.',
        },
      },
    },
  },
  {
    name: 'get_platforms',
    description:
      'Lists all primary gaming platforms in the collection catalog with their display names, brands, launch dates, and owned game counts. Child platforms (like PSVR) are subsumed into their parents.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_active_deals',
    description:
      'Retrieves current retailer price drops and discounts (Best Buy, VGP, PNP Games) for physical video games tracked in the collection.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description: 'Optional platform filter.',
        },
        min_discount_pct: {
          type: 'integer',
          description:
            'Minimum discount percentage (default: 15, e.g. 20 for 20% off or more).',
        },
      },
    },
  },
  {
    name: 'get_backlog',
    description:
      "Retrieves the user's gaming backlog (owned games marked as unplayed, playing, queued, or paused) with optional platform and status filtering.",
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description:
            'Optional platform name or alias (e.g. "Switch", "GameCube", "PS4").',
        },
        play_status: {
          type: 'string',
          enum: ['all', 'unplayed', 'playing', 'queued', 'paused'],
          description:
            'Filter by specific play status: "unplayed" (not yet started), "playing" (in progress), "queued" (next up), "paused" (on hold), or "all" (any active backlog item). Default: "all".',
        },
        limit: {
          type: 'integer',
          description:
            'Maximum number of backlog games to return (default: 15, max: 50).',
        },
      },
    },
  },
  {
    name: 'get_platform_completion',
    description:
      'Retrieves platform completion and preservation metrics, including owned count, backup count, CIB count, and catalog completion percentage.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description:
            'Optional platform name or alias to inspect. If omitted, returns completion stats across all platforms.',
        },
      },
    },
  },
];

/**
 * Standard MCP Prompts for AI-guided interactions
 */
export const MCP_PROMPTS: McpPrompt[] = [
  {
    name: 'recommend_backlog_game',
    description:
      'Generates a prompt suggesting what game to play next based on owned unplayed or queued games in your collection.',
    arguments: [
      {
        name: 'platform',
        description:
          'Optional platform filter (e.g. "Switch", "GameCube", "PS4").',
        required: false,
      },
      {
        name: 'max_candidates',
        description:
          'Number of backlog games to include for consideration (default: 5).',
        required: false,
      },
    ],
  },
  {
    name: 'audit_missing_backups',
    description:
      'Generates a prompt to audit owned physical games that lack digital backups, prioritizing valuable or fragile media.',
    arguments: [
      {
        name: 'platform',
        description: 'Optional platform filter.',
        required: false,
      },
      {
        name: 'limit',
        description:
          'Maximum number of missing backup candidates to review (default: 10).',
        required: false,
      },
    ],
  },
  {
    name: 'evaluate_deal',
    description:
      'Analyzes a potential game purchase or retailer deal against existing collection ownership, series affinity, and pricing.',
    arguments: [
      {
        name: 'title',
        description: 'Title of the game on sale or being evaluated.',
        required: true,
      },
      {
        name: 'sale_price',
        description: 'Sale price (e.g. "$19.99" or 19.99).',
        required: true,
      },
      {
        name: 'store',
        description: 'Retailer or store name (e.g. "Best Buy", "VGP").',
        required: false,
      },
    ],
  },
];

/**
 * Standard MCP Resources for collection insights and live data feeds
 */
export const MCP_RESOURCES: McpResource[] = [
  {
    uri: 'collection://stats',
    name: 'Collection Overview & Statistics',
    description:
      'Real-time overview of total games tracked, owned counts, backup health, and estimated collection value.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'collection://wishlist',
    name: 'Seeking & Wishlist Items',
    description:
      'List of games currently marked as Seeking or Ordered in the collection.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'collection://deals',
    name: 'Active Retail Deals',
    description:
      'Current retailer sales and price drops for games tracked in the collection.',
    mimeType: 'text/markdown',
  },
];

/**
 * Dispatches an MCP tool call to the corresponding database query handler
 */
export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown> | undefined,
  env: McpEnv,
  origin: string,
): Promise<{ text: string; isError?: boolean }> {
  const db = env.DB;
  const safeArgs = args || {};

  try {
    switch (toolName) {
      /**
       * TOOL 1: check_game_ownership
       */
      case 'check_game_ownership': {
        const title = String(safeArgs['title'] || '').trim();
        if (!title) {
          return {
            text: 'Error: "title" argument is required.',
            isError: true,
          };
        }

        const platformFilter = await resolvePlatform(
          db,
          safeArgs['platform'] as string | undefined,
        );

        const queryBase = `
          SELECT g.id as game_id, g.stable_id, g.title,
                 COALESCE(pp.display_name, p.display_name) as platform,
                 COALESCE(pp.id, p.id) as platform_id,
                 COALESCE(r.id, g.id) as release_id,
                 COALESCE(r.ownership_status, 0) as ownership_status,
                 COALESCE(r.backup_status, 0) as backup_status,
                 COALESCE(r.has_case, 0) as has_case,
                 COALESCE(r.has_manual, 0) as has_manual,
                 COALESCE(r.region, g.region) as region,
                 r.variants,
                 g.physical_status,
                 g.release_medium,
                 g.price_loose, g.price_cib, g.price_new
          FROM games g
          LEFT JOIN game_releases r ON g.stable_id = r.game_id
          JOIN platforms p ON g.platform_id = p.id
          LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
          WHERE `;

        const params: (string | number)[] = [];

        // 1. First attempt exact case-insensitive match
        let whereClause = `g.title COLLATE NOCASE = ?`;
        params.push(title);

        if (platformFilter) {
          whereClause += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
          params.push(platformFilter.id, platformFilter.id);
        }

        const exactQuery = await db
          .prepare(queryBase + whereClause + ` LIMIT 20`)
          .bind(...params)
          .all();

        let results = (exactQuery.results || []) as unknown as GameReleaseRow[];

        // 2. If no exact match, fallback to substring/prefix match
        if (results.length === 0) {
          params.length = 0;
          whereClause = `g.title COLLATE NOCASE LIKE ?`;
          params.push(`%${title}%`);
          if (platformFilter) {
            whereClause += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
            params.push(platformFilter.id, platformFilter.id);
          }
          const fallback = await db
            .prepare(queryBase + whereClause + ` LIMIT 20`)
            .bind(...params)
            .all();
          results = (fallback.results || []) as unknown as GameReleaseRow[];
        }

        if (results.length === 0) {
          const platMsg = platformFilter
            ? ` on ${platformFilter.displayName}`
            : '';
          return {
            text: JSON.stringify(
              {
                owned: false,
                message: `No matching game found in your collection for "${title}"${platMsg}.`,
                query: { title, platform: platformFilter?.displayName || null },
              },
              null,
              2,
            ),
          };
        }

        // Group releases by game
        const gamesMap = new Map<
          string,
          {
            game_id: string;
            title: string;
            platform: string;
            owned: boolean;
            releases: Array<{
              region: string | null;
              variants: string | null;
              owned: boolean;
              backed_up: boolean;
              completeness: string;
              estimated_value: string | null;
            }>;
            url: string;
          }
        >();

        for (const row of results) {
          const gId = row.game_id;
          if (!gamesMap.has(gId)) {
            gamesMap.set(gId, {
              game_id: gId,
              title: row.title,
              platform: row.platform,
              owned: false,
              releases: [],
              url: `${origin}/collection/games/${gId}`,
            });
          }
          const gameEntry = gamesMap.get(gId)!;
          const isOwned = Number(row.ownership_status) === 1;
          if (isOwned) {
            gameEntry.owned = true;
          }

          const hasCase = Number(row.has_case);
          const hasManual = Number(row.has_manual);
          const completeness = computeCompleteness(
            row.release_medium,
            hasCase,
            hasManual,
          );

          let priceValue: number | null = null;
          if (hasCase && hasManual && row.price_cib) {
            priceValue = Number(row.price_cib);
          } else if (row.price_loose) {
            priceValue = Number(row.price_loose);
          } else if (row.price_cib) {
            priceValue = Number(row.price_cib);
          }

          gameEntry.releases.push({
            region: row.region,
            variants: row.variants,
            owned: isOwned,
            backed_up: Number(row.backup_status) === 1,
            completeness,
            estimated_value: formatCents(priceValue),
          });
        }

        const gameSummaries = Array.from(gamesMap.values());
        const primaryGame = gameSummaries[0];
        const ownedReleases = primaryGame.releases.filter((r) => r.owned);

        return {
          text: JSON.stringify(
            {
              owned: primaryGame.owned,
              title: primaryGame.title,
              platform: primaryGame.platform,
              url: primaryGame.url,
              owned_releases: ownedReleases,
              all_catalog_releases: primaryGame.releases,
              other_matches: gameSummaries.slice(1).map((g) => ({
                title: g.title,
                platform: g.platform,
                owned: g.owned,
                url: g.url,
              })),
            },
            null,
            2,
          ),
        };
      }

      /**
       * TOOL 2: search_collection
       */
      case 'search_collection': {
        const query = safeArgs['query']
          ? String(safeArgs['query']).trim()
          : null;
        const ownership = (safeArgs['ownership'] as string) || 'owned';
        const backupStatus = (safeArgs['backup_status'] as string) || 'all';
        const series = safeArgs['series']
          ? String(safeArgs['series']).trim()
          : null;
        const limit = Math.min(
          Math.max(Number(safeArgs['limit']) || 10, 1),
          25,
        );

        const platformFilter = await resolvePlatform(
          db,
          safeArgs['platform'] as string | undefined,
        );

        let sql = `
          SELECT g.id as game_id, g.title, g.series, g.canonical_series,
                 COALESCE(pp.display_name, p.display_name) as platform,
                 COALESCE(r.ownership_status, 0) as ownership_status,
                 COALESCE(r.backup_status, 0) as backup_status,
                 r.release_date,
                 g.price_cib, g.price_loose
          FROM games g
          LEFT JOIN game_releases r ON g.stable_id = r.game_id
          JOIN platforms p ON g.platform_id = p.id
          LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
          WHERE 1=1 `;

        const params: (string | number)[] = [];

        if (query) {
          sql += ` AND (g.title COLLATE NOCASE LIKE ? OR g.canonical_series COLLATE NOCASE LIKE ?)`;
          params.push(`%${query}%`, `%${query}%`);
        }

        if (series) {
          sql += ` AND (g.canonical_series COLLATE NOCASE = ? OR g.series COLLATE NOCASE = ?)`;
          params.push(series, series);
        }

        if (platformFilter) {
          sql += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
          params.push(platformFilter.id, platformFilter.id);
        }

        if (ownership === 'owned') {
          sql += ` AND COALESCE(r.ownership_status, 0) = 1`;
        } else if (ownership === 'unowned') {
          sql += ` AND COALESCE(r.ownership_status, 0) = 0`;
        }

        if (backupStatus === 'backed_up') {
          sql += ` AND COALESCE(r.backup_status, 0) = 1`;
        } else if (backupStatus === 'missing_backup') {
          sql += ` AND COALESCE(r.ownership_status, 0) = 1 AND COALESCE(r.backup_status, 0) = 0`;
        }

        sql += ` GROUP BY g.stable_id ORDER BY g.title ASC LIMIT ?`;
        params.push(limit);

        const queryResult = await db
          .prepare(sql)
          .bind(...params)
          .all();
        const rows = (queryResult.results || []) as unknown as SearchGameRow[];

        const formatted = rows.map((row) => {
          const gameId = row.game_id;
          const price =
            Number(row.price_cib) || Number(row.price_loose) || null;
          return {
            id: gameId,
            title: row.title,
            platform: row.platform,
            series: row.canonical_series || row.series || null,
            owned: Number(row.ownership_status) === 1,
            backed_up: Number(row.backup_status) === 1,
            release_date: row.release_date || null,
            estimated_value: formatCents(price),
            url: `${origin}/collection/games/${gameId}`,
          };
        });

        return {
          text: JSON.stringify(
            {
              count: formatted.length,
              limit,
              games: formatted,
            },
            null,
            2,
          ),
        };
      }

      /**
       * TOOL 3: get_game_details
       */
      case 'get_game_details': {
        const id = safeArgs['id'] ? String(safeArgs['id']).trim() : null;
        const title = safeArgs['title']
          ? String(safeArgs['title']).trim()
          : null;

        let gameRow: GameDetailRow | null = null;

        if (id) {
          gameRow = (await db
            .prepare(
              `SELECT g.*, COALESCE(pp.display_name, p.display_name) as platform_name
               FROM games g
               JOIN platforms p ON g.platform_id = p.id
               LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
               WHERE g.id = ? OR g.stable_id = (SELECT game_id FROM game_releases WHERE id = ? LIMIT 1)
               LIMIT 1`,
            )
            .bind(id, id)
            .first()) as GameDetailRow | null;
        } else if (title) {
          const platformFilter = await resolvePlatform(
            db,
            safeArgs['platform'] as string | undefined,
          );
          let sql = `
            SELECT g.*, COALESCE(pp.display_name, p.display_name) as platform_name
            FROM games g
            JOIN platforms p ON g.platform_id = p.id
            LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
            WHERE g.title COLLATE NOCASE = ? `;
          const p: (string | number)[] = [title];
          if (platformFilter) {
            sql += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
            p.push(platformFilter.id, platformFilter.id);
          }
          gameRow = (await db
            .prepare(sql)
            .bind(...p)
            .first()) as GameDetailRow | null;
        }

        if (!gameRow) {
          return {
            text: JSON.stringify({ error: 'Game not found' }),
            isError: true,
          };
        }

        const stableId = gameRow.stable_id;
        const gameId = gameRow.id;

        // Fetch all media releases
        const releasesQuery = await db
          .prepare(
            `SELECT id, region, variants, rom_name, rom_crc, backup_status, ownership_status,
                    release_date, COALESCE(has_case, 0) as has_case, COALESCE(has_manual, 0) as has_manual
             FROM game_releases
             WHERE game_id = ?`,
          )
          .bind(stableId)
          .all();
        const releases = (releasesQuery.results ||
          []) as unknown as ReleaseMediaRow[];

        // Fetch bundled discs/companion items
        const bundledQuery = await db
          .prepare(
            `SELECT g.id, g.title, g.bundle_disc_number, g.release_medium,
                    COALESCE(r.rom_name, g.title) as rom_name,
                    COALESCE(r.backup_status, 0) as backup_status
             FROM games g
             LEFT JOIN game_releases r ON g.stable_id = r.game_id
             WHERE g.bundle_parent_id = ?
             ORDER BY g.bundle_disc_number ASC`,
          )
          .bind(stableId)
          .all();
        const bundled = (bundledQuery.results ||
          []) as unknown as BundledMediaRow[];

        return {
          text: JSON.stringify(
            {
              id: gameId,
              title: gameRow.title,
              platform: gameRow.platform_name,
              series: gameRow.canonical_series || gameRow.series || null,
              summary: gameRow.summary || null,
              genres: gameRow.genres || null,
              franchises: gameRow.franchises || null,
              igdb_url: gameRow.igdb_url || null,
              barcode: gameRow.barcode || null,
              release_medium: gameRow.release_medium || null,
              pricing: {
                loose: formatCents(gameRow.price_loose),
                cib: formatCents(gameRow.price_cib),
                new: formatCents(gameRow.price_new),
              },
              retail_deal:
                Number(gameRow.retail_on_sale) === 1
                  ? {
                      store: gameRow.retail_store,
                      sale_price: gameRow.retail_price,
                      regular_price: gameRow.retail_regular_price,
                      discount_pct: gameRow.retail_discount_pct,
                      store_url: gameRow.retail_url,
                    }
                  : null,
              url: `${origin}/collection/games/${gameId}`,
              releases: releases.map((r) => ({
                id: r.id,
                region: r.region,
                variants: r.variants,
                owned: Number(r.ownership_status) === 1,
                backed_up: Number(r.backup_status) === 1,
                completeness: computeCompleteness(
                  gameRow.release_medium,
                  r.has_case,
                  r.has_manual,
                ),
                rom_name: r.rom_name,
                rom_crc: r.rom_crc,
              })),
              bundled_media: bundled,
            },
            null,
            2,
          ),
        };
      }

      /**
       * TOOL 4: check_toy_ownership
       */
      case 'check_toy_ownership': {
        const name = String(safeArgs['name'] || '').trim();
        if (!name) {
          return { text: 'Error: "name" argument is required.', isError: true };
        }

        const line = safeArgs['line'] ? String(safeArgs['line']).trim() : null;
        const series = safeArgs['series']
          ? String(safeArgs['series']).trim()
          : null;

        const sql = `
          SELECT t.id, t.name, t.line, t.series, t.type, t.release_date, t.ownership_status,
                 t.amiibo_id, fs.name as series_name
          FROM toys t
          LEFT JOIN toy_series fs ON t.series_id = fs.id
          WHERE `;

        const params: string[] = [];

        // Exact match first
        let where = `t.name COLLATE NOCASE = ?`;
        params.push(name);

        if (line) {
          where += ` AND t.line COLLATE NOCASE = ?`;
          params.push(line);
        }
        if (series) {
          where += ` AND (t.series COLLATE NOCASE LIKE ? OR fs.name COLLATE NOCASE LIKE ?)`;
          params.push(`%${series}%`, `%${series}%`);
        }

        const exactQuery = await db
          .prepare(sql + where + ` LIMIT 5`)
          .bind(...params)
          .all();
        let results = (exactQuery.results || []) as unknown as ToyRow[];

        // Substring fallback
        if (results.length === 0) {
          params.length = 0;
          where = `t.name COLLATE NOCASE LIKE ?`;
          params.push(`%${name}%`);
          if (line) {
            where += ` AND t.line COLLATE NOCASE = ?`;
            params.push(line);
          }
          if (series) {
            where += ` AND (t.series COLLATE NOCASE LIKE ? OR fs.name COLLATE NOCASE LIKE ?)`;
            params.push(`%${series}%`, `%${series}%`);
          }
          const fallback = await db
            .prepare(sql + where + ` LIMIT 5`)
            .bind(...params)
            .all();
          results = (fallback.results || []) as unknown as ToyRow[];
        }

        if (results.length === 0) {
          return {
            text: JSON.stringify(
              {
                owned: false,
                message: `No matching figure/card found for "${name}".`,
              },
              null,
              2,
            ),
          };
        }

        const primary = results[0];
        const toyId = primary.id;

        return {
          text: JSON.stringify(
            {
              owned: Number(primary.ownership_status) === 1,
              name: primary.name,
              line: primary.line,
              series: primary.series || primary.series_name || null,
              type: primary.type || 'Figure',
              release_date: primary.release_date || null,
              url: `${origin}/collection/toys/${toyId}`,
              other_matches: results.slice(1).map((r) => ({
                name: r.name,
                line: r.line,
                owned: Number(r.ownership_status) === 1,
                url: `${origin}/collection/toys/${r.id}`,
              })),
            },
            null,
            2,
          ),
        };
      }

      /**
       * TOOL 5: search_toys
       */
      case 'search_toys': {
        const query = safeArgs['query']
          ? String(safeArgs['query']).trim()
          : null;
        const line = safeArgs['line'] ? String(safeArgs['line']).trim() : null;
        const series = safeArgs['series']
          ? String(safeArgs['series']).trim()
          : null;
        const ownership = (safeArgs['ownership'] as string) || 'owned';
        const limit = Math.min(
          Math.max(Number(safeArgs['limit']) || 15, 1),
          50,
        );

        let sql = `
          SELECT t.id, t.name, t.line, t.series, t.type, t.release_date, t.ownership_status,
                 fs.name as series_name
          FROM toys t
          LEFT JOIN toy_series fs ON t.series_id = fs.id
          WHERE 1=1 `;

        const params: (string | number)[] = [];

        if (query) {
          sql += ` AND t.name COLLATE NOCASE LIKE ?`;
          params.push(`%${query}%`);
        }
        if (line) {
          sql += ` AND t.line COLLATE NOCASE = ?`;
          params.push(line);
        }
        if (series) {
          sql += ` AND (t.series COLLATE NOCASE LIKE ? OR fs.name COLLATE NOCASE LIKE ?)`;
          params.push(`%${series}%`, `%${series}%`);
        }
        if (ownership === 'owned') {
          sql += ` AND t.ownership_status = 1`;
        } else if (ownership === 'unowned') {
          sql += ` AND t.ownership_status = 0`;
        }

        sql += ` ORDER BY t.name ASC LIMIT ?`;
        params.push(limit);

        const queryResult = await db
          .prepare(sql)
          .bind(...params)
          .all();
        const rows = (queryResult.results || []) as unknown as ToyRow[];

        const formatted = rows.map((r) => {
          const toyId = r.id;
          return {
            id: toyId,
            name: r.name,
            line: r.line,
            series: r.series || r.series_name || null,
            type: r.type,
            owned: Number(r.ownership_status) === 1,
            release_date: r.release_date || null,
            url: `${origin}/collection/toys/${toyId}`,
          };
        });

        return {
          text: JSON.stringify(
            {
              count: formatted.length,
              limit,
              toys: formatted,
            },
            null,
            2,
          ),
        };
      }

      /**
       * TOOL 6: get_collection_stats
       */
      case 'get_collection_stats': {
        const platformFilter = await resolvePlatform(
          db,
          safeArgs['platform'] as string | undefined,
        );

        let gamesSql = `
          SELECT 
            COUNT(DISTINCT g.stable_id) as total_games_tracked,
            COUNT(DISTINCT CASE WHEN r.ownership_status = 1 THEN g.stable_id END) as owned_games,
            COUNT(DISTINCT CASE WHEN r.backup_status = 1 THEN g.stable_id END) as backed_up_games,
            SUM(
              CASE WHEN r.ownership_status = 1 THEN
                CASE 
                  WHEN r.has_case = 1 AND r.has_manual = 1 THEN COALESCE(g.price_cib, g.price_loose, 0)
                  WHEN r.has_case = 1 THEN COALESCE(g.price_cib, g.price_loose, 0)
                  ELSE COALESCE(g.price_loose, g.price_cib, 0)
                END
              ELSE 0 END
            ) as total_value_cents
          FROM games g
          LEFT JOIN game_releases r ON g.stable_id = r.game_id
          JOIN platforms p ON g.platform_id = p.id
          WHERE 1=1 `;

        const params: (string | number)[] = [];
        if (platformFilter) {
          gamesSql += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
          params.push(platformFilter.id, platformFilter.id);
        }

        const statsRow = (await db
          .prepare(gamesSql)
          .bind(...params)
          .first()) as {
          total_games_tracked: number;
          owned_games: number;
          backed_up_games: number;
          total_value_cents: number | null;
        } | null;

        const ownedGames = Number(statsRow?.owned_games || 0);
        const backedUp = Number(statsRow?.backed_up_games || 0);
        const missingBackup = Math.max(0, ownedGames - backedUp);
        const backupPct =
          ownedGames > 0
            ? ((backedUp / ownedGames) * 100).toFixed(1) + '%'
            : '0%';

        // Toys counts (only if no platform filter or platform is Nintendo)
        let totalToysOwned = 0;
        if (!platformFilter) {
          const toyRow = (await db
            .prepare(
              `SELECT COUNT(*) as owned_toys FROM toys WHERE ownership_status = 1`,
            )
            .first()) as { owned_toys: number } | null;
          totalToysOwned = Number(toyRow?.owned_toys || 0);
        }

        // Top platforms breakdown
        let topPlatforms: Array<{ platform: string; owned_count: number }> = [];
        if (!platformFilter) {
          const { results: platformResults } = await db
            .prepare(
              `SELECT COALESCE(pp.display_name, p.display_name) as platform_name,
                      COUNT(DISTINCT CASE WHEN r.ownership_status = 1 THEN g.stable_id END) as owned_count
               FROM games g
               JOIN game_releases r ON g.stable_id = r.game_id
               JOIN platforms p ON g.platform_id = p.id
               LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
               GROUP BY platform_name
               ORDER BY owned_count DESC
               LIMIT 5`,
            )
            .all();
          topPlatforms = (
            (platformResults || []) as unknown as Array<{
              platform_name: string;
              owned_count: number;
            }>
          ).map((r) => ({
            platform: String(r.platform_name),
            owned_count: Number(r.owned_count),
          }));
        }

        return {
          text: JSON.stringify(
            {
              platform: platformFilter?.displayName || 'All Platforms',
              total_games_tracked: Number(statsRow?.total_games_tracked || 0),
              owned_games_count: ownedGames,
              backed_up_games_count: backedUp,
              missing_backup_count: missingBackup,
              backup_completion_pct: backupPct,
              total_toys_owned: totalToysOwned,
              total_estimated_value_usd: formatCents(
                statsRow?.total_value_cents,
              ),
              top_platforms: topPlatforms,
            },
            null,
            2,
          ),
        };
      }

      /**
       * TOOL 7: get_platforms
       */
      case 'get_platforms': {
        const queryResult = await db
          .prepare(
            `SELECT p.id, p.display_name, p.brand, p.launch_date,
                    COUNT(DISTINCT CASE WHEN r.ownership_status = 1 THEN g.stable_id END) as owned_games
             FROM platforms p
             LEFT JOIN platforms child ON child.parent_platform_id = p.id
             LEFT JOIN games g ON (g.platform_id = p.id OR g.platform_id = child.id)
             LEFT JOIN game_releases r ON g.stable_id = r.game_id
             WHERE p.parent_platform_id IS NULL
             GROUP BY p.id
             ORDER BY p.launch_date ASC, p.id ASC`,
          )
          .all();
        const results = (queryResult.results || []) as unknown as PlatformRow[];

        return {
          text: JSON.stringify(
            {
              count: results.length,
              platforms: results.map((r) => ({
                id: r.id,
                name: r.display_name,
                brand: r.brand,
                launch_date: r.launch_date,
                owned_games: Number(r.owned_games || 0),
              })),
            },
            null,
            2,
          ),
        };
      }

      /**
       * TOOL 8: get_active_deals
       */
      case 'get_active_deals': {
        const minDiscount = Number(safeArgs['min_discount_pct']) || 15;
        const platformFilter = await resolvePlatform(
          db,
          safeArgs['platform'] as string | undefined,
        );

        let sql = `
          SELECT g.id, g.title, COALESCE(pp.display_name, p.display_name) as platform,
                 g.retail_store, g.retail_price, g.retail_regular_price,
                 g.retail_discount_pct, g.retail_url,
                 COALESCE(r.ownership_status, 0) as ownership_status
          FROM games g
          LEFT JOIN game_releases r ON g.stable_id = r.game_id
          JOIN platforms p ON g.platform_id = p.id
          LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
          WHERE g.retail_on_sale = 1 AND g.retail_discount_pct >= ? `;

        const params: (string | number)[] = [minDiscount];
        if (platformFilter) {
          sql += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
          params.push(platformFilter.id, platformFilter.id);
        }

        sql += ` GROUP BY g.stable_id ORDER BY g.retail_discount_pct DESC LIMIT 20`;

        const queryResult = await db
          .prepare(sql)
          .bind(...params)
          .all();
        const results = (queryResult.results || []) as unknown as DealRow[];

        const deals = results.map((r) => {
          const gameId = r.id;
          return {
            title: r.title,
            platform: r.platform,
            store: r.retail_store,
            sale_price: r.retail_price,
            regular_price: r.retail_regular_price,
            discount_pct: `${r.retail_discount_pct}%`,
            store_url: r.retail_url,
            already_owned: Number(r.ownership_status) === 1,
            collection_url: `${origin}/collection/games/${gameId}`,
          };
        });

        return {
          text: JSON.stringify(
            {
              deals_count: deals.length,
              min_discount_pct: minDiscount,
              deals,
            },
            null,
            2,
          ),
        };
      }

      /**
       * TOOL 9: get_backlog
       */
      case 'get_backlog': {
        const platformFilter = await resolvePlatform(
          db,
          safeArgs['platform'] as string | undefined,
        );
        const statusArg = String(
          safeArgs['play_status'] || 'all',
        ).toLowerCase();
        const limit = Math.min(
          Math.max(Number(safeArgs['limit']) || 15, 1),
          50,
        );

        let statusClause = 'g.play_status IN (0, 2, 3, 4)';
        if (statusArg === 'unplayed') statusClause = 'g.play_status = 0';
        else if (statusArg === 'playing') statusClause = 'g.play_status = 2';
        else if (statusArg === 'queued') statusClause = 'g.play_status = 3';
        else if (statusArg === 'paused') statusClause = 'g.play_status = 4';

        let sql = `
          SELECT g.id as game_id, g.title, COALESCE(g.play_status, 0) as play_status,
                 g.series, g.genres, g.summary,
                 COALESCE(pp.display_name, p.display_name) as platform
          FROM games g
          JOIN game_releases r ON g.stable_id = r.game_id
          JOIN platforms p ON g.platform_id = p.id
          LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
          WHERE r.ownership_status = 1 AND ${statusClause}
        `;
        const params: (string | number)[] = [];
        if (platformFilter) {
          sql += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
          params.push(platformFilter.id, platformFilter.id);
        }

        sql += ` GROUP BY g.stable_id ORDER BY g.play_status DESC, g.title ASC LIMIT ?`;
        params.push(limit);

        const queryResult = await db
          .prepare(sql)
          .bind(...params)
          .all();
        const rows = (queryResult.results || []) as unknown as Array<{
          game_id: string;
          title: string;
          play_status: number;
          series: string | null;
          genres: string | null;
          summary: string | null;
          platform: string;
        }>;

        const PLAY_STATUS_LABELS: Record<number, string> = {
          0: 'Unplayed',
          1: 'Played',
          2: 'Playing',
          3: 'Queued',
          4: 'Paused',
          5: 'Dropped',
        };

        const backlog = rows.map((r) => ({
          id: r.game_id,
          title: r.title,
          platform: r.platform,
          play_status: PLAY_STATUS_LABELS[r.play_status] || 'Unplayed',
          play_status_code: r.play_status,
          series: r.series || null,
          genres: r.genres || null,
          summary: r.summary || null,
          url: `${origin}/collection/games/${r.game_id}`,
        }));

        return {
          text: JSON.stringify(
            {
              count: backlog.length,
              platform: platformFilter?.displayName || 'All Platforms',
              filter_status: statusArg,
              backlog,
            },
            null,
            2,
          ),
        };
      }

      /**
       * TOOL 10: get_platform_completion
       */
      case 'get_platform_completion': {
        const platformFilter = await resolvePlatform(
          db,
          safeArgs['platform'] as string | undefined,
        );

        let sql = `
          SELECT 
            COALESCE(pp.id, p.id) as platform_id,
            COALESCE(pp.display_name, p.display_name) as platform_name,
            COALESCE(pp.brand, p.brand) as brand,
            COUNT(DISTINCT g.stable_id) as total_catalog_games,
            COUNT(DISTINCT CASE WHEN r.ownership_status = 1 THEN g.stable_id END) as owned_games,
            COUNT(DISTINCT CASE WHEN r.ownership_status = 1 AND r.backup_status = 1 THEN g.stable_id END) as backed_up_games,
            COUNT(DISTINCT CASE WHEN r.ownership_status = 1 AND r.has_case = 1 AND r.has_manual = 1 THEN g.stable_id END) as cib_games
          FROM platforms p
          LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
          JOIN games g ON g.platform_id = p.id
          LEFT JOIN game_releases r ON g.stable_id = r.game_id
          WHERE 1=1
        `;
        const params: (string | number)[] = [];
        if (platformFilter) {
          sql += ` AND (p.id = ? OR p.parent_platform_id = ?)`;
          params.push(platformFilter.id, platformFilter.id);
        }

        sql += `
          GROUP BY 1, 2, 3
        `;
        if (!platformFilter) {
          sql += ` HAVING owned_games > 0`;
        }
        sql += ` ORDER BY owned_games DESC, platform_name ASC`;

        const queryResult = await db
          .prepare(sql)
          .bind(...params)
          .all();
        const rows = (queryResult.results || []) as unknown as Array<{
          platform_id: number;
          platform_name: string;
          brand: string | null;
          total_catalog_games: number;
          owned_games: number;
          backed_up_games: number;
          cib_games: number;
        }>;

        const platforms = rows.map((r) => {
          const owned = Number(r.owned_games);
          const backedUp = Number(r.backed_up_games);
          const totalCatalog = Number(r.total_catalog_games);
          const backupPct =
            owned > 0 ? ((backedUp / owned) * 100).toFixed(1) + '%' : '0.0%';
          const catalogPct =
            totalCatalog > 0
              ? ((owned / totalCatalog) * 100).toFixed(1) + '%'
              : '0.0%';

          return {
            platform_id: Number(r.platform_id),
            platform: r.platform_name,
            brand: r.brand,
            owned_games_count: owned,
            backed_up_games_count: backedUp,
            backup_completion_pct: backupPct,
            cib_games_count: Number(r.cib_games),
            total_catalog_games: totalCatalog,
            catalog_completion_pct: catalogPct,
          };
        });

        return {
          text: JSON.stringify(
            {
              count: platforms.length,
              filter_platform: platformFilter?.displayName || null,
              platforms,
            },
            null,
            2,
          ),
        };
      }

      default:
        return {
          text: `Unknown MCP tool: "${toolName}". Use "tools/list" to see available tools.`,
          isError: true,
        };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP Tool Error: ${toolName}]`, err);
    return {
      text: `Database error executing "${toolName}": ${msg}`,
      isError: true,
    };
  }
}

/**
 * Dispatches an MCP prompt invocation to construct contextual reasoning templates
 */
export async function executeMcpPrompt(
  promptName: string,
  args: Record<string, string> | undefined,
  env: McpEnv,
  _origin: string,
): Promise<{
  description?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: { type: 'text'; text: string };
  }>;
}> {
  const db = env.DB;
  const safeArgs = args || {};

  switch (promptName) {
    case 'recommend_backlog_game': {
      const platformFilter = await resolvePlatform(db, safeArgs['platform']);
      const maxCandidates = Math.min(
        Math.max(Number(safeArgs['max_candidates']) || 5, 1),
        20,
      );

      let sql = `
        SELECT g.id, g.title, COALESCE(g.play_status, 0) as play_status,
               g.series, g.canonical_series, g.genres, g.summary,
               COALESCE(pp.display_name, p.display_name) as platform
        FROM games g
        JOIN game_releases r ON g.stable_id = r.game_id
        JOIN platforms p ON g.platform_id = p.id
        LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
        WHERE r.ownership_status = 1 AND g.play_status IN (0, 2, 3)
      `;
      const params: (string | number)[] = [];
      if (platformFilter) {
        sql += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
        params.push(platformFilter.id, platformFilter.id);
      }
      sql += ` GROUP BY g.stable_id ORDER BY CASE WHEN g.play_status = 3 THEN 1 WHEN g.play_status = 2 THEN 2 ELSE 3 END, g.title ASC LIMIT ?`;
      params.push(maxCandidates);

      const queryResult = await db
        .prepare(sql)
        .bind(...params)
        .all();
      const rows = (queryResult.results || []) as unknown as Array<{
        id: string;
        title: string;
        play_status: number;
        series: string | null;
        canonical_series: string | null;
        genres: string | null;
        summary: string | null;
        platform: string;
      }>;

      const STATUS_NAMES: Record<number, string> = {
        0: 'Unplayed',
        2: 'Currently Playing',
        3: 'Queued (Next Up)',
      };

      const candidateLines = rows.map((r, i) => {
        const status = STATUS_NAMES[r.play_status] || 'Unplayed';
        const seriesInfo =
          r.canonical_series || r.series
            ? ` | Series: ${r.canonical_series || r.series}`
            : '';
        const genreInfo = r.genres ? ` | Genres: ${r.genres}` : '';
        const summary = r.summary ? `\n   Summary: ${r.summary}` : '';
        return `${i + 1}. **${r.title}** (${r.platform}) [${status}]${seriesInfo}${genreInfo}${summary}`;
      });

      const platText = platformFilter
        ? ` for ${platformFilter.displayName}`
        : '';
      const promptText =
        rows.length > 0
          ? `I am looking for a recommendation on what video game to play next from my owned backlog${platText}.\n\nHere are candidate games currently in my backlog:\n${candidateLines.join(
              '\n\n',
            )}\n\nPlease evaluate these options and recommend which game I should play next, factoring in gameplay style, pacing, and time commitment. If there is a game currently in progress, highlight whether I should finish it first or switch.`
          : `I am looking for a recommendation on what video game to play next from my owned backlog${platText}, but no matching unplayed or queued games were found in the collection. Please advise on exploring new titles or revisiting completed favorites.`;

      return {
        description:
          'Recommendation prompt for selecting a backlog game to play next',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: promptText,
            },
          },
        ],
      };
    }

    case 'audit_missing_backups': {
      const platformFilter = await resolvePlatform(db, safeArgs['platform']);
      const limit = Math.min(Math.max(Number(safeArgs['limit']) || 10, 1), 25);

      let sql = `
        SELECT g.id, g.title,
               COALESCE(pp.display_name, p.display_name) as platform,
               r.has_case, r.has_manual, g.release_medium,
               COALESCE(g.price_cib, g.price_loose, 0) as estimated_cents
        FROM games g
        JOIN game_releases r ON g.stable_id = r.game_id
        JOIN platforms p ON g.platform_id = p.id
        LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
        WHERE r.ownership_status = 1 
          AND r.backup_status = 0
          AND (g.release_medium IS NULL OR g.release_medium != 'digital')
      `;
      const params: (string | number)[] = [];
      if (platformFilter) {
        sql += ` AND (g.platform_id = ? OR p.parent_platform_id = ?)`;
        params.push(platformFilter.id, platformFilter.id);
      }
      sql += ` GROUP BY g.stable_id ORDER BY estimated_cents DESC, g.title ASC LIMIT ?`;
      params.push(limit);

      const queryResult = await db
        .prepare(sql)
        .bind(...params)
        .all();
      const rows = (queryResult.results || []) as unknown as Array<{
        id: string;
        title: string;
        platform: string;
        has_case: number;
        has_manual: number;
        release_medium: string | null;
        estimated_cents: number;
      }>;

      const candidates = rows.map((r, i) => {
        const comp = computeCompleteness(
          r.release_medium,
          r.has_case,
          r.has_manual,
        );
        const val = formatCents(r.estimated_cents) || '$0.00';
        return `${i + 1}. **${r.title}** (${r.platform}) - Completeness: ${comp}, Estimated Value: ${val}`;
      });

      const platText = platformFilter
        ? ` for ${platformFilter.displayName}`
        : '';
      const promptText =
        rows.length > 0
          ? `Please help me audit and prioritize physical video games in my collection${platText} that are currently missing digital ROM/disc preservation backups.\n\nHere are the highest-priority owned physical games missing digital backups:\n${candidates.join(
              '\n',
            )}\n\nPlease analyze this list and suggest an efficient backup priority order, highlighting disc-based media prone to disc rot or high-value cartridges.`
          : `All owned physical games${platText} are currently fully backed up! Please suggest archival verification or hash-checking routines to ensure backup integrity.`;

      return {
        description:
          'Prompt to audit owned physical games missing digital ROM/ISO preservation backups',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: promptText,
            },
          },
        ],
      };
    }

    case 'evaluate_deal': {
      const title = String(safeArgs['title'] || '').trim();
      const salePrice = String(safeArgs['sale_price'] || '').trim();
      const store = safeArgs['store'] ? String(safeArgs['store']).trim() : null;

      if (!title || !salePrice) {
        throw new Error(
          '"title" and "sale_price" arguments are required for evaluate_deal.',
        );
      }

      // Check existing ownership
      const checkSql = `
        SELECT g.id, g.title, g.series, g.canonical_series,
               COALESCE(pp.display_name, p.display_name) as platform,
               COALESCE(r.ownership_status, 0) as ownership_status,
               r.has_case, r.has_manual, g.release_medium,
               g.price_loose, g.price_cib, g.price_new
        FROM games g
        LEFT JOIN game_releases r ON g.stable_id = r.game_id
        JOIN platforms p ON g.platform_id = p.id
        LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
        WHERE g.title COLLATE NOCASE = ? OR g.title COLLATE NOCASE LIKE ?
        LIMIT 5
      `;
      const queryResult = await db
        .prepare(checkSql)
        .bind(title, `%${title}%`)
        .all();
      const matches = (queryResult.results || []) as unknown as Array<{
        id: string;
        title: string;
        series: string | null;
        canonical_series: string | null;
        platform: string;
        ownership_status: number;
        has_case: number;
        has_manual: number;
        release_medium: string | null;
        price_loose: number | null;
        price_cib: number | null;
        price_new: number | null;
      }>;

      const ownedMatch = matches.find((m) => Number(m.ownership_status) === 1);
      const exactOrFirst = matches[0];

      let ownershipText = 'Not owned in current collection.';
      if (ownedMatch) {
        const comp = computeCompleteness(
          ownedMatch.release_medium,
          ownedMatch.has_case,
          ownedMatch.has_manual,
        );
        ownershipText = `ALREADY OWNED on ${ownedMatch.platform} (${comp}).`;
      }

      const seriesName =
        exactOrFirst?.canonical_series || exactOrFirst?.series || null;
      let priceGuideText =
        'No PriceCharting market data available for this title.';
      if (
        exactOrFirst &&
        (exactOrFirst.price_loose ||
          exactOrFirst.price_cib ||
          exactOrFirst.price_new)
      ) {
        priceGuideText = `Market Estimates: Loose: ${formatCents(exactOrFirst.price_loose) || 'N/A'}, CIB: ${formatCents(exactOrFirst.price_cib) || 'N/A'}, New/Sealed: ${formatCents(exactOrFirst.price_new) || 'N/A'}`;
      }

      const storeText = store ? ` at ${store}` : '';
      const promptText = `I am considering purchasing the following video game deal:\n\n- **Game Title**: ${title}\n- **Sale Price**: ${salePrice}${storeText}\n- **Collection Status**: ${ownershipText}\n- **Series / Franchise**: ${seriesName || 'Standalone / Unknown'}\n- **Price Guide**: ${priceGuideText}\n\nPlease evaluate whether this deal is worth buying. Consider whether I already own a copy, how the sale price compares to market value, and whether it represents good value for the collection.`;

      return {
        description:
          'Prompt to evaluate a retail game deal against collection ownership and series preference',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: promptText,
            },
          },
        ],
      };
    }

    default:
      throw new Error(`Prompt not found: "${promptName}"`);
  }
}

/**
 * Dispatches an MCP resource read to generate structured Markdown documents
 */
export async function executeMcpResource(
  uri: string,
  env: McpEnv,
  _origin: string,
): Promise<{
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
  }>;
}> {
  const db = env.DB;

  switch (uri) {
    case 'collection://stats': {
      const statsSql = `
        SELECT 
          COUNT(DISTINCT g.stable_id) as total_games_tracked,
          COUNT(DISTINCT CASE WHEN r.ownership_status = 1 THEN g.stable_id END) as owned_games,
          COUNT(DISTINCT CASE WHEN r.ownership_status = 1 AND r.backup_status = 1 THEN g.stable_id END) as backed_up_games,
          SUM(
            CASE WHEN r.ownership_status = 1 THEN
              CASE 
                WHEN r.has_case = 1 AND r.has_manual = 1 THEN COALESCE(g.price_cib, g.price_loose, 0)
                WHEN r.has_case = 1 THEN COALESCE(g.price_cib, g.price_loose, 0)
                ELSE COALESCE(g.price_loose, g.price_cib, 0)
              END
            ELSE 0 END
          ) as total_value_cents
        FROM games g
        LEFT JOIN game_releases r ON g.stable_id = r.game_id
      `;
      const statsRow = (await db.prepare(statsSql).first()) as {
        total_games_tracked: number;
        owned_games: number;
        backed_up_games: number;
        total_value_cents: number | null;
      } | null;

      const ownedGames = Number(statsRow?.owned_games || 0);
      const backedUp = Number(statsRow?.backed_up_games || 0);
      const missing = Math.max(0, ownedGames - backedUp);
      const backupPct =
        ownedGames > 0
          ? ((backedUp / ownedGames) * 100).toFixed(1) + '%'
          : '0.0%';

      const toyRow = (await db
        .prepare(
          `SELECT COUNT(*) as owned_toys FROM toys WHERE ownership_status = 1`,
        )
        .first()) as { owned_toys: number } | null;
      const totalToys = Number(toyRow?.owned_toys || 0);

      const { results: topPlatResults } = await db
        .prepare(
          `SELECT COALESCE(pp.display_name, p.display_name) as platform_name,
                  COUNT(DISTINCT CASE WHEN r.ownership_status = 1 THEN g.stable_id END) as owned_count
           FROM games g
           JOIN game_releases r ON g.stable_id = r.game_id
           JOIN platforms p ON g.platform_id = p.id
           LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
           GROUP BY platform_name
           ORDER BY owned_count DESC
           LIMIT 5`,
        )
        .all();
      const topPlatforms = (topPlatResults || []) as unknown as Array<{
        platform_name: string;
        owned_count: number;
      }>;

      const lines = [
        '# Collection Statistics Overview',
        '',
        `- **Total Catalog Games Tracked:** ${Number(statsRow?.total_games_tracked || 0)}`,
        `- **Owned Games:** ${ownedGames}`,
        `- **Backed Up Games:** ${backedUp} (${backupPct})`,
        `- **Missing Backups:** ${missing}`,
        `- **Toys & Amiibo Owned:** ${totalToys}`,
        `- **Estimated Collection Market Value:** ${formatCents(statsRow?.total_value_cents) || '$0.00'}`,
        '',
        '## Top Platforms by Owned Count',
      ];

      for (const p of topPlatforms) {
        lines.push(`- **${p.platform_name}**: ${p.owned_count} games`);
      }

      return {
        contents: [
          {
            uri: 'collection://stats',
            mimeType: 'text/markdown',
            text: lines.join('\n'),
          },
        ],
      };
    }

    case 'collection://wishlist': {
      const sql = `
        SELECT g.id, g.title,
               COALESCE(pp.display_name, p.display_name) as platform,
               r.ownership_status,
               g.price_loose, g.price_cib
        FROM games g
        JOIN game_releases r ON g.stable_id = r.game_id
        JOIN platforms p ON g.platform_id = p.id
        LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
        WHERE r.ownership_status IN (2, 3)
        GROUP BY g.stable_id
        ORDER BY r.ownership_status DESC, g.title ASC
        LIMIT 50
      `;
      const queryResult = await db.prepare(sql).all();
      const rows = (queryResult.results || []) as unknown as Array<{
        id: string;
        title: string;
        platform: string;
        ownership_status: number;
        price_loose: number | null;
        price_cib: number | null;
      }>;

      const ordered = rows.filter((r) => Number(r.ownership_status) === 3);
      const seeking = rows.filter((r) => Number(r.ownership_status) === 2);

      const lines = ['# Collection Wishlist & Seeking Items', ''];

      lines.push('## Currently Ordered (Incoming)');
      if (ordered.length === 0) {
        lines.push('_No games currently on order._');
      } else {
        for (const o of ordered) {
          const val = formatCents(o.price_cib || o.price_loose);
          lines.push(
            `- **${o.title}** (${o.platform})${val ? ` - Est: ${val}` : ''}`,
          );
        }
      }

      lines.push('');
      lines.push('## Seeking (Wishlist)');
      if (seeking.length === 0) {
        lines.push('_No games currently marked as seeking._');
      } else {
        for (const s of seeking) {
          const val = formatCents(s.price_cib || s.price_loose);
          lines.push(
            `- **${s.title}** (${s.platform})${val ? ` - Est: ${val}` : ''}`,
          );
        }
      }

      return {
        contents: [
          {
            uri: 'collection://wishlist',
            mimeType: 'text/markdown',
            text: lines.join('\n'),
          },
        ],
      };
    }

    case 'collection://deals': {
      const sql = `
        SELECT g.id, g.title,
               COALESCE(pp.display_name, p.display_name) as platform,
               g.retail_store, g.retail_price, g.retail_regular_price,
               g.retail_discount_pct, g.retail_url,
               COALESCE(r.ownership_status, 0) as ownership_status
        FROM games g
        LEFT JOIN game_releases r ON g.stable_id = r.game_id
        JOIN platforms p ON g.platform_id = p.id
        LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
        WHERE g.retail_on_sale = 1
        GROUP BY g.stable_id
        ORDER BY g.retail_discount_pct DESC
        LIMIT 25
      `;
      const queryResult = await db.prepare(sql).all();
      const rows = (queryResult.results || []) as unknown as Array<{
        id: string;
        title: string;
        platform: string;
        retail_store: string | null;
        retail_price: number | null;
        retail_regular_price: number | null;
        retail_discount_pct: number | null;
        retail_url: string | null;
        ownership_status: number;
      }>;

      const lines = ['# Active Retail Deals & Discounts', ''];
      if (rows.length === 0) {
        lines.push('_No active retail deals currently tracked._');
      } else {
        for (const d of rows) {
          const owned =
            Number(d.ownership_status) === 1 ? ' *(Already Owned)*' : '';
          const saleVal = formatCents(d.retail_price) || 'Sale';
          const regVal = formatCents(d.retail_regular_price) || 'Regular';
          const store = d.retail_store || 'Retailer';
          lines.push(`- **${d.title}** (${d.platform})${owned}`);
          lines.push(
            `  - Price: ${saleVal} (was ${regVal}, -${d.retail_discount_pct}%) at ${store}`,
          );
          if (d.retail_url) {
            lines.push(`  - Link: ${d.retail_url}`);
          }
        }
      }

      return {
        contents: [
          {
            uri: 'collection://deals',
            mimeType: 'text/markdown',
            text: lines.join('\n'),
          },
        ],
      };
    }

    default:
      throw new Error(`Resource not found: "${uri}"`);
  }
}

/**
 * Standard CORS headers for MCP HTTP requests
 */
const MCP_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Requested-With, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

/**
 * Core HTTP Request Handler for MCP Endpoint (/mcp and /api/mcp)
 */
export async function handleMcpRequest(
  request: Request,
  env: McpEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;

  // 1. CORS Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: MCP_CORS_HEADERS,
    });
  }

  // 2. Authentication Check (if MCP_AUTH_KEY is configured in Worker secrets)
  if (env.MCP_AUTH_KEY && env.MCP_AUTH_KEY.trim().length > 0) {
    const authHeader = request.headers.get('Authorization') || '';
    const queryToken = url.searchParams.get('token') || '';
    const expected = env.MCP_AUTH_KEY.trim();

    const isBearerValid =
      authHeader.startsWith('Bearer ') &&
      authHeader.slice(7).trim() === expected;
    const isTokenValid = queryToken.trim() === expected;

    if (!isBearerValid && !isTokenValid) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message:
              'Unauthorized: Valid Bearer token or ?token= query parameter is required for MCP access.',
          },
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...MCP_CORS_HEADERS,
          },
        },
      );
    }
  }

  // 3. GET request: Informational / Health check
  if (request.method === 'GET') {
    const appName = env.APP_NAME || 'Collection Tracker';
    return Response.json(
      {
        status: 'ok',
        protocol: 'model-context-protocol',
        version: '2024-11-05',
        server: 'collection-tracker-mcp',
        app: appName,
        tools_count: MCP_TOOLS.length,
        prompts_count: MCP_PROMPTS.length,
        resources_count: MCP_RESOURCES.length,
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
        })),
        prompts: MCP_PROMPTS.map((p) => ({
          name: p.name,
          description: p.description,
        })),
        resources: MCP_RESOURCES.map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
        })),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          ...MCP_CORS_HEADERS,
        },
      },
    );
  }

  // 4. POST request: JSON-RPC 2.0 Dispatch
  if (request.method === 'POST') {
    let body: JsonRpcRequest;
    try {
      body = (await request.json()) as JsonRpcRequest;
    } catch {
      return Response.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: Invalid JSON payload' },
        },
        { status: 400, headers: MCP_CORS_HEADERS },
      );
    }

    if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0') {
      return Response.json(
        {
          jsonrpc: '2.0',
          id: body?.id ?? null,
          error: {
            code: -32600,
            message: 'Invalid Request: jsonrpc must be "2.0"',
          },
        },
        { status: 400, headers: MCP_CORS_HEADERS },
      );
    }

    const { id = null, method, params } = body;

    switch (method) {
      // MCP Handshake
      case 'initialize': {
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              prompts: {},
              resources: {},
            },
            serverInfo: {
              name: 'collection-tracker-mcp',
              version: '1.0.0',
            },
          },
        };
        return Response.json(response, { headers: MCP_CORS_HEADERS });
      }

      // MCP Client Confirmation (Notification: no response required)
      case 'notifications/initialized': {
        return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
      }

      // Tool Discovery
      case 'tools/list': {
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id,
          result: {
            tools: MCP_TOOLS,
          },
        };
        return Response.json(response, { headers: MCP_CORS_HEADERS });
      }

      // Tool Execution
      case 'tools/call': {
        const callParams = params as
          | { name?: string; arguments?: Record<string, unknown> }
          | undefined;
        const toolName = callParams?.name;

        if (!toolName) {
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: 'Invalid params: "name" is required for tools/call',
              },
            },
            { status: 400, headers: MCP_CORS_HEADERS },
          );
        }

        const execution = await executeMcpTool(
          toolName,
          callParams?.arguments,
          env,
          origin,
        );

        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: execution.text,
              },
            ],
            isError: execution.isError ?? false,
          },
        };
        return Response.json(response, { headers: MCP_CORS_HEADERS });
      }

      // Prompt Discovery
      case 'prompts/list': {
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id,
          result: {
            prompts: MCP_PROMPTS,
          },
        };
        return Response.json(response, { headers: MCP_CORS_HEADERS });
      }

      // Prompt Execution / Retrieval
      case 'prompts/get': {
        const promptParams = params as
          | { name?: string; arguments?: Record<string, string> }
          | undefined;
        const promptName = promptParams?.name;

        if (!promptName) {
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: 'Invalid params: "name" is required for prompts/get',
              },
            },
            { status: 400, headers: MCP_CORS_HEADERS },
          );
        }

        try {
          const result = await executeMcpPrompt(
            promptName,
            promptParams?.arguments,
            env,
            origin,
          );
          const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            result,
          };
          return Response.json(response, { headers: MCP_CORS_HEADERS });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: msg,
              },
            },
            { status: 404, headers: MCP_CORS_HEADERS },
          );
        }
      }

      // Resource Discovery
      case 'resources/list': {
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id,
          result: {
            resources: MCP_RESOURCES,
          },
        };
        return Response.json(response, { headers: MCP_CORS_HEADERS });
      }

      // Resource Reading
      case 'resources/read': {
        const resourceParams = params as { uri?: string } | undefined;
        const uri = resourceParams?.uri;

        if (!uri) {
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: 'Invalid params: "uri" is required for resources/read',
              },
            },
            { status: 400, headers: MCP_CORS_HEADERS },
          );
        }

        try {
          const result = await executeMcpResource(uri, env, origin);
          const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            result,
          };
          return Response.json(response, { headers: MCP_CORS_HEADERS });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: msg,
              },
            },
            { status: 404, headers: MCP_CORS_HEADERS },
          );
        }
      }

      // Health Check Ping
      case 'ping': {
        return Response.json(
          { jsonrpc: '2.0', id, result: {} },
          { headers: MCP_CORS_HEADERS },
        );
      }

      default: {
        return Response.json(
          {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: "${method}"`,
            },
          },
          { status: 404, headers: MCP_CORS_HEADERS },
        );
      }
    }
  }

  return Response.json(
    { error: 'Method Not Allowed' },
    { status: 405, headers: MCP_CORS_HEADERS },
  );
}
