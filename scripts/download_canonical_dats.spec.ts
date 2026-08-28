/**
 * Unit Tests for Canonical DAT Downloader Utility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  REDUMP_TARGETS,
  NO_INTRO_TARGETS,
  downloadNoIntroDat,
} from './download_canonical_dats.js';

describe('Canonical DAT Downloader', () => {
  const tempTestDir = path.join(process.cwd(), 'scripts', 'temp', 'test_dats');

  beforeEach(() => {
    if (!fs.existsSync(tempTestDir)) {
      fs.mkdirSync(tempTestDir, { recursive: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempTestDir)) {
      try {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      } catch {
        // Ignore test directory cleanup error
      }
    }
  });

  it('should define comprehensive targets for all major tracked platforms', () => {
    expect(REDUMP_TARGETS.length).toBeGreaterThanOrEqual(15);
    expect(NO_INTRO_TARGETS.length).toBeGreaterThanOrEqual(25);

    // Verify key platforms exist in targets
    const redumpSlugs = REDUMP_TARGETS.map((t) => t.slug);
    expect(redumpSlugs).toContain('psx');
    expect(redumpSlugs).toContain('ps2');
    expect(redumpSlugs).toContain('gc');
    expect(redumpSlugs).toContain('wii');
    expect(redumpSlugs).toContain('xbox');

    const noIntroFiles = NO_INTRO_TARGETS.map((t) => t.remoteFileName);
    expect(noIntroFiles).toContain('Nintendo - Game Boy Advance.dat');
    expect(noIntroFiles).toContain('Nintendo - Nintendo 64.dat');
    expect(noIntroFiles).toContain('Sega - Mega Drive - Genesis.dat');
  });

  it('should download and save a valid No-Intro XML DAT file', async () => {
    const mockXml = `<?xml version="1.0"?>
<datafile>
    <header>
        <name>Nintendo - Game Boy Advance</name>
        <description>Nintendo - Game Boy Advance (Parent-Clone)</description>
    </header>
    <game name="Metroid Fusion (USA)">
        <description>Metroid Fusion (USA)</description>
        <rom name="Metroid Fusion (USA).gba" size="8388608" crc="d50041da"/>
    </game>
</datafile>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockXml,
    });
    vi.stubGlobal('fetch', mockFetch);

    const target = NO_INTRO_TARGETS.find((t) =>
      t.remoteFileName.includes('Game Boy Advance'),
    )!;
    const result = await downloadNoIntroDat(target, tempTestDir);

    expect(result.success).toBe(true);
    expect(result.fileName).toBe('Nintendo - Game Boy Advance.dat');
    const savedPath = path.join(tempTestDir, result.fileName!);
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(fs.readFileSync(savedPath, 'utf8')).toContain(
      'Metroid Fusion (USA)',
    );
  });

  it('should reject invalid or non-datafile responses gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><body>404 Not Found</body></html>',
    });
    vi.stubGlobal('fetch', mockFetch);

    const target = NO_INTRO_TARGETS[0];
    const result = await downloadNoIntroDat(target, tempTestDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not a valid No-Intro datafile');
  });

  it('should handle HTTP error responses gracefully without throwing', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });
    vi.stubGlobal('fetch', mockFetch);

    const target = NO_INTRO_TARGETS[0];
    const result = await downloadNoIntroDat(target, tempTestDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 503 Service Unavailable');
  });
});
