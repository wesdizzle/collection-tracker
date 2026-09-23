import '../../../test-setup';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  GameyeExportService,
  computeGameOwnershipMask,
  computeCrc32,
  createZipArchive,
} from './gameye-export.service';

describe('GameyeExportService', () => {
  let service: GameyeExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GameyeExportService],
    });
    service = TestBed.inject(GameyeExportService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('computeGameOwnershipMask', () => {
    it('should return 7 for Complete in Box (hasCase and hasManual)', () => {
      expect(computeGameOwnershipMask(1, 1)).toBe(7);
      expect(computeGameOwnershipMask(true, true)).toBe(7);
    });

    it('should return 5 for Boxed Only (hasCase but no manual)', () => {
      expect(computeGameOwnershipMask(1, 0)).toBe(5);
      expect(computeGameOwnershipMask(true, false)).toBe(5);
    });

    it('should return 3 for Manual Only (hasManual but no case)', () => {
      expect(computeGameOwnershipMask(0, 1)).toBe(3);
      expect(computeGameOwnershipMask(false, true)).toBe(3);
    });

    it('should return 1 for Loose / Game Only (neither case nor manual)', () => {
      expect(computeGameOwnershipMask(0, 0)).toBe(1);
      expect(computeGameOwnershipMask(false, false)).toBe(1);
    });
  });

  describe('computeCrc32', () => {
    it('should match standard CRC32 checksum', () => {
      const data = new TextEncoder().encode('hello world');
      expect(computeCrc32(data)).toBe(222957957);
    });
  });

  describe('createZipArchive', () => {
    it('should produce a valid PKZIP buffer with local, central, and eocd records', async () => {
      const content = new TextEncoder().encode('test sqlite payload data');
      const zip = await createZipArchive('test.db', content);

      expect(zip.byteLength).toBeGreaterThan(0);
      const view = new DataView(zip.buffer);
      // Local header signature 0x04034b50
      expect(view.getUint32(0, true)).toBe(0x04034b50);
    });

    it('should fall back to uncompressed store mode if deflate fails', async () => {
      const originalCS = globalThis.CompressionStream;
      (
        globalThis as unknown as { CompressionStream: unknown }
      ).CompressionStream = class {
        constructor() {
          throw new Error('deflate-raw unsupported');
        }
      };

      try {
        const content = new TextEncoder().encode(
          'uncompressed fallback payload',
        );
        const zip = await createZipArchive('fallback.db', content);
        expect(zip.byteLength).toBeGreaterThan(0);
        const view = new DataView(zip.buffer);
        expect(view.getUint32(0, true)).toBe(0x04034b50);
        // Compression method at offset 8 should be 0 (Store)
        expect(view.getUint16(8, true)).toBe(0);
      } finally {
        globalThis.CompressionStream = originalCS;
      }
    });
  });

  describe('formatFilename', () => {
    it('should format date with YYYY_MM_DD_gagglog_export.ged', () => {
      const testDate = new Date(2026, 8, 22); // Note: month 8 = September
      const filename = service.formatFilename(testDate);
      expect(filename).toBe('2026_09_22_gagglog_export.ged');
    });
  });

  describe('exportToGameye', () => {
    it('should fetch export data, build database and zip, and trigger download', async () => {
      const mockData = {
        games: [
          {
            title: 'Jak and Daxter',
            gameye_id: 4525,
            gameye_platform_id: 11,
            platform_id: 30,
            region: 'USA',
            has_case: 1,
            has_manual: 1,
          },
        ],
        toys: [
          {
            title: 'Spyro',
            gameye_id: 55555,
            line: 'Skylanders',
          },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockData,
      } as Response);

      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        set href(val: string) {},
        set download(val: string) {},
        click: clickSpy,
      } as unknown as HTMLAnchorElement);

      vi.spyOn(document.body, 'appendChild').mockImplementation(
        () => null as unknown as Node,
      );
      vi.spyOn(document.body, 'removeChild').mockImplementation(
        () => null as unknown as Node,
      );

      // Mock buildSqliteDatabase to avoid loading full wasm in unit test runner
      vi.spyOn(service, 'buildSqliteDatabase').mockResolvedValue(
        new Uint8Array([1, 2, 3, 4, 5]),
      );

      await service.exportToGameye();

      expect(globalThis.fetch).toHaveBeenCalledWith('/api/export/gameye-data');
      expect(service.buildSqliteDatabase).toHaveBeenCalledWith(mockData);
      expect(clickSpy).toHaveBeenCalled();
      expect(service.exporting()).toBe(false);
    });
  });
});
