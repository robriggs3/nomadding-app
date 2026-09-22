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
const { chromium, devices } = require('playwright');
const path = require('path');
const assert = require('assert');

const SEC = [{ id: 'dinner', label: 'Dinner', icon: 'x' },
  { id: 'activities', label: 'Activities', icon: 'x' }];

// Two items WITH geo, so markers must appear without any network at all.
// A Sultanahmet cluster plus one place across the Bosphorus, so Near has both
// an answer and something it must exclude.
const NEARBY = { schema: 1,
  city: { name: 'Istanbul', country: 'TUR', dates: { from: '2026-09-16', to: '2026-09-25' },
    geo: { lat: 41.0082, lng: 28.9784, source: 'nominatim' } },
  sections: [{ id: 'dinner', label: 'Dinner', icon: 'x' },
    { id: 'activities', label: 'Activities', icon: 'x' }],
  // All on ONE DAY on purpose, so the Plan map carries the whole cluster AND
  // the two places Near must exclude. On a tab holding only the neighbours
  // there is nothing left to dim and the dimming check would pass by having
  // nothing to do.
  items: [
    { id: 'hagia', section: 'activities', status: 'plan', day: '2026-09-17',
      name: 'Hagia Sophia', note: 'n', links: [],
      geo: { lat: 41.0086, lng: 28.9802, source: 'nominatim' } },
    { id: 'cistern', section: 'activities', status: 'plan', day: '2026-09-17',
      name: 'Basilica Cistern', note: 'n', links: [],
      geo: { lat: 41.0084, lng: 28.9779, source: 'nominatim' } },
    { id: 'pandeli', section: 'dinner', status: 'done', day: '2026-09-17',
      name: 'Pandeli', note: 'n', links: [],
      geo: { lat: 41.0166, lng: 28.9704, source: 'nominatim' } },
    { id: 'ciya', section: 'dinner', status: 'done', day: '2026-09-17',
      name: 'Ciya Sofrasi', note: 'n', links: [],
      geo: { lat: 40.9893, lng: 29.0244, source: 'nominatim' } }
  ] };

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

// The trip surface has its own storage key and its own page, so it needs its
// own opener. `mobile` matters: the bug this exists for does not exist at
// desktop width.
const TRIP_CITIES = (function () {
  const out = [];
  for (let i = 1; i <= 6; i++) {
    out.push({ id: 'c' + i, name: 'City ' + i, country: 'Turkey',
      checkIn: '2026-10-0' + i, checkOut: '2026-10-1' + i, state: '', status: 'confirmed',
      notes: '', estimatedCost: '1200', lat: '41.0', lng: '28.9',
      accommodations: [], neighborhoods: [], attractions: [], restaurants: [],
      dayTrips: [], coworking: [], friends: [] });
  }
  return out;
})();

