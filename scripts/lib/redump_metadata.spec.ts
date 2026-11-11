import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseRedumpDiscTableHtml,
  fetchRedumpDiscDetails,
} from './redump_metadata.js';

describe('Redump Public Metadata Aggregator', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://redump.org/disc/13074/') {
        return new Response(
          `
            <h1>The Misadventures of Tron Bonne</h1>
            <table>
              <tr><th>Edition</th><td>Original</td></tr>
              <tr><th>Serial</th><td>SLUS-00896</td></tr>
              <tr><th>Barcode</th></tr><tr><td>0 13388 21048 0</td></tr>
              <tr><th>Comments</th></tr><tr><td>Includes bonus disc <a href="/disc/13075/">Mega Man Legends 2 (USA) (Demo)</a></td></tr>
            </table>
          `,
          { status: 200 },
        );
      }
      if (url === 'http://redump.org/disc/13074/sfv/') {
        return new Response(
          'Misadventures of Tron Bonne, The (USA).cue a1b2c3d4\n',
          {
            status: 200,
          },
        );
      }
      if (url === 'http://redump.org/disc/13075/') {
        return new Response(
          `
            <h1>Mega Man Legends 2</h1>
            <table>
              <tr><th>Edition</th><td>Demo</td></tr>
              <tr><th>Serial</th><td>SLUS-90078</td></tr>
              <tr><th>Comments</th></tr><tr><td>Bundled with <a href="/disc/13074/">Misadventures of Tron Bonne, The (USA)</a></td></tr>
            </table>
          `,
          { status: 200 },
        );
      }
      if (url === 'http://redump.org/disc/13075/sfv/') {
        return new Response('Mega Man Legends 2 (USA) (Demo).cue e5f60718\n', {
          status: 200,
        });
      }
      return new Response('Not Found', { status: 404 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses Redump disc table HTML into structured summaries', () => {
    const sampleHtml = `
      <table class="games" cellspacing="0">
        <tr><td class="align-center"><img src="/images/regions/U.png" alt="USA" title="USA" /></td><td><a href="/disc/13074/">The Misadventures of Tron Bonne</a></td><td>PSX</td><td></td><td>Original</td><td><img src="/images/languages/eng.png" alt="English" title="English" /> </td><td>SLUS-00896</td><td class="align-center"><img src="/images/status/green.png" /></td></tr>
        <tr><td class="align-center"><img src="/images/regions/U.png" alt="USA" title="USA" /></td><td><a href="/disc/13075/">Mega Man Legends 2</a></td><td>PSX</td><td></td><td>Demo</td><td><img src="/images/languages/eng.png" alt="English" title="English" /> </td><td>SLUS-90078</td><td class="align-center"><img src="/images/status/green.png" /></td></tr>
      </table>
    `;

    const summaries = parseRedumpDiscTableHtml(sampleHtml, 'psx');
    expect(summaries).toHaveLength(2);
    expect(summaries[0].discId).toBe(13074);
    expect(summaries[0].title).toBe('The Misadventures of Tron Bonne');
    expect(summaries[0].edition).toBe('Original');
    expect(summaries[0].serial).toBe('SLUS-00896');

    expect(summaries[1].discId).toBe(13075);
    expect(summaries[1].edition).toBe('Demo');
    expect(summaries[1].serial).toBe('SLUS-90078');
  });

  it('fetches live Redump disc details and parses pack-in demo cross-links', async () => {
    const details = await fetchRedumpDiscDetails(13074); // The Misadventures of Tron Bonne (USA)
    expect(details).not.toBeNull();
    expect(details?.discId).toBe(13074);
    expect(details?.title).toContain('Tron Bonne');
    expect(details?.serial).toBe('SLUS-00896');
    expect(details?.barcode).toBe('0 13388 21048 0');
    // Confirm pack-in demo disc 13075 is linked
    expect(details?.bundledDiscIds).toContain(13075);
  }, 10000);

  it('fetches live Redump demo disc details and confirms host game link', async () => {
    const demoDetails = await fetchRedumpDiscDetails(13075); // Mega Man Legends 2 (USA) (Demo)
    expect(demoDetails).not.toBeNull();
    expect(demoDetails?.discId).toBe(13075);
    expect(demoDetails?.hostDiscId).toBe(13074);
    expect(demoDetails?.romName).toBe('Mega Man Legends 2 (USA) (Demo).cue');
  }, 10000);
});
