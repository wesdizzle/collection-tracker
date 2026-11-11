import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

interface DataGroup {
  name: string;
  urls: string[];
  cacheConfig: {
    maxSize: number;
    maxAge: string;
    timeout: string;
    strategy: string;
  };
}

interface NgswConfig {
  dataGroups: DataGroup[];
}

describe('Service Worker Configuration (ngsw-config.json)', () => {
  it('should enforce long-lived caching policies for offline support', () => {
    // Read the ngsw-config.json file directly from the filesystem
    const configPath = path.resolve(__dirname, '../../src/ngsw-config.json');
    const configRaw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configRaw) as NgswConfig;

    // 1. Verify the 'api-freshness' dataGroup exists and has a 30d maxAge
    const apiGroup = config.dataGroups.find((g) => g.name === 'api-freshness');
    expect(apiGroup).toBeDefined();
    expect(apiGroup?.cacheConfig.maxAge).toBe('30d');

    // 2. Verify the 'external-assets' dataGroup exists, has 30d maxAge, and a large maxSize
    const extGroup = config.dataGroups.find(
      (g) => g.name === 'external-assets',
    );
    expect(extGroup).toBeDefined();
    expect(extGroup?.cacheConfig.maxAge).toBe('30d');
    expect(extGroup?.cacheConfig.maxSize).toBeGreaterThanOrEqual(5000);
    expect(extGroup?.cacheConfig.strategy).toBe('performance');

    // 3. Verify that important external domains are included in the cache
    const urls = extGroup?.urls || [];
    expect(urls).toContain('https://images.igdb.com/**');
    expect(urls).toContain('https://*.amiiboapi.com/**');
  });
});
