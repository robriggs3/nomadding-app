// Headless map check, run in CI with a real browser.
//
// The regression this exists for: on 2026-09-18 the map drew nothing for two
// days on every city that had no cached coordinates, with ZERO console errors,
// because the canvas was gated on already having a pin. The unit suite cannot
// see that: it has no Leaflet, no tiles and no layout. This can.
//
// Two fixtures on purpose. One with coordinates already cached, which must
// produce real markers immediately and offline. One with none, which must
// still produce a map canvas, because that is the case that broke.
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const SEC = [{ id: 'dinner', label: 'Dinner', icon: 'x' },
  { id: 'activities', label: 'Activities', icon: 'x' }];

// Two items WITH geo, so markers must appear without any network at all.
const PLACED = { schema: 1,
  city: { name: 'Istanbul', country: 'TUR', dates: { from: '2026-09-16', to: '2026-09-25' },
    geo: { lat: 41.0082, lng: 28.9784, source: 'nominatim' } },
  sections: SEC,
  items: [
    { id: 'ciya', section: 'dinner', status: 'plan', name: 'Ciya Sofrasi', note: 'n', links: [],
      geo: { lat: 40.9893, lng: 29.0244, source: 'nominatim' } },
    { id: 'basilica', section: 'activities', status: 'plan', name: 'Basilica Cistern', note: 'n', links: [],
      geo: { lat: 41.0085, lng: 28.9784, source: 'nominatim' } },
    { id: 'daisy', section: 'dinner', status: 'plan', name: 'Daisy Laundry', note: 'n', links: [] }
  ] };

// Nothing placed: Rob's actual state, and the one that shipped broken.
const UNPLACED = { schema: 1,
  city: { name: 'Istanbul', country: 'TUR', dates: { from: '2026-09-16', to: '2026-09-25' } },
  sections: SEC,
  items: [{ id: 'ciya', section: 'dinner', status: 'plan', name: 'Ciya Sofrasi', note: 'n',
    links: [{ kind: 'map', href: 'https://www.google.com/maps/search/?api=1&query=Ciya+Istanbul' }] }] };

async function open(browser, city, opts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(([k, d]) => {
    try {
      localStorage.setItem(k, JSON.stringify({ cities: { 'istanbul-2026-09-16': d },
        updatedAt: { 'istanbul-2026-09-16': new Date().toISOString() },
        active: 'istanbul-2026-09-16' }));
    } catch (e) {}
  }, ['cityops.app.v1', city]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
  // The geocoder is blocked in both runs: a CI check must not depend on
  // Nominatim being up, or on spending somebody's rate limit.
  await page.route('**nominatim.openstreetmap.org/**', (r) => r.abort());
  if (opts && opts.offline) await page.route('**cdnjs.cloudflare.com/**', (r) => r.abort());
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'),
    { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(opts && opts.offline ? 2500 : 6000);
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  let failed = 0;
  function check(name, fn) {
    try { fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
  }

  // 1. Cached coordinates must produce real markers.
  const a = await open(browser, PLACED);
  const placed = await a.page.evaluate(() => ({
    canvases: document.querySelectorAll('.mapcanvas').length,
    containers: document.querySelectorAll('.leaflet-container').length,
    markerIcons: document.querySelectorAll('.leaflet-marker-icon').length,
    missing: (document.querySelector('.mapmissing summary') || {}).textContent || ''
  }));
  check('a guide with cached coordinates draws markers', () => {
    assert.ok(placed.containers >= 1, 'no .leaflet-container: ' + JSON.stringify(placed));
    assert.ok(placed.markerIcons >= 1,
      'no .leaflet-marker-icon, so a map regression would reach a traveler: ' + JSON.stringify(placed));
    assert.ok(/1 place is not on the map yet/.test(placed.missing), placed.missing);
  });
  check('a guide with cached coordinates logs no page errors', () => {
    assert.equal(a.errors.length, 0, a.errors.join(' | '));
  });

  // 2. Nothing placed must STILL draw a canvas. This is the 09-18 regression.
  const b = await open(browser, UNPLACED);
  const unplaced = await b.page.evaluate(() => ({
    blocks: document.querySelectorAll('.mapblock').length,
    canvases: document.querySelectorAll('.mapcanvas').length,
    containers: document.querySelectorAll('.leaflet-container').length
  }));
  check('a guide with nothing placed still draws a map canvas', () => {
    assert.ok(unplaced.blocks >= 1, JSON.stringify(unplaced));
    assert.ok(unplaced.canvases >= 1,
      'no canvas with nothing placed: this is exactly the bug that hid the map for two days: ' +
      JSON.stringify(unplaced));
    assert.ok(unplaced.containers >= 1, 'Leaflet never initialised: ' + JSON.stringify(unplaced));
  });

  // 3. With the tile CDN blocked the page must still render and not throw.
  const c = await open(browser, PLACED, { offline: true });
  const off = await c.page.evaluate(() => ({
    body: (document.body.innerText || '').length,
    missing: (document.querySelector('.mapmissing summary') || {}).textContent || ''
  }));
  check('the page still renders with the tile CDN blocked', () => {
    assert.ok(off.body > 100, 'the page rendered nothing offline');
    assert.equal(c.errors.length, 0, c.errors.join(' | '));
  });

  await browser.close();
  console.log(failed ? failed + ' headless check(s) failed' : 'all headless checks passed');
  process.exit(failed ? 1 : 0);
})();
