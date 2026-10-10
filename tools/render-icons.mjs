// render-icons.mjs - render the PNG icons in site/assets/ from site/assets/favicon.svg with Playwright (no new dependencies).
//
// Usage (from the repository root):
//   node tools/render-icons.mjs
// Writes site/assets/icon-32.png, icon-192.png, icon-512.png (transparent rounded corners, as the SVG) and
// apple-touch-icon.png (180 x 180, opaque full-bleed square: iOS applies its own mask). The Playwright browser is the
// one installed for the tests; nothing is downloaded.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const assets = new URL('../site/assets/', import.meta.url);
const svg = readFileSync(new URL('favicon.svg', assets), 'utf8');
// The Apple icon must be opaque: drop the corner radius so the dark square fills the whole canvas.
const squareSvg = svg.replace('rx="14"', 'rx="0"');

const targets = [
  ['icon-32.png', 32, svg, true],
  ['icon-192.png', 192, svg, true],
  ['icon-512.png', 512, svg, true],
  ['apple-touch-icon.png', 180, squareSvg, false],
];

const browser = await chromium.launch();
try {
  for (const [file, size, source, transparent] of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const src = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`);
    await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
    const png = await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(fileURLToPath(new URL(file, assets)), png);
    console.log(`${file} ${size}x${size} ${png.length} bytes`);
    await page.close();
  }
} finally {
  await browser.close();
}
