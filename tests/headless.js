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

// Places across every tab, coordinates cached, so each tab has both something
// to list and something to pin.
const TABBED = { schema: 1,
  city: { name: 'Istanbul', country: 'TUR', dates: { from: '2026-09-16', to: '2026-09-25' },
    geo: { lat: 41.0082, lng: 28.9784 } },
  sections: ['dinner', 'coffee', 'activities', 'services', 'practical']
    .map(function (id) { return { id: id, label: id, icon: 'x' }; }),
  items: [
    ['ciya', 'dinner', 40.9893, 29.0244], ['montag', 'coffee', 40.9901, 29.0242],
    ['basilica', 'activities', 41.0085, 28.9784], ['vodafone', 'services', 40.9912, 29.0246],
    ['ziraat', 'practical', 40.9814, 29.0683]
  ].map(function (r) {
    return { id: r[0], section: r[1], status: 'plan', name: r[0], note: 'n', links: [],
      geo: { lat: r[2], lng: r[3], source: 'nominatim' } };
  }) };

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

  // 4. EVERY TAB with places must have a map, not just Plan.
  //
  // #44 collected a tab's items from `sv.groups` and `sv.entries`, which a
  // section view-model has never had, so tabItems was always empty and no
  // category tab ever drew a map. Nobody noticed for four days because Plan
  // worked and Plan is the tab the app lands on.
  const d = await open(browser, TABBED);
  const perTab = {};
  for (const tab of ['Plan', 'Eat & Drink', 'Do', 'Services', 'Info']) {
    const btn = d.page.locator('button, [role=tab]')
      .filter({ hasText: new RegExp('^' + tab + '$') }).first();
    if (await btn.count()) { await btn.click({ force: true }); await d.page.waitForTimeout(1200); }
    perTab[tab] = await d.page.evaluate(() => ({
      cards: document.querySelectorAll('[data-item-id]').length,
      blocks: document.querySelectorAll('.mapblock').length,
      containers: document.querySelectorAll('.leaflet-container').length,
      pins: document.querySelectorAll('.leaflet-marker-icon').length
    }));
  }
  check('every tab that has places also has a map with pins', () => {
    Object.keys(perTab).forEach(function (tab) {
      const r = perTab[tab];
      if (tab !== 'Plan' && r.cards === 0) return;   // an empty tab needs no map
      assert.ok(r.blocks >= 1, tab + ': ' + r.cards + ' cards and no map block');
      assert.ok(r.containers >= 1, tab + ': a block but Leaflet never drew, ' + JSON.stringify(r));
      assert.ok(r.pins >= 1, tab + ': a map with no pins on placed items, ' + JSON.stringify(r));
    });
  });
  check('the tab walk logged no page errors', () => {
    assert.equal(d.errors.length, 0, d.errors.join(' | '));
  });

  // 5. The traveler places a pin himself, end to end, in a real browser.
  //
  // Daisy Laundry is in the PLACED fixture precisely because nothing can look
  // it up: no geo, no map link. That is the shape of 18 of Rob's 35 Istanbul
  // places, and until now it was permanent. This walks the whole way: the
  // "Place it" button in the map's own missing list, the picker map, a tap, a
  // save, and the pin surviving the re-render as the traveler's own.
  const e = await open(browser, PLACED);
  const before = await e.page.evaluate(() => ({
    markers: document.querySelectorAll('.leaflet-marker-icon').length,
    placeButtons: document.querySelectorAll('[data-place-item]').length,
    daisy: document.querySelectorAll('[data-place-item="daisy"]').length
  }));
  check('the map offers Place it on the one place nothing can look up', () => {
    assert.equal(before.daisy, 1, 'no Place it for Daisy Laundry: ' + JSON.stringify(before));
  });

  // The list is a collapsed <details>, so open it the way a traveler does:
  // the summary already says "1 place is not on the map yet".
  await e.page.evaluate(() => {
    document.querySelectorAll('details.mapmissing').forEach((d) => { d.open = true; });
  });
  await e.page.waitForTimeout(200);
  await e.page.click('[data-place-item="daisy"]');
  await e.page.waitForTimeout(3000);
  const picker = await e.page.evaluate(() => ({
    modal: document.querySelectorAll('.modal').length,
    canvas: document.querySelectorAll('.place-canvas').length,
    drawn: document.querySelectorAll('.place-canvas.leaflet-container').length,
    saveDisabled: !!(document.querySelector('.modal .to-done') || {}).disabled
  }));
  check('Place it opens a picker map with Save held back until a spot is chosen', () => {
    assert.equal(picker.modal, 1, JSON.stringify(picker));
    assert.equal(picker.canvas, 1, JSON.stringify(picker));
    assert.ok(picker.drawn >= 1, 'the picker never drew a map: ' + JSON.stringify(picker));
    assert.equal(picker.saveDisabled, true,
      'Save was offered before a spot was picked, so an empty tap would write a pin');
  });

  const box = await e.page.locator('.place-canvas').boundingBox();
  await e.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await e.page.waitForTimeout(600);
  await e.page.click('.modal .to-done');
  await e.page.waitForTimeout(3000);
  const after = await e.page.evaluate(() => {
    let stored = null;
    try {
      const raw = JSON.parse(localStorage.getItem('cityops.app.v1') || '{}');
      const city = raw.cities && raw.cities['istanbul-2026-09-16'];
      const it = ((city && city.items) || []).filter((x) => x && x.id === 'daisy')[0];
      stored = it && it.geo ? { source: it.geo.source, lat: it.geo.lat, lng: it.geo.lng } : null;
    } catch (err) {}
    return {
      markers: document.querySelectorAll('.leaflet-marker-icon').length,
      modal: document.querySelectorAll('.modal').length,
      stillMissing: document.querySelectorAll('[data-place-item="daisy"]').length,
      stored: stored
    };
  });
  check('a hand-placed pin is saved, drawn, and marked as the traveler own', () => {
    assert.equal(after.modal, 0, 'the picker did not close on save');
    assert.ok(after.stored, 'nothing was written to the guide: ' + JSON.stringify(after));
    assert.equal(after.stored.source, 'manual',
      'a hand pin was stored as a guess, so the geocoder could overwrite it later');
    assert.ok(after.markers > before.markers,
      'the pin was saved but never drawn: ' + JSON.stringify({ before: before.markers, after: after }));
    assert.equal(after.stillMissing, 0,
      'the place is pinned and still listed as not on the map');
  });
  check('the place-a-pin walk logged no page errors', () => {
    assert.equal(e.errors.length, 0, e.errors.join(' | '));
  });

  // 6. A DIALOG MUST WIN AGAINST THE MAP.
  //
  // Leaflet numbers its own furniture in the hundreds: .leaflet-pane is 400 and
  // its controls are 1000, written for a map that owns the page.
  // .leaflet-container starts no stacking context of its own, so those numbers
  // used to compete at the top level against the app's dialogs at 100.
  // Screenshot from Rob 2026-09-21: the sign-in sheet with the Plan map punched
  // through it, only the buttons below the map still visible. Reproduced here
  // before the fix: elementFromPoint at the map's centre returned a marker.
  //
  // The overlap is the only place the two compete, so that is where this looks.
  // A check at the dialog's centre passes on a broken build, because the centre
  // usually sits below the map.
  const f = await open(browser, PLACED);
  // The app's own dialog markup, built into the app's own #modal host: this is
  // exactly what modalShell() produces. The thing under test is the CSS
  // stacking contract, not the route to the sheet, so this asserts the
  // contract without adding a production hook that exists only for a test.
  const opened = await f.page.evaluate(() => {
    const host = document.getElementById('modal');
    if (!host) return false;
    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    const box = document.createElement('div');
    box.className = 'modal';
    const h = document.createElement('h3');
    h.textContent = 'Sign in to sync';
    box.appendChild(h);
    const p = document.createElement('p');
    p.textContent = 'Your cities and your progress follow you to your other devices.';
    box.appendChild(p);
    const b = document.createElement('button');
    b.textContent = 'Send magic link';
    box.appendChild(b);
    wrap.appendChild(box);
    host.appendChild(wrap);
    return true;
  });
  await f.page.waitForTimeout(400);
  const stack = await f.page.evaluate(() => {
    const m = document.querySelector('.modal');
    const lc = document.querySelector('.leaflet-container');
    if (!m || !lc) return { modal: !!m, map: !!lc };
    const lr = lc.getBoundingClientRect();
    const cx = Math.round(lr.left + lr.width / 2), cy = Math.round(lr.top + lr.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    const wrap = document.querySelector('.modal-wrap');
    const pane = document.querySelector('.leaflet-pane');
    return { modal: true, map: true,
      hitInsideDialog: !!(hit && m.contains(hit)),
      hitIsLeaflet: !!(hit && hit.closest && hit.closest('.leaflet-container')),
      wrapZ: Number(getComputedStyle(wrap).zIndex) || 0,
      paneZ: Number(getComputedStyle(pane).zIndex) || 0,
      blockIsolated: (function () {
        const b = document.querySelector('.mapblock');
        if (!b) return null;
        const cs = getComputedStyle(b);
        return cs.isolation === 'isolate' || cs.zIndex === '0';
      })() };
  });
  check('a dialog is not punched through by the map underneath it', () => {
    assert.ok(opened, 'the app has no #modal host, so the dialog had nowhere to go');
    assert.ok(stack.modal, 'the sign-in sheet never opened, so this proved nothing');
    assert.ok(stack.map, 'no map on the page, so this proved nothing');
    assert.equal(stack.hitIsLeaflet, false,
      'the map is on top of the dialog where they overlap: ' + JSON.stringify(stack));
    assert.equal(stack.hitInsideDialog, true,
      'the dialog does not receive the tap where the map overlaps it: ' + JSON.stringify(stack));
    assert.ok(stack.blockIsolated,
      '.mapblock starts no stacking context, so Leaflet 400/1000 still compete with the app');
    assert.ok(stack.wrapZ > 1000,
      'the dialog layer sits at ' + stack.wrapZ + ', below what Leaflet gives its own controls');
  });
  check('the dialog-over-map check logged no page errors', () => {
    assert.equal(f.errors.length, 0, f.errors.join(' | '));
  });

  await browser.close();
  console.log(failed ? failed + ' headless check(s) failed' : 'all headless checks passed');
  process.exit(failed ? 1 : 0);
})();
