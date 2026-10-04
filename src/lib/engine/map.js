import { mapSvg } from './tiles.js';
import { clamp } from './util.js';

/* Real streets for map tiles. OpenStreetMap data from OpenFreeMap, drawn by
   MapLibre in the same paper colors the old illustrated map used. */

export const DEFAULT_Z = 14;
export const hasCoords = t => Number.isFinite(t?.lat) && Number.isFinite(t?.lon);
export const zoomOf = t => clamp(Number.isFinite(t.z) ? t.z : DEFAULT_Z, 3, 18);

export function osmUrl(t) {
  if (!hasCoords(t)) return 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(t.place || '');
  const z = Math.round(zoomOf(t));
  return `https://www.openstreetmap.org/?mlat=${t.lat}&mlon=${t.lon}#map=${z}/${t.lat}/${t.lon}`;
}

const C = {
  ground: '#EFEFEB',
  water: '#D5DFE2',
  waterText: '#8FA2A8',
  park: '#DDE5DA',
  building: '#E6E6E1',
  road: '#FFFFFF',
  casing: '#DCDCD6',
  rail: '#C9C9C4',
  label: '#9A9A96',
};

const MAJOR = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const MINOR = ['minor', 'service', 'track'];
const width = stops => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];

function style() {
  const lang = (navigator.language || 'en').slice(0, 2);
  const name = ['coalesce', ['get', 'name:' + lang], ['get', 'name']];
  const line = { 'line-cap': 'round', 'line-join': 'round' };
  const roads = classes => ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'class'], ['literal', classes]], ['!=', ['get', 'brunnel'], 'tunnel']];
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { osm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': C.ground } },
      { id: 'green', type: 'fill', source: 'osm', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]], paint: { 'fill-color': C.park, 'fill-opacity': 0.7 } },
      { id: 'park', type: 'fill', source: 'osm', 'source-layer': 'park', paint: { 'fill-color': C.park } },
      { id: 'water', type: 'fill', source: 'osm', 'source-layer': 'water', paint: { 'fill-color': C.water } },
      { id: 'river', type: 'line', source: 'osm', 'source-layer': 'waterway', layout: line, paint: { 'line-color': C.water, 'line-width': width([10, 1, 16, 6]) } },
      { id: 'building', type: 'fill', source: 'osm', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': C.building, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1] } },
      { id: 'minor', type: 'line', source: 'osm', 'source-layer': 'transportation', minzoom: 12, filter: roads(MINOR), layout: line, paint: { 'line-color': C.road, 'line-width': width([12, 0.5, 14, 1.6, 16, 4.5, 18, 14]) } },
      { id: 'rail', type: 'line', source: 'osm', 'source-layer': 'transportation', filter: roads(['rail']), paint: { 'line-color': C.rail, 'line-width': 1.2, 'line-dasharray': [3, 3] } },
      { id: 'major-casing', type: 'line', source: 'osm', 'source-layer': 'transportation', filter: roads(MAJOR), layout: line, paint: { 'line-color': C.casing, 'line-width': width([8, 1.5, 12, 3, 14, 7, 16, 13, 18, 30]) } },
      { id: 'major', type: 'line', source: 'osm', 'source-layer': 'transportation', filter: roads(MAJOR), layout: line, paint: { 'line-color': C.road, 'line-width': width([8, 1, 12, 2, 14, 5, 16, 10, 18, 24]) } },
      {
        id: 'water-name', type: 'symbol', source: 'osm', 'source-layer': 'water_name',
        layout: { 'text-field': name, 'text-font': ['Noto Sans Italic'], 'text-size': 10, 'text-letter-spacing': 0.04, 'text-max-width': 8 },
        paint: { 'text-color': C.waterText, 'text-halo-color': C.water, 'text-halo-width': 1 },
      },
      {
        id: 'place', type: 'symbol', source: 'osm', 'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood']]],
        layout: {
          'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-max-width': 7,
          'text-size': ['match', ['get', 'class'], ['city', 'town'], 11, 10],
        },
        paint: { 'text-color': C.label, 'text-halo-color': C.ground, 'text-halo-width': 1.5 },
      },
    ],
  };
}

// Maps only ever draw in the browser. The server build never sees MapLibre or its worker.
let libP;
const lib = () => (libP ||= import.meta.env.SSR ? Promise.reject(new Error('no maps on the server')) : Promise.all([
  import('maplibre-gl'),
  import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
  import('maplibre-gl/dist/maplibre-gl.css'),
]).then(([m, w]) => { m.setWorkerUrl(w.default); return m; }));

