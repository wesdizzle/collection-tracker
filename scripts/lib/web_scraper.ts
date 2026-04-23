import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COVERS_DIR = path.join(__dirname, '..', '..', 'public', 'covers');

// Standard headers to avoid common bot detection
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
};

// Helper for delays to respect site rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PCProduct {
    productName: string;
    consoleName: string;
}

export interface ScrapedMetadata {
    title: string;
    image_url?: string;
    description?: string;
    release_date?: string;
    pricecharting_url?: string;
}

/**
 * Searches PriceCharting for a game and returns its metadata and cover art URL.
 */
export async function scrapePriceCharting(title: string, platform: string): Promise<ScrapedMetadata | null> {
    console.log(`Searching PriceCharting: ${title} (${platform})...`);
    
    // Add small delay to avoid flagging
    await delay(1000);

    try {
        const query = encodeURIComponent(`${title} ${platform}`).replace(/%20/g, '+');
        const searchUrl = `https://www.pricecharting.com/search-products?q=${query}&type=videogames`;
        console.log(`  Search URL: ${searchUrl}`);
        
        const response = await axios.get(searchUrl, { headers: HEADERS });
        console.log(`  Status: ${response.status}`);
        const dataStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        
        console.log(`[Scraper] Initial Search Result HTML (first 1000 chars): ${dataStr.substring(0, 1000)}`);

        const $ = cheerio.load(dataStr);

        // If there are multiple results, PriceCharting shows a list. 
        // If there is one result, it redirects to the product page.
        // We handle both by checking for the presence of the product title on the page.
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let productUrl = (response as any).request?.res?.responseUrl || searchUrl;
        console.log(`  PriceCharting URL: ${productUrl}`);
        
        // Handle JSON response
        if (dataStr.trim().startsWith('{')) {
            try {
                const json = JSON.parse(dataStr);
                const products = json.products || [];
                
                if (products.length === 0) {
                    console.log(`  No results found in JSON on PriceCharting for ${title}.`);
                    return null;
                }

                // Find best match (exact title first)
                const best = products.find((p: PCProduct) => 
                    p.productName.toLowerCase() === title.toLowerCase() && 
                    p.consoleName.toLowerCase().includes(platform.toLowerCase())
                ) || products.find((p: PCProduct) => 
                    p.productName.toLowerCase().includes(title.toLowerCase()) && 
                    p.consoleName.toLowerCase().includes(platform.toLowerCase())
                ) || products[0];

                // Construct URL: https://www.pricecharting.com/game/[console-slug]/[product-slug]
                const consoleSlug = best.consoleName.toLowerCase().replace(/ /g, '-');
                const productSlug = best.productName.toLowerCase()
                    .replace(/[^a-z0-9 ]/g, '')
                    .replace(/ /g, '-');
                
                productUrl = `https://www.pricecharting.com/game/${consoleSlug}/${productSlug}`;
                console.log(`  Selected JSON Result: ${best.productName} (${productUrl})`);
            } catch {
                console.log(`  Failed to parse JSON response, falling back to HTML.`);
            }
        }
        
        // If it's a search results page (HTML)
        if ($('#games_table').length > 0) {
            const results = $('#games_table td.title a').map((i, el) => {
                const href = $(el).attr('href') || '';
                const url = href.startsWith('http') ? href : 'https://www.pricecharting.com' + href;
                return {
                    title: $(el).text().trim(),
                    url: url
                };
            }).get();

            if (results.length > 0) {
                // Find best match (exact-ish)
                const bestMatch = results.find(r => r.title.toLowerCase() === title.toLowerCase()) || 
                                 results.find(r => r.title.toLowerCase().includes(title.toLowerCase())) || 
                                 results[0];
                productUrl = bestMatch.url;
                console.log(`  Selected HTML Result: ${bestMatch.title} (${productUrl})`);
            }
        }
        
        // If we found a specific product URL from JSON or search results, we MUST fetch that page
        if (productUrl !== searchUrl && !productUrl.includes('search-products')) {
            console.log(`  Fetching Product Page: ${productUrl}`);
            await delay(500);
            const productResponse = await axios.get(productUrl, { headers: HEADERS });
            const productHtml = typeof productResponse.data === 'string' ? productResponse.data : JSON.stringify(productResponse.data);
            const $product = cheerio.load(productHtml);
            return extractPriceChartingDetails($product, productUrl);
        }

        return extractPriceChartingDetails($, productUrl);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`PriceCharting scrape failed for ${title}:`, message);
        return null;
    }
}

function extractPriceChartingDetails($: cheerio.CheerioAPI, url: string): ScrapedMetadata {
    // PriceCharting title is usually in h1#product_name or h1.chart_title
    const titleEl = $('#product_name, h1.chart_title');
    let title = titleEl.contents().first().text().trim(); // Take only the direct text, excluding the <a> tag
    
    if (!title) {
        title = titleEl.text().trim(); // Fallback to all text
    }

    const imageUrl = $('.cover img').attr('src');
    let finalImageUrl = imageUrl;
    if (imageUrl && imageUrl.includes('/240.jpg')) {
        finalImageUrl = imageUrl.replace('/240.jpg', '/1600.jpg');
    } else if (imageUrl && imageUrl.includes('/300.jpg')) {
        finalImageUrl = imageUrl.replace('/300.jpg', '/1600.jpg');
    }
    
    console.log(`[Scraper] Found title: "${title}"`);
    console.log(`[Scraper] Found image: "${finalImageUrl}"`);

    return {
        title: title || 'Unknown Title',
        image_url: finalImageUrl,
        pricecharting_url: url
    };
}

/**
 * Scrapes PlayStation Store for game descriptions and release dates.
 * Strictly for modern PS titles (PS4/PS5/PSVR).
 */
export async function scrapePlayStationStore(title: string): Promise<Partial<ScrapedMetadata> | null> {
    console.log(`Searching PlayStation Store: ${title}...`);
    
    await delay(1000);

    try {
        const query = encodeURIComponent(title);
        const searchUrl = `https://store.playstation.com/en-us/search/${query}`;
        
        const response = await axios.get(searchUrl, { headers: HEADERS });
        const $ = cheerio.load(response.data as string);

        // Pick the first result link
        const firstResult = $('a[data-qa^="search#product"]').first();
        if (firstResult.length === 0) {
            console.log(`No results found on PS Store for ${title}.`);
            return null;
        }

        const productUrl = 'https://store.playstation.com' + firstResult.attr('href');
        
        await delay(500);
        const productResponse = await axios.get(productUrl, { headers: HEADERS });
        const $product = cheerio.load(productResponse.data as string);

        const description = $product('[data-qa="mfe-game-overview#description"]').text().trim();
        const releaseDate = $product('[data-qa="gameInfo#releaseDate#value"]').text().trim();

        return {
            description,
            release_date: releaseDate
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`PS Store scrape failed for ${title}:`, message);
        return null;
    }
}

/**
 * Downloads an image from a URL and saves it to public/covers/
 * Returns the relative path to the saved image.
 */
export async function downloadCoverImage(url: string, filename: string): Promise<string | null> {
    if (!url) return null;

    try {
        const extension = path.extname(new URL(url).pathname) || '.jpg';
        const targetFilename = `${filename}${extension}`;
        const targetPath = path.join(COVERS_DIR, targetFilename);

        const response = await axios.get(url, { responseType: 'stream', headers: HEADERS });
        const writer = fs.createWriteStream(targetPath);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (response.data as any).pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(`/covers/${targetFilename}`));
            writer.on('error', reject);
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to download image from ${url}:`, message);
        return null;
    }
}
