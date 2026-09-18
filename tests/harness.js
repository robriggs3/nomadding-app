// Extracts the <script id="app"> block from template.html and evals it in Node.
// DOM globals are stubbed so CityOps.init() bails out and only pure logic loads.
const fs = require('fs');
const path = require('path');

function loadCityOps() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'template.html'), 'utf8');
  const m = html.match(/<script id="app">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No <script id="app"> block in template.html');
  // A DOM stub thin enough to stay honest and real enough to let the render
  // helpers run. Added 2026-09-18: renderMapBlock builds nodes, and the bug
  // that hid the map for two days was IN that builder, so it has to be
  // reachable from a node test rather than only from a browser.
  function stubNode(tag) {
    return {
      tagName: String(tag || 'div').toUpperCase(),
      children: [], attrs: {}, style: {}, textContent: '',
      classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
      appendChild: function (c) { this.children.push(c); return c; },
      insertBefore: function (c) { this.children.unshift(c); return c; },
      setAttribute: function (k, v) { this.attrs[k] = v; },
      getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      querySelector: function (sel) { return this.querySelectorAll(sel)[0] || null; },
      // Attribute selectors only, and an unsupported one THROWS rather than
      // returning [].
      //
      // This used to return [] for everything, which meant a test could query
      // for a control, get nothing back, and assert something true about
      // nothing. That is the same shape as the bug that hid the map for two
      // days: a check that reported healthy because it was looking at an empty
      // list. A loud failure here is worth more than a convenient empty one.
      querySelectorAll: function (sel) {
        var m = /^\[([a-zA-Z-]+)\]$/.exec(String(sel || ''));
        if (!m) throw new Error('stub DOM: unsupported selector "' + sel + '"');
        var want = m[1], out = [];
        (function walk(n) {
          (n.children || []).forEach(function (c) {
            if (c && c.attrs && Object.prototype.hasOwnProperty.call(c.attrs, want)) out.push(c);
            walk(c);
          });
        })(this);
        return out;
      },
      get firstChild() { return this.children[0] || null; }
    };
  }
  const stubDoc = {
    getElementById: function () { return null; },
    addEventListener: function () {},
    createElement: stubNode,
    querySelectorAll: function () { return []; }
  };
  const fn = new Function('document', 'window', 'localStorage',
    m[1] + '\nreturn CityOps;');
  return fn(stubDoc, undefined, undefined);
}
module.exports = { loadCityOps };
