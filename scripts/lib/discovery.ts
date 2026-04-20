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
    options: DiscoveryOption[];
}

export interface ApplyPayload {
    currentTitle: string;
    currentPlatform: string;
    selectedIgdbId: string;
    selectedName: string;
    region?: string;
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
            const match = line.match(/### (.*) \((.*)\)/);
            if (match) {
                currentItem = {
                    title: match[1].trim(),
                    platform: match[2].trim(),
                    options: []
                };
            }
        } else if (currentItem && line.match(/- \[ \] \*\*(Update to|Link to):\*\*/)) {
            const match = line.match(/- \[ \] \*\*(?:Update to|Link to):\*\* (.*) \((.*)\) - ID: (.*)/);
            if (match) {
                currentItem.options.push({
                    name: match[1].trim(),
                    platform: match[2].trim(),
                    id: match[3].trim(),
                    image_url: null,
                    summary: null
                });
            }
        } else if (currentItem && currentItem.options.length > 0 && line.startsWith('  - ![')) {
            const match = line.match(/!\[.*\]\((.*)\)/);
            if (match) currentItem.options[currentItem.options.length - 1].image_url = match[1];
        } else if (currentItem && currentItem.options.length > 0 && line.startsWith('  - *')) {
            const match = line.match(/\*([\s\S]*)\*/);
            if (match) currentItem.options[currentItem.options.length - 1].summary = match[1].trim();
        }
    }
    if (currentItem) discoveryItems.push(currentItem);
    return discoveryItems;
}