// Keep the cat where the CSS put the pin, not in the middle of the tile.
function padding(el) {
  const pin = el.querySelector('.pin');
  const w = el.clientWidth, h = el.clientHeight;
  if (!pin || !w || !h) return { top: 0, right: 0, bottom: 0, left: 0 };
  const x = pin.offsetLeft + pin.offsetWidth / 2, y = pin.offsetTop + pin.offsetHeight / 2;
  return { left: Math.max(0, 2 * x - w), right: Math.max(0, w - 2 * x), top: Math.max(0, 2 * y - h), bottom: Math.max(0, h - 2 * y) };
}

const camera = (el, t) => ({ center: [t.lon, t.lat], zoom: zoomOf(t), padding: padding(el) });

function fallback(slot) {
  slot.innerHTML = mapSvg(1);
  slot.classList.add('ready');
}

function create(m, node, el, t, opts = {}) {
  return new m.Map({
    container: node,
    style: style(),
    ...camera(el, t),
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    ...opts,
  });
}

/* ---------- live maps, for the editor and visitors ---------- */

// A live map outlives re-renders: its node moves into the fresh slot and the camera eases over.
const live = new Set();
let sweeper = 0;
function drop(lm) {
  lm.map?.remove();
  lm.io?.disconnect();
  if (lm.el._map === lm) lm.el._map = null;
  live.delete(lm);
}
function sweep() {
  for (const lm of live) if (!lm.node.isConnected) drop(lm);
  if (!live.size) { clearInterval(sweeper); sweeper = 0; }
}

function mountLive(el, t, slot) {
  let lm = el._map;
  if (lm) {
    slot.append(lm.node);
    slot.classList.toggle('ready', lm.ready);
    lm.t = t;
    lm.map?.easeTo({ ...camera(el, t), duration: 450 });
    return;
  }
  const node = document.createElement('div');
  node.className = 'map-canvas';
  slot.append(node);
  lm = el._map = { el, node, t, map: null, ready: false };
  live.add(lm);
  sweeper ||= setInterval(sweep, 5000);

  // Only wake MapLibre once the tile is close to the screen.
  lm.io = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting) return;
    lm.io.disconnect();
    try {
      const m = await lib();
      if (!node.isConnected) return;
      lm.map = create(m, node, el, lm.t);
      lm.map.on('resize', () => lm.map.jumpTo(camera(el, lm.t)));
      lm.map.once('idle', () => { lm.ready = true; node.parentElement?.classList.add('ready'); });
    } catch {
      if (node.parentElement) fallback(node.parentElement);
    }
  }, { rootMargin: '200px' });
  lm.io.observe(el);
}

/* ---------- pictures, for miniatures ---------- */

// Miniatures can show many boxes at once, more than a browser has WebGL contexts.
// Each map is drawn once, turned into an image, and its context let go.
const shots = new Map();
let queue = Promise.resolve();

function mountStatic(el, t, slot) {
  const w = slot.clientWidth, h = slot.clientHeight;
  if (!w || !h) return;
  const key = [t.lat, t.lon, zoomOf(t), w, h, slot.closest('.tile')?.className].join();
  const show = src => { slot.innerHTML = `<img class="map-shot" src="${src}" alt="">`; slot.classList.add('ready'); };
  if (shots.has(key)) return show(shots.get(key));
  queue = queue.then(async () => {
    if (!slot.isConnected) return;
    const m = await lib();
    const node = document.createElement('div');
    node.className = 'map-canvas';
    slot.append(node);
    const map = create(m, node, el, t, { canvasContextAttributes: { preserveDrawingBuffer: true } });
    await new Promise(res => { map.once('idle', res); setTimeout(res, 8000); });
    const src = map.getCanvas().toDataURL('image/webp', 0.9);
    map.remove();
    shots.set(key, src);
    if (slot.isConnected) show(src);
  }).catch(() => { if (slot.isConnected) fallback(slot); });
}

export function mountMap(el, t, mode) {
  const slot = el.querySelector('.map-view');
  if (!slot) { if (el._map) drop(el._map); return; }
  if (mode === 'static') mountStatic(el, t, slot);
  else mountLive(el, t, slot);
}

export function unmountMap(el) {
  if (el._map) drop(el._map);
  if (!live.size) { clearInterval(sweeper); sweeper = 0; }
}
