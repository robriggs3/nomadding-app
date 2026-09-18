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
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
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