async function openTrip(browser, mobile) {
  const ctx = await browser.newContext(mobile
    ? { ...devices['iPhone 13'] }
    : { viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} },
    ['planahead:v1', JSON.stringify({ cities: TRIP_CITIES })]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
  await page.goto('file://' + path.join(__dirname, '..', 'trip', 'index.html'),
    { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1200);
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

  // 7. TYPING A STAY NAME MUST NOT MOVE THE PAGE.
  //
  // Rob, mid-trip: typing in the Stay & Travel stay row jumped the page down on
  // every keystroke. Measured on the live app 2026-09-21 under iPhone 13, the
  // property name moved the page 4442 -> 4447 on each of five characters,
  // while every <input> in the same row held still and the same field was rock
  // steady at desktop width. It was a contenteditable div; mobile browsers
  // scroll the caret into view far more eagerly on those.
  //
  // PHONE WIDTH IS THE POINT. A desktop-only version of this check passes on
  // the broken build, which is why the bug survived my first three attempts to
  // reproduce it.
  for (const mobile of [true, false]) {
    const t = await openTrip(browser, mobile);
    const label = mobile ? 'phone' : 'desktop';
    await t.page.evaluate(() => { openCityIds.add('c6'); repaint(); addAccommodation('c6'); });
    await t.page.waitForTimeout(700);
    const nm = t.page.locator('.accom-item.open .accom-name').first();
    await nm.scrollIntoViewIfNeeded();
    await t.page.waitForTimeout(250);
    await nm.dblclick();
    await t.page.waitForTimeout(300);
    const y0 = await t.page.evaluate(() => window.scrollY);
    const editing = await t.page.evaluate(() => {
      const i = document.querySelector('.accom-item.open .accom-name-input');
      return { isInput: !!(i && !i.hidden), focused: !!(i && document.activeElement === i),
        stillContentEditable: !!document.querySelector('.accom-item.open .accom-name[contenteditable="true"]') };
    });
    const ys = [];
    for (const ch of ['H', 'o', 't', 'e', 'l']) {
      await t.page.keyboard.type(ch);
      await t.page.waitForTimeout(140);
      ys.push(await t.page.evaluate(() => window.scrollY));
    }
    await t.page.keyboard.press('Enter');
    await t.page.waitForTimeout(700);
    const saved = await t.page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('planahead:v1') || '{}');
      const c = (raw.cities || []).find((x) => x.id === 'c6');
      return c && c.accommodations && c.accommodations[0] ? c.accommodations[0].name : null;
    });
    const moved = ys.filter((y) => y !== y0).length;
    check('typing a stay name does not scroll the page (' + label + ')', () => {
      assert.equal(editing.isInput, true,
        label + ': renaming is not using a real input: ' + JSON.stringify(editing));
      assert.equal(editing.focused, true, label + ': the rename field never took focus');
      assert.equal(editing.stillContentEditable, false,
        label + ': the name is still a contenteditable, which is the bug');
      assert.equal(moved, 0,
        label + ': the page moved on ' + moved + ' of 5 keystrokes, from ' + y0 +
        ' to ' + JSON.stringify(ys));
    });
    check('a renamed stay keeps its name (' + label + ')', () => {
      assert.equal(saved, 'Hotel',
        label + ': the rename did not commit, so the fix traded a jump for lost data');
    });
    check('the stay rename walk logged no page errors (' + label + ')', () => {
      assert.equal(t.errors.length, 0, t.errors.join(' | '));
    });
  }

  // 8. NEAR, in a real browser.
  //
  // Rob's words: "This helps me arrange and align activities that are near each
  // other." The unit tests prove the arithmetic; this proves the traveler can
  // actually get to it: a control on a placed card, an answer in place, and the
  // map dimming what is not in it.
  const g = await open(browser, NEARBY);
  const pinsBefore = await g.page.evaluate(() => ({
    markers: document.querySelectorAll('.leaflet-marker-icon').length,
    numbered: document.querySelectorAll('.mappin-n').length,
    firstNumber: (document.querySelector('.mappin-n') || {}).textContent || '',
    nearButtons: document.querySelectorAll('.near-btn').length
  }));
  check('every pin carries its list number', () => {
    assert.ok(pinsBefore.markers >= 4, JSON.stringify(pinsBefore));
    assert.ok(pinsBefore.numbered >= 4,
      'pins are not numbered, so "the third one down" and "that pin" are different objects: ' +
      JSON.stringify(pinsBefore));
    assert.equal(pinsBefore.firstNumber, '1');
  });
  check('a placed card offers Near', () => {
    assert.ok(pinsBefore.nearButtons >= 1, 'no Near control on any card');
  });

  // Open Near on Hagia Sophia, from the Plan tab the app lands on.
  const nearOpened = await g.page.evaluate(() => {
    const card = document.querySelector('[data-item-id="hagia"]');
    if (!card) return 'no-card';
    const b = card.querySelector('.near-btn');
    if (!b) return 'no-button';
    b.click();
    return 'clicked';
  });
  await g.page.waitForTimeout(1500);
  const nearAfter = await g.page.evaluate(() => {
    const panel = document.querySelector('.nearpanel');
    const rows = panel ? [...panel.querySelectorAll('.nearrow')] : [];
    return {
      panel: !!panel,
      summary: panel ? (panel.querySelector('p') || {}).textContent || '' : '',
      names: rows.map((r) => (r.querySelector('.linklike') || {}).textContent || ''),
      minutes: rows.map((r) => (r.querySelector('.nearmins') || {}).textContent || ''),
      tabs: rows.map((r) => (r.querySelector('.neartab') || {}).textContent || ''),
      dimmed: document.querySelectorAll('.mappin.pin-dim').length,
      bright: document.querySelectorAll('.leaflet-marker-icon:not(.pin-dim)').length,
      anchors: document.querySelectorAll('.mappin.pin-anchor').length,
      stillDrawn: document.querySelectorAll('.leaflet-marker-icon').length
    };
  });
  check('Near answers in place, with a walk time and the tab it lives on', () => {
    assert.equal(nearOpened, 'clicked', 'could not reach the Near control: ' + nearOpened);
    assert.ok(nearAfter.panel, 'Near opened no panel: ' + JSON.stringify(nearAfter));
    assert.ok(/within about a 15 minute walk/.test(nearAfter.summary), nearAfter.summary);
    assert.ok(nearAfter.names.indexOf('Basilica Cistern') !== -1,
      'the nearest place is missing from the answer: ' + JSON.stringify(nearAfter.names));
    assert.ok(/\d+ min/.test(nearAfter.minutes.join(' ')),
      'no walking time on the rows: ' + JSON.stringify(nearAfter.minutes));
    assert.ok(nearAfter.names.indexOf('Ciya Sofrasi') === -1,
      'a place across the Bosphorus was listed as a walk');
  });
  check('Near dims the rest of the map without removing it', () => {
    assert.ok(nearAfter.dimmed >= 1,
      'nothing was dimmed, so the cluster is not visible at a glance: ' + JSON.stringify(nearAfter));
    assert.equal(nearAfter.stillDrawn, pinsBefore.markers,
      'dimming removed pins instead of dimming them: ' + JSON.stringify(nearAfter));
    // One per map, and the Plan tab draws two: the whole-guide map and the
    // day's own. Both must mark the anchor, so this is at-least-one rather
    // than exactly-one.
    assert.ok(nearAfter.anchors >= 1,
      'the card Near was opened from is not marked on the map: ' + JSON.stringify(nearAfter));
  });
  check('the Near walk logged no page errors', () => {
    assert.equal(g.errors.length, 0, g.errors.join(' | '));
  });

  // 9. DONE PLACES: grey, and removable from every map at once.
  const dn = await open(browser, NEARBY);
  const doneBefore = await dn.page.evaluate(() => {
    const grey = [...document.querySelectorAll('.mappin-dot')]
      .filter((d) => (d.getAttribute('style') || '').indexOf('154, 163, 162') !== -1 ||
        (d.getAttribute('style') || '').toLowerCase().indexOf('#9aa3a2') !== -1);
    return { markers: document.querySelectorAll('.leaflet-marker-icon').length,
      grey: grey.length,
      toggles: document.querySelectorAll('.hide-done').length,
      label: (document.querySelector('.hide-done') || {}).textContent || '',
      maps: document.querySelectorAll('.leaflet-container').length };
  });
  check('a done place is grey on the map', () => {
    assert.ok(doneBefore.maps >= 1, JSON.stringify(doneBefore));
    assert.ok(doneBefore.grey >= 1,
      'no grey pin for a done place: ' + JSON.stringify(doneBefore));
    assert.ok(doneBefore.toggles >= 1, 'no Hide done control: ' + JSON.stringify(doneBefore));
    assert.ok(/Hide done \(\d+\)/.test(doneBefore.label), doneBefore.label);
  });

  await dn.page.evaluate(() => { document.querySelector('.hide-done').click(); });
  await dn.page.waitForTimeout(1800);
  const hidden = await dn.page.evaluate(() => ({
    markers: document.querySelectorAll('.leaflet-marker-icon').length,
    toggles: document.querySelectorAll('.hide-done').length,
    label: (document.querySelector('.hide-done') || {}).textContent || '',
    maps: document.querySelectorAll('.leaflet-container').length
  }));
  check('Hide done takes them off every map at once, and offers the way back', () => {
    assert.ok(hidden.markers < doneBefore.markers,
      'nothing was removed: ' + JSON.stringify({ doneBefore: doneBefore.markers, hidden: hidden }));
    // THE CONTROL MUST SURVIVE ITS OWN EFFECT. Counted from the guide, not
    // from what is left on the map, or hiding would take the way back with it.
    assert.ok(hidden.toggles >= 1,
      'the toggle vanished with the pins, so there is no way back: ' + JSON.stringify(hidden));
    assert.ok(/Show done \(\d+\)/.test(hidden.label), hidden.label);
    assert.equal(hidden.maps, doneBefore.maps, 'a map disappeared rather than losing pins');
  });

  await dn.page.evaluate(() => { document.querySelector('.hide-done').click(); });
  await dn.page.waitForTimeout(1800);
  const restored = await dn.page.evaluate(() => ({
    markers: document.querySelectorAll('.leaflet-marker-icon').length
  }));
  check('Show done puts them back', () => {
    assert.equal(restored.markers, doneBefore.markers,
      'the pins did not come back: ' + JSON.stringify({ doneBefore: doneBefore.markers, restored: restored }));
  });
  check('the done-places walk logged no page errors', () => {
    assert.equal(dn.errors.length, 0, dn.errors.join(' | '));
  });

  await browser.close();
  console.log(failed ? failed + ' headless check(s) failed' : 'all headless checks passed');
  process.exit(failed ? 1 : 0);
})();
