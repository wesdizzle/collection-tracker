import { describe, it, expect } from 'vitest';
import {
  parseRedumpDiscTableHtml,
  fetchRedumpDiscDetails,
} from './redump_metadata.js';

describe('Redump Public Metadata Aggregator', () => {
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
