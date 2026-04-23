const originalInitTile = L.GridLayer.prototype._initTile;
L.GridLayer.include({
  _initTile(tile) {
    originalInitTile.call(this, tile);
    const tileSize = this.getTileSize();
    tile.style.width = `${tileSize.x + 1}px`;
    tile.style.height = `${tileSize.y + 1}px`;
  },
});

const WORLD_BOUNDS = [
  [-85.0511287776, -179.999999975],
  [85.0511287776, 179.999999975],
];

const map = L.map('map', {
  attributionControl: true,
  worldCopyJump: false,
  preferCanvas: true,
  maxBounds: WORLD_BOUNDS,
  maxBoundsViscosity: 1,
}).setView([24, 7], 3);

map.createPane('basePane');
map.getPane('basePane').style.zIndex = 200;
map.createPane('fieldPane');
map.getPane('fieldPane').style.zIndex = 320;

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
  pane: 'basePane',
  noWrap: true,
  bounds: WORLD_BOUNDS,
}).addTo(map);

const statusPill = document.getElementById('status-pill');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const locateBtn = document.getElementById('locate-btn');
const refreshBtn = document.getElementById('refresh-btn');
const layerControls = document.getElementById('layer-controls');
const opacityInput = document.getElementById('overlay-opacity');

const heroTitle = document.getElementById('hero-title');
const heroCopy = document.getElementById('hero-copy');
const focusName = document.getElementById('focus-name');
const focusTime = document.getElementById('focus-time');
const focusTemp = document.getElementById('focus-temp');
const focusFeels = document.getElementById('focus-feels');
const focusWind = document.getElementById('focus-wind');
const focusCloud = document.getElementById('focus-cloud');
const dataProvider = document.getElementById('data-provider');
const dataSource = document.getElementById('data-source');
const dataGridSize = document.getElementById('data-grid-size');
const dataTime = document.getElementById('data-time');
const dataRange = document.getElementById('data-range');
const dataCadence = document.getElementById('data-cadence');
const dataNext = document.getElementById('data-next');

const LAYER_MODES = {
  temperature: {
    label: 'Temperature field',
    chip: 'Temperature',
    field: 'temperature',
    unit: 'temperature',
    cadence: 'Shared 15-minute snapshot',
    copy: 'A quota-safe global temperature snapshot rendered over the map, so panning stays instant and the backend is not hammering upstream weather services.',
  },
  wind: {
    label: 'Wind field',
    chip: 'Wind',
    field: 'windSpeed',
    unit: 'windSpeed',
    cadence: 'Shared 15-minute snapshot',
    copy: 'Real 10m wind from the shared snapshot, with direction vectors layered on top so the atmosphere still reads as motion instead of just color.',
    vectors: true,
  },
  precipitation: {
    label: 'Rain field',
    chip: 'Rain',
    field: 'precipitation',
    unit: 'precipitation',
    cadence: 'Shared 15-minute snapshot',
    copy: 'Previous-hour precipitation from the same paced global snapshot, avoiding viewport-driven fetch storms while still showing where the weather is actually active.',
  },
  cloud: {
    label: 'Cloud field',
    chip: 'Cloud',
    field: 'cloudCover',
    unit: 'cloudCover',
    cadence: 'Shared 15-minute snapshot',
    copy: 'Cloud cover sampled once per shared backend cycle and projected smoothly across the globe, which keeps it elegant and budget-safe.',
  },
};

