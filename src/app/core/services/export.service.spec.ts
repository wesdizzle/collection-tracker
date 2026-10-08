import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportService } from './export.service';
import {
  Game,
  Toy,
  OwnershipStatus,
  PlayStatus,
} from '../models/collection.models';

describe('ExportService', () => {
  let service: ExportService;

  beforeEach(() => {
    service = new ExportService();
  });

  const mockGames: Game[] = [
    {
      stable_id: 1,
      id: 'super-mario-bros-nes',
      title: 'Super Mario Bros.',
      series: 'Mario',
      canonical_series: 'Mario',
      release_date: '1985-10-18',
      platform: 'Nintendo Entertainment System',
      platform_id: 1,
      display_name: 'NES',
      brand: 'Nintendo',
      region: 'USA',
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Played,
      backup_status: 1,
      rom_name: 'Super Mario Bros. (USA).nes',
      rom_crc: 'D445D6EB',
      price_loose: 1500,
      price_cib: 8500,
      price_new: 25000,
      retail_price: null,
      retail_on_sale: 0,
      barcode: '045496610029',
      variants: 'Rev A',
    },
    {
      stable_id: 2,
      id: 'persona-4-golden-psv',
      title: 'Persona 4 Golden, "Special Edition"',
      series: 'Persona',
      canonical_series: 'Persona',
      release_date: '2012-11-20',
      platform: 'PlayStation Vita',
      platform_id: 28,
      display_name: 'PS Vita',
      brand: 'Sony',
      region: 'USA',
      ownership_status: OwnershipStatus.Seeking,
      play_status: PlayStatus.Unplayed,
      backup_status: 0,
      rom_name: 'Persona 4 Golden (USA).psv',
      rom_crc: 'A1B2C3D4',
      price_loose: 3500,
      price_cib: 6000,
      price_new: 12000,
      retail_price: 2999,
      retail_on_sale: 1,
      barcode: null,
      variants: null,
    },
  ];

  const mockToys: Toy[] = [
    {
      stable_id: 101,
      id: 'mario-amiibo',
      name: 'Mario',
      line: 'amiibo',
      type: 'Figure',
      series_name: 'Super Smash Bros.',
      series_line: 'amiibo',
      release_date: '2014-11-21',
      ownership_status: OwnershipStatus.Owned,
      image_url: 'https://example.com/mario.png',
      region: 'USA',
      price_loose: 1200,
      amiibo_id: '0000000000000002',
    },
  ];

  describe('generateCsv for Games', () => {
    it('should format games into RFC 4180 CSV with escaped quotes and commas', () => {
      const csv = service.generateCsv(mockGames, 'games');
      const lines = csv.split('\r\n');

      expect(lines[0]).toContain('Title,Platform,Series');
      // Persona 4 has a comma and quotes in its title: "Persona 4 Golden, ""Special Edition"""
      expect(lines[2]).toContain('"Persona 4 Golden, ""Special Edition"""');
      expect(lines[1]).toContain('Super Mario Bros.');
      expect(lines[1]).toContain('Backed Up');
      expect(lines[1]).toContain('15.00'); // price_loose formatted as USD float
      expect(lines[2]).toContain('Missing');
      expect(lines[2]).toContain('Seeking');
    });
  });

  describe('generateCsv for Toys', () => {
    it('should format toys into RFC 4180 CSV', () => {
      const csv = service.generateCsv(mockToys, 'toys');
      const lines = csv.split('\r\n');

      expect(lines[0]).toContain('Name,Line,Series,Type,Region');
      expect(lines[1]).toContain('Mario,amiibo,Super Smash Bros.,Figure,USA');
      expect(lines[1]).toContain('Owned');
      expect(lines[1]).toContain('12.00');
    });
  });

  describe('generateLogiqxXmlDat for Games', () => {
    it('should build valid Logiqx XML DAT structure with ROM CRC and game entries', () => {
      const xml = service.generateLogiqxXmlDat(
        mockGames,
        'My Curated Collection',
      );

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain(
        '<!DOCTYPE datafile PUBLIC "-//Logiqx//DTD ROMs//EN"',
      );
      expect(xml).toContain('<name>My Curated Collection</name>');
      expect(xml).toContain('<author>Gagglog Collection Tracker</author>');

      // NES game
      expect(xml).toContain('<game name="Super Mario Bros. (USA)">');
      expect(xml).toContain(
        '<rom name="Super Mario Bros. (USA).nes" crc="D445D6EB" />',
      );

      // PS Vita game
      expect(xml).toContain('<game name="Persona 4 Golden (USA)">');
      expect(xml).toContain(
        '<rom name="Persona 4 Golden (USA).psv" crc="A1B2C3D4" />',
      );
    });

    it('should escape special characters in XML nodes', () => {
      const gameWithSpecialChars: Game = {
        ...mockGames[0],
        title: 'Rock & Roll Racing <Classic> "Edition"',
        rom_name: null,
      };
      const xml = service.generateLogiqxXmlDat([gameWithSpecialChars]);

      expect(xml).toContain('&amp;');
      expect(xml).toContain('&lt;Classic&gt;');
      expect(xml).toContain('&quot;Edition&quot;');
    });
  });

  describe('triggerDownload', () => {
    it('should create object URL and click anchor element', () => {
      const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
      const revokeObjectURLMock = vi.fn();
      window.URL.createObjectURL = createObjectURLMock;
      window.URL.revokeObjectURL = revokeObjectURLMock;

      const clickMock = vi.fn();
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockReturnValue({
          set href(val: string) {},
          set download(val: string) {},
          click: clickMock,
        } as unknown as HTMLAnchorElement);

      const appendChildSpy = vi
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => null as unknown as Node);
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => null as unknown as Node);

      const blob = new Blob(['test'], { type: 'text/plain' });
      service.triggerDownload(blob, 'test.csv');

      expect(createObjectURLMock).toHaveBeenCalledWith(blob);
      expect(clickMock).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url');

      createElementSpy.mockRestore();
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });
  });
});
