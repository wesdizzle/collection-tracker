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
    currentTitle: string;
    currentPlatform: string;
    currentLine?: string;
    currentSeries?: string;
    selectedIgdbId: string;
    selectedName: string;
    selectedPlatform: string;
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
            
            // Flexible regex to handle metadata
            const match = line.match(/### (.*?) \((.*?)\)\s*\|\s*Line:\s*(.*?)\s*\|\s*Series:\s*(.*?)$/);
            
            if (match) {
                currentItem = {
                    title: match[1].trim(),
                    platform: match[2].trim(),
                    line: match[3]?.trim(),
                    series: match[4]?.trim(),
                    options: []
                };
            } else {
                // Fallback for simple headers or if regex failed
                const fallback = line.match(/### (.*?) \((.*?)\)/);
                if (fallback) {
                    currentItem = {
                        title: fallback[1].trim(),
                        platform: fallback[2].trim(),
                        options: []
                    };
                }
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
