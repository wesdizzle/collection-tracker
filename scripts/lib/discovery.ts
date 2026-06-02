export interface DiscoveryOption {
  name: string;
  platform: string;
  id: string;
  image_url: string | null;
  summary: string | null;
}

export interface DiscoveryItem {
  title: string;
  platform: string;
  line?: string;
  series?: string;
  options: DiscoveryOption[];
}

export interface ApplyPayload {
  /** The title of the unmatched item currently in the local database. */
  currentTitle: string;
  /** The platform name of the unmatched item. */
  currentPlatform: string;
  /** The product/toy line if applicable (e.g. 'Skylanders', 'amiibo', 'Starlink'). */
  currentLine?: string;
  /** The series or franchise the unmatched item belongs to. */
  currentSeries?: string;
  /** The matched ID from external metadata provider (IGDB ID, SCL name slug, or Amiibo hex ID). */
  selectedIgdbId: string | number;
  /** The name of the matched entity. */
  selectedName: string;
  /** The platform name of the matched entity. */
  selectedPlatform: string;
  /** The target release region (e.g. 'NA', 'JP', 'EU'). */
  region?: string;
  /** A summary description of the matched item. */
  summary?: string;
  /** The image URL of the matched item. */
  imageUrl?: string;
}

/**
 * UTILITY: parseDiscoveryReport
 *
 * Parses the markdown discovery report into a structured object for the UI.
 */
export function parseDiscoveryReport(content: string): DiscoveryItem[] {
  const lines = content.split('\n');
  const discoveryItems: DiscoveryItem[] = [];
  let currentItem: DiscoveryItem | null = null;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (currentItem) discoveryItems.push(currentItem);

      // Robust regex: Platform is the last parenthetical before | or end of line
      const regex =
        /### (.*) \(([^)]+)\)(?:\s*\|\s*Line:\s*(.*?)\s*\|\s*Series:\s*(.*))?$/;
      const match = line.match(regex);

      if (match) {
        currentItem = {
          title: match[1].trim(),
          platform: match[2].trim(),
          line: match[3]?.trim(),
          series: match[4]?.trim(),
          options: [],
        };
      }
    } else if (
      currentItem &&
      line.match(/- \[ \] \*\*(Update to|Link to):\*\*/)
    ) {
      const match = line.match(
        /- \[ \] \*\*(?:Update to|Link to):\*\* (.*) \((.*)\) - ID: (.*)/,
      );
      if (match) {
        currentItem.options.push({
          name: match[1].trim(),
          platform: match[2].trim(),
          id: match[3].trim(),
          image_url: null,
          summary: null,
        });
      }
    } else if (
      currentItem &&
      currentItem.options.length > 0 &&
      line.startsWith('  - ![')
    ) {
      const match = line.match(/!\[.*\]\((.*)\)/);
      if (match)
        currentItem.options[currentItem.options.length - 1].image_url =
          match[1];
    } else if (
      currentItem &&
      currentItem.options.length > 0 &&
      line.startsWith('  - *')
    ) {
      const match = line.match(/\*([\s\S]*)\*/);
      if (match)
        currentItem.options[currentItem.options.length - 1].summary =
          match[1].trim();
    }
  }
  if (currentItem) discoveryItems.push(currentItem);
  return discoveryItems;
}