const state = {
  mode: 'temperature',
  opacity: Number(opacityInput.value) / 100,
  focusLabel: 'Atlantic focus',
  refreshTimer: null,
  requestToken: 0,
  fieldData: null,
  refreshInFlight: false,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapLongitude(value) {
  let longitude = value;
  while (longitude < -180) longitude += 360;
  while (longitude > 180) longitude -= 360;
  return longitude;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((part) => part + part).join('')
    : clean;

  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function mixColor(colorA, colorB, amount) {
  const mixed = colorA.map((channel, index) =>
    Math.round(channel + (colorB[index] - channel) * amount)
  );
  return mixed;
}

function rgba(color, alpha) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function colorFromStops(stops, value) {
  if (value <= stops[0][0]) return hexToRgb(stops[0][1]);
  if (value >= stops[stops.length - 1][0]) return hexToRgb(stops[stops.length - 1][1]);

  for (let index = 0; index < stops.length - 1; index += 1) {
    const [startOffset, startColor] = stops[index];
    const [endOffset, endColor] = stops[index + 1];
    if (value >= startOffset && value <= endOffset) {
      const localAmount = (value - startOffset) / (endOffset - startOffset || 1);
      return mixColor(hexToRgb(startColor), hexToRgb(endColor), localAmount);
    }
  }

  return hexToRgb(stops[0][1]);
}

function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value.includes('Z') ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ');
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

function getRangeText() {
  if (!state.fieldData) return '—';
  const mode = LAYER_MODES[state.mode];
  const stats = state.fieldData.stats?.[mode.field];
  const unit = state.fieldData.units?.[mode.unit] || '';

  if (!stats || stats.min === null || stats.max === null) return '—';

  const digits = mode.field === 'precipitation' ? 1 : 0;
  return `${formatNumber(stats.min, digits)}–${formatNumber(stats.max, digits)} ${unit}`;
}

function setStatus(message) {
  statusPill.textContent = message;
}

function getFieldStyle(modeKey, value, stats) {
  if (!Number.isFinite(value)) return 'rgba(0, 0, 0, 0)';

  if (modeKey === 'temperature') {
    const min = Math.min(stats?.min ?? 0, -12);
    const max = Math.max(stats?.max ?? 0, 34);
    const t = clamp((value - min) / (max - min || 1), 0, 1);
    const color = colorFromStops(
      [
        [0, '#17306d'],
        [0.18, '#206ac7'],
        [0.42, '#41c7ff'],
        [0.62, '#ffe273'],
        [0.82, '#ff8a4c'],
        [1, '#b31a5f'],
      ],
      t
    );
    return rgba(color, 0.18 + t * 0.48);
  }

  if (modeKey === 'precipitation') {
    const max = Math.max(stats?.max ?? 0, 0.5);
    const t = clamp(Math.log1p(value) / Math.log1p(max || 1), 0, 1);
    const color = colorFromStops(
      [
        [0, '#3bc9ff'],
        [0.45, '#4c8cff'],
        [0.78, '#7d5dff'],
        [1, '#f36eff'],
      ],
      t
    );
    return rgba(color, value <= 0.02 ? 0.03 : 0.12 + t * 0.52);
  }

  if (modeKey === 'cloud') {
    const t = clamp(value / 100, 0, 1);
    const color = colorFromStops(
      [
        [0, '#7ad5ff'],
        [0.35, '#cde7ff'],
        [0.7, '#edf5ff'],
        [1, '#ffffff'],
      ],
      t
    );
    return rgba(color, 0.06 + t * 0.44);
  }

  if (modeKey === 'wind') {
    const max = Math.max(stats?.max ?? 0, 30);
    const t = clamp(value / (max || 1), 0, 1);
    const color = colorFromStops(
      [
        [0, '#1a5fa4'],
        [0.32, '#29c3c9'],
        [0.66, '#b3f870'],
        [1, '#ffb454'],
      ],
      t
    );
    return rgba(color, 0.12 + t * 0.4);
  }

  return 'rgba(0, 0, 0, 0)';
}

const WeatherFieldOverlay = L.Layer.extend({
  initialize(options = {}) {
    L.setOptions(this, options);
    this._data = null;
    this._mode = options.mode || 'temperature';
    this._opacity = options.opacity ?? 0.6;
  },

  onAdd(activeMap) {
    this._map = activeMap;
    this._canvas = L.DomUtil.create('canvas', 'weather-field-overlay');
    this._canvas.style.position = 'absolute';
    this._canvas.style.pointerEvents = 'none';
    this._canvas.style.opacity = String(this._opacity);
    activeMap.getPane('fieldPane').appendChild(this._canvas);
    activeMap.on('moveend zoomend resize', this._reset, this);
    this._reset();
  },

  onRemove(activeMap) {
    activeMap.off('moveend zoomend resize', this._reset, this);
    if (this._canvas?.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
  },

  setData(data) {
    this._data = data;
    this._draw();
    return this;
  },

  setMode(mode) {
    this._mode = mode;
    this._draw();
    return this;
  },

  setOpacity(opacity) {
    this._opacity = opacity;
    if (this._canvas) {
      this._canvas.style.opacity = String(opacity);
    }
    return this;
  },

  _reset() {
    if (!this._map || !this._canvas) return;

    const size = this._map.getSize();
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);

    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = Math.round(size.x * dpr);
    this._canvas.height = Math.round(size.y * dpr);
    this._canvas.style.width = `${size.x}px`;
    this._canvas.style.height = `${size.y}px`;

    this._ctx = this._canvas.getContext('2d');
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._draw();
  },

  _draw() {
    if (!this._ctx || !this._canvas) return;

    const size = this._map.getSize();
    this._ctx.clearRect(0, 0, size.x, size.y);

    if (!this._data) return;

    const { rows, cols, latitudes, longitudes, fields, stats } = this._data;
    const mode = LAYER_MODES[this._mode];
    const values = fields?.[mode.field];

    if (!values || !latitudes || !longitudes || rows < 2 || cols < 2) return;

    const subdivisions = mode.field === 'precipitation' ? 3 : 4;

    this._ctx.save();

    for (let row = 0; row < rows - 1; row += 1) {
      for (let col = 0; col < cols - 1; col += 1) {
        const index = row * cols + col;
        const v00 = values[index];
        const v10 = values[index + 1];
        const v01 = values[index + cols];
        const v11 = values[index + cols + 1];

        if (![v00, v10, v01, v11].every(Number.isFinite)) continue;

        const nw = this._map.latLngToContainerPoint([latitudes[row], longitudes[col]]);
        const ne = this._map.latLngToContainerPoint([latitudes[row], longitudes[col + 1]]);
        const sw = this._map.latLngToContainerPoint([latitudes[row + 1], longitudes[col]]);
        const se = this._map.latLngToContainerPoint([latitudes[row + 1], longitudes[col + 1]]);

        for (let subRow = 0; subRow < subdivisions; subRow += 1) {
          const ty0 = subRow / subdivisions;
          const ty1 = (subRow + 1) / subdivisions;

          for (let subCol = 0; subCol < subdivisions; subCol += 1) {
            const tx0 = subCol / subdivisions;
            const tx1 = (subCol + 1) / subdivisions;
            const sampleValue = bilerpValue(v00, v10, v01, v11, (tx0 + tx1) / 2, (ty0 + ty1) / 2);
            const p00 = bilerpPoint(nw, ne, sw, se, tx0, ty0);
            const p10 = bilerpPoint(nw, ne, sw, se, tx1, ty0);
            const p01 = bilerpPoint(nw, ne, sw, se, tx0, ty1);
            const p11 = bilerpPoint(nw, ne, sw, se, tx1, ty1);

            this._ctx.beginPath();
            this._ctx.moveTo(p00.x, p00.y);
            this._ctx.lineTo(p10.x, p10.y);
            this._ctx.lineTo(p11.x, p11.y);
            this._ctx.lineTo(p01.x, p01.y);
            this._ctx.closePath();
            this._ctx.fillStyle = getFieldStyle(this._mode, sampleValue, stats?.[mode.field]);
            this._ctx.fill();
          }
        }
      }
    }

    this._ctx.restore();

    if (mode.vectors) {
      this._drawWindVectors();
    }
  },

  _drawWindVectors() {
    const { rows, cols, latitudes, longitudes, fields } = this._data;
    const speeds = fields?.windSpeed;
    const directions = fields?.windDirection;
    if (!speeds || !directions) return;

    const skip = Math.max(1, Math.round(Math.max(rows, cols) / 11));

    this._ctx.save();
    this._ctx.lineCap = 'round';
    this._ctx.lineJoin = 'round';

    for (let row = 1; row < rows - 1; row += skip) {
      for (let col = 1; col < cols - 1; col += skip) {
        const index = row * cols + col;
        const speed = speeds[index];
        const direction = directions[index];
        if (!Number.isFinite(speed) || !Number.isFinite(direction)) continue;

        const point = this._map.latLngToContainerPoint([latitudes[row], longitudes[col]]);
        const length = clamp(7 + speed * 0.18, 7, 20);
        const radians = (((direction + 180) % 360) * Math.PI) / 180;
        const dx = Math.sin(radians) * length;
        const dy = -Math.cos(radians) * length;

        this._ctx.beginPath();
        this._ctx.strokeStyle = 'rgba(5, 10, 18, 0.52)';
        this._ctx.lineWidth = 3.2;
        this._ctx.moveTo(point.x - dx * 0.35, point.y - dy * 0.35);
        this._ctx.lineTo(point.x + dx * 0.65, point.y + dy * 0.65);
        this._ctx.stroke();

        this._ctx.beginPath();
        this._ctx.strokeStyle = 'rgba(244, 250, 255, 0.84)';
        this._ctx.lineWidth = 1.3;
        this._ctx.moveTo(point.x - dx * 0.35, point.y - dy * 0.35);
        this._ctx.lineTo(point.x + dx * 0.65, point.y + dy * 0.65);
        this._ctx.stroke();

        const headLength = 4.6;
        const baseX = point.x + dx * 0.65;
        const baseY = point.y + dy * 0.65;
        const sideAngle = Math.PI / 6;

        this._ctx.beginPath();
        this._ctx.fillStyle = 'rgba(244, 250, 255, 0.86)';
        this._ctx.moveTo(baseX, baseY);
        this._ctx.lineTo(
          baseX - Math.sin(radians - sideAngle) * headLength,
          baseY + Math.cos(radians - sideAngle) * headLength
        );
        this._ctx.lineTo(
          baseX - Math.sin(radians + sideAngle) * headLength,
          baseY + Math.cos(radians + sideAngle) * headLength
        );
        this._ctx.closePath();
        this._ctx.fill();
      }
    }

    this._ctx.restore();
  },
});

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function bilerpValue(v00, v10, v01, v11, tx, ty) {
  const top = lerp(v00, v10, tx);
  const bottom = lerp(v01, v11, tx);
  return lerp(top, bottom, ty);
}

function bilerpPoint(p00, p10, p01, p11, tx, ty) {
  return {
    x: bilerpValue(p00.x, p10.x, p01.x, p11.x, tx, ty),
    y: bilerpValue(p00.y, p10.y, p01.y, p11.y, tx, ty),
  };
}

function findAxisSegment(axis, value, descending = false) {
  if (!axis?.length) return null;
  if (axis.length === 1) {
    return {
      startIndex: 0,
      endIndex: 0,
      t: 0,
    };
  }

  if (descending) {
    if (value >= axis[0]) {
      return { startIndex: 0, endIndex: 0, t: 0 };
    }
    if (value <= axis[axis.length - 1]) {
      const lastIndex = axis.length - 1;
      return { startIndex: lastIndex, endIndex: lastIndex, t: 0 };
    }

    for (let index = 0; index < axis.length - 1; index += 1) {
      if (value <= axis[index] && value >= axis[index + 1]) {
        return {
          startIndex: index,
          endIndex: index + 1,
          t: (axis[index] - value) / (axis[index] - axis[index + 1] || 1),
        };
      }
    }
  } else {
    if (value <= axis[0]) {
      return { startIndex: 0, endIndex: 0, t: 0 };
    }
    if (value >= axis[axis.length - 1]) {
      const lastIndex = axis.length - 1;
      return { startIndex: lastIndex, endIndex: lastIndex, t: 0 };
    }

    for (let index = 0; index < axis.length - 1; index += 1) {
      if (value >= axis[index] && value <= axis[index + 1]) {
        return {
          startIndex: index,
          endIndex: index + 1,
          t: (value - axis[index]) / (axis[index + 1] - axis[index] || 1),
        };
      }
    }
  }

  const fallbackIndex = axis.length - 1;
  return { startIndex: fallbackIndex, endIndex: fallbackIndex, t: 0 };
}

function sampleScalarFieldAt(fieldName, latitude, longitude) {
  if (!state.fieldData) return null;

  const { rows, cols, latitudes, longitudes, fields } = state.fieldData;
  const values = fields?.[fieldName];
  if (!values || !latitudes || !longitudes || !rows || !cols) return null;

  const rowSegment = findAxisSegment(latitudes, latitude, true);
  const colSegment = findAxisSegment(longitudes, longitude, false);
  if (!rowSegment || !colSegment) return null;

  const row0 = rowSegment.startIndex;
  const row1 = rowSegment.endIndex;
  const col0 = colSegment.startIndex;
  const col1 = colSegment.endIndex;

  const v00 = values[row0 * cols + col0];
  const v10 = values[row0 * cols + col1];
  const v01 = values[row1 * cols + col0];
  const v11 = values[row1 * cols + col1];

  if (row0 === row1 && col0 === col1) return v00;
  if (row0 === row1) return lerp(v00, v10, colSegment.t);
  if (col0 === col1) return lerp(v00, v01, rowSegment.t);
  return bilerpValue(v00, v10, v01, v11, colSegment.t, rowSegment.t);
}

function getFocusSample() {
  if (!state.fieldData) return null;

  const center = map.getCenter();
  const bbox = state.fieldData.bbox || {};
  const latitude = clamp(center.lat, bbox.south ?? -82, bbox.north ?? 82);
  const longitude = wrapLongitude(center.lng);

  return {
    latitude,
    longitude,
    temperature: sampleScalarFieldAt('temperature', latitude, longitude),
    apparentTemperature: sampleScalarFieldAt('apparentTemperature', latitude, longitude),
    precipitation: sampleScalarFieldAt('precipitation', latitude, longitude),
    cloudCover: sampleScalarFieldAt('cloudCover', latitude, longitude),
    windSpeed: sampleScalarFieldAt('windSpeed', latitude, longitude),
    windDirection: sampleScalarFieldAt('windDirection', latitude, longitude),
  };
}

const fieldOverlay = new WeatherFieldOverlay({
  opacity: state.opacity,
  mode: state.mode,
}).addTo(map);

function updateModeUI() {
  const mode = LAYER_MODES[state.mode];

  heroTitle.textContent = mode.label;
  heroCopy.textContent = mode.copy;
  dataProvider.textContent = state.fieldData?.provider || 'Open-Meteo';
  dataSource.textContent = mode.chip;
  dataGridSize.textContent = state.fieldData
    ? `${state.fieldData.cols} × ${state.fieldData.rows} samples`
    : '—';
  dataTime.textContent = state.fieldData ? formatTimestamp(state.fieldData.sampleTime) : '—';
  dataRange.textContent = getRangeText();
  dataCadence.textContent = state.fieldData
    ? `${state.fieldData.cadenceMinutes || 15} min`
    : mode.cadence;
  dataNext.textContent = state.fieldData ? formatTimestamp(state.fieldData.nextRefreshAt) : '—';

  layerControls.querySelectorAll('.chip').forEach((button) => {
    button.classList.toggle('active', button.dataset.layer === state.mode);
  });
}

function updateFocusCard() {
  const sample = getFocusSample();
  const units = state.fieldData?.units || {};

  focusName.textContent = state.focusLabel;
  focusTime.textContent = state.fieldData ? formatTimestamp(state.fieldData.sampleTime) : '—';
  focusTemp.textContent = sample
    ? `${formatNumber(sample.temperature, 0)} ${units.temperature || '°C'}`
    : '—';
  focusFeels.textContent = sample
    ? `${formatNumber(sample.apparentTemperature, 0)} ${units.apparentTemperature || '°C'}`
    : '—';
  focusWind.textContent = sample
    ? `${formatNumber(sample.windSpeed, 0)} ${units.windSpeed || 'km/h'}`
    : '—';
  focusCloud.textContent = sample
    ? `${formatNumber(sample.cloudCover, 0)} ${units.cloudCover || '%'}`
    : '—';
}

function scheduleNextSnapshotPoll(payload = state.fieldData) {
  clearTimeout(state.refreshTimer);
  if (!payload) return;

  const cadenceMs = (payload.cadenceMinutes || 15) * 60 * 1000;
  const nextRefreshMs = payload.nextRefreshAt
    ? new Date(payload.nextRefreshAt).getTime() + 5000
    : Date.now() + cadenceMs;
  const delay = clamp(nextRefreshMs - Date.now(), 60 * 1000, cadenceMs + 60 * 1000);

  state.refreshTimer = setTimeout(() => {
    fetchSnapshot('Polling next shared snapshot…');
  }, delay);
}

function isSnapshotStale(payload = state.fieldData) {
  if (!payload?.nextRefreshAt) return true;
  const nextRefreshMs = new Date(payload.nextRefreshAt).getTime();
  if (!Number.isFinite(nextRefreshMs)) return true;
  return Date.now() > nextRefreshMs + 5000;
}

async function fetchSnapshot(reason = 'Refreshing shared snapshot…') {
  if (state.refreshInFlight) return;

  state.refreshInFlight = true;
  const requestId = ++state.requestToken;
  setStatus(reason);

  try {
    const response = await fetch('/api/field', {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || `Snapshot request failed (${response.status})`);
    }

    const payload = await response.json();
    if (requestId !== state.requestToken) return;

    state.fieldData = payload;
    fieldOverlay.setData(payload).setMode(state.mode).setOpacity(state.opacity);
    updateModeUI();
    updateFocusCard();
    scheduleNextSnapshotPoll(payload);
    setStatus(`${LAYER_MODES[state.mode].chip} snapshot ready • ${payload.cols}×${payload.rows} global grid`);
  } catch (error) {
    console.error(error);
    if (requestId === state.requestToken) {
      if (state.fieldData) {
        setStatus('Using previous shared snapshot');
        scheduleNextSnapshotPoll(state.fieldData);
      } else {
        setStatus(error instanceof Error ? error.message : 'Snapshot refresh failed');
      }
    }
  } finally {
    state.refreshInFlight = false;
  }
}

async function searchPlace(query) {
  setStatus('Searching map…');
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  const results = await response.json();
  if (!results.length) throw new Error('No place found');

  const [first] = results;
  state.focusLabel = first.display_name.split(',').slice(0, 2).join(', ');
  map.flyTo([Number(first.lat), Number(first.lon)], Math.max(map.getZoom(), 7), {
    animate: true,
    duration: 1.8,
  });
}

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  try {
    await searchPlace(query);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Search failed');
  }
});

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Geolocation not available in this browser');
    return;
  }

  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      state.focusLabel = 'Your location';
      map.flyTo([coords.latitude, coords.longitude], 8, { animate: true, duration: 1.4 });
    },
    () => {
      setStatus('Could not get your location');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

refreshBtn.addEventListener('click', () => {
  fetchSnapshot('Checking the latest shared snapshot…');
});

opacityInput.addEventListener('input', () => {
  state.opacity = Number(opacityInput.value) / 100;
  fieldOverlay.setOpacity(state.opacity);
});

layerControls.addEventListener('click', (event) => {
  const button = event.target.closest('[data-layer]');
  if (!button) return;
  state.mode = button.dataset.layer;
  fieldOverlay.setMode(state.mode);
  updateModeUI();
  setStatus(`${LAYER_MODES[state.mode].chip} view updated`);
});

map.on('moveend zoomend', () => {
  updateFocusCard();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isSnapshotStale()) {
    fetchSnapshot('Refreshing stale snapshot…');
  }
});

updateModeUI();
updateFocusCard();
fetchSnapshot('Loading shared weather snapshot…');
