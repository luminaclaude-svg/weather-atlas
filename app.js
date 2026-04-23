const map = L.map('map', {
  zoomControl: false,
  attributionControl: true,
  worldCopyJump: true,
  preferCanvas: true,
}).setView([24, 7], 3);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const canvas = document.getElementById('weather-canvas');
const ctx = canvas.getContext('2d');
const statusPill = document.getElementById('status-pill');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const locateBtn = document.getElementById('locate-btn');
const refreshBtn = document.getElementById('refresh-btn');
const intensityInput = document.getElementById('intensity');
const layerControls = document.getElementById('layer-controls');

const heroTitle = document.getElementById('hero-title');
const heroCopy = document.getElementById('hero-copy');
const focusName = document.getElementById('focus-name');
const focusTime = document.getElementById('focus-time');
const focusTemp = document.getElementById('focus-temp');
const focusFeels = document.getElementById('focus-feels');
const focusWind = document.getElementById('focus-wind');
const focusCloud = document.getElementById('focus-cloud');
const legendTitle = document.getElementById('legend-title');
const legendUnit = document.getElementById('legend-unit');
const legendScale = document.getElementById('legend-scale');
const legendMin = document.getElementById('legend-min');
const legendMax = document.getElementById('legend-max');

const state = {
  layer: 'temperature',
  intensity: Number(intensityInput.value) / 100,
  points: [],
  focusLabel: 'Atlantic mood',
  lastFetchToken: 0,
  animT: 0,
  refreshTimer: null,
};

const layerCopy = {
  temperature: {
    title: 'Thermal bloom',
    body: 'Color fields glow warmer and cooler across the map while the base cartography stays readable beneath.',
    legendTitle: 'Temperature legend',
    legendUnit: '°C',
    legendMin: 'Cold',
    legendMax: 'Warm',
    legendClass: 'temp',
  },
  wind: {
    title: 'Wind ribbons',
    body: 'Each sample stretches into a flowing streak so you can feel the air moving across the terrain.',
    legendTitle: 'Wind speed legend',
    legendUnit: 'km/h',
    legendMin: 'Gentle',
    legendMax: 'Fast',
    legendClass: 'wind',
  },
  rain: {
    title: 'Rain pulse',
    body: 'Precipitation blooms in electric blues, turning wet pockets into little storms of light.',
    legendTitle: 'Precipitation legend',
    legendUnit: 'mm',
    legendMin: 'Dry',
    legendMax: 'Wet',
    legendClass: 'rain',
  },
  cloud: {
    title: 'Cloud veil',
    body: 'Cloud cover becomes a soft mist layer, hovering over the map like weather memory.',
    legendTitle: 'Cloud cover legend',
    legendUnit: '%',
    legendMin: 'Clear',
    legendMax: 'Overcast',
    legendClass: 'cloud',
  },
};

function resizeCanvas() {
  const rect = map.getContainer().getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(a, b, t) {
  const c1 = a.match(/\w\w/g).map((part) => parseInt(part, 16));
  const c2 = b.match(/\w\w/g).map((part) => parseInt(part, 16));
  const mixed = c1.map((value, index) => Math.round(lerp(value, c2[index], t)));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

function getColorForLayer(layer, value) {
  if (layer === 'temperature') {
    const stops = ['58b0ff', '7df9ff', '9cffb5', 'ffe56d', 'ff8159'];
    const norm = clamp((value + 10) / 45, 0, 1);
    const idx = Math.min(stops.length - 2, Math.floor(norm * (stops.length - 1)));
    const localT = (norm * (stops.length - 1)) - idx;
    return mixColor(stops[idx], stops[idx + 1], localT);
  }

  if (layer === 'wind') {
    return mixColor('76d2ff', 'ffffff', clamp(value / 70, 0, 1));
  }

  if (layer === 'rain') {
    return mixColor('b7d4ff', '5b43d6', clamp(value / 8, 0, 1));
  }

  return mixColor('d2dcff', 'ffffff', clamp(value / 100, 0, 1));
}

function getMetric(point) {
  const current = point.current;
  if (state.layer === 'temperature') return current.temperature_2m ?? 0;
  if (state.layer === 'wind') return current.wind_speed_10m ?? 0;
  if (state.layer === 'rain') return current.precipitation ?? 0;
  return current.cloud_cover ?? 0;
}

function getPointScreen(point) {
  return map.latLngToContainerPoint([point.latitude, point.longitude]);
}

function drawGlow(point, pulse) {
  const pos = getPointScreen(point);
  const metric = getMetric(point);
  const color = getColorForLayer(state.layer, metric);
  const radiusBase = state.layer === 'rain' ? 32 : state.layer === 'wind' ? 42 : 54;
  const radius = radiusBase + Math.sin(state.animT * 0.002 + pulse) * 4 + metric * 0.4;

  const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius * 1.8 * state.intensity);
  gradient.addColorStop(0, color.replace('rgb(', 'rgba(').replace(')', ', 0.32)'));
  gradient.addColorStop(0.45, color.replace('rgb(', 'rgba(').replace(')', ', 0.16)'));
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.beginPath();
  ctx.fillStyle = gradient;
  ctx.arc(pos.x, pos.y, radius * 1.8 * state.intensity, 0, Math.PI * 2);
  ctx.fill();

  if (state.layer === 'wind') {
    const angle = ((point.current.wind_direction_10m ?? 0) - 90) * (Math.PI / 180);
    const length = 24 + metric * 0.75;
    const tailX = pos.x + Math.cos(angle) * length;
    const tailY = pos.y + Math.sin(angle) * length;

    ctx.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.72)');
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.85)');
    ctx.arc(pos.x, pos.y, 2.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (state.layer === 'rain') {
    for (let i = 0; i < 3; i += 1) {
      const offset = (state.animT * 0.015 + pulse * 12 + i * 14) % 30;
      ctx.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.42)');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 12 + offset, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (state.layer === 'cloud') {
    ctx.beginPath();
    ctx.fillStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.12)');
    ctx.ellipse(pos.x, pos.y, radius * 1.2, radius * 0.7, Math.sin(pulse), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(236, 244, 255, 0.92)';
  ctx.font = '600 12px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(formatMetric(metric), pos.x, pos.y + 4);
}

function formatMetric(value) {
  if (state.layer === 'temperature') return `${Math.round(value)}°`;
  if (state.layer === 'wind') return `${Math.round(value)}`;
  if (state.layer === 'rain') return `${value.toFixed(value >= 1 ? 1 : 2)}`;
  return `${Math.round(value)}%`;
}

function renderOverlay() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  if (!state.points.length) return;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  state.points.forEach((point, index) => drawGlow(point, index * 0.8));
  ctx.restore();
}

function chooseGrid() {
  const bounds = map.getBounds();
  const width = map.getSize().x;
  const height = map.getSize().y;
  const cols = clamp(Math.round(width / 160), 4, 7);
  const rows = clamp(Math.round(height / 180), 3, 5);
  const latStep = (bounds.getNorth() - bounds.getSouth()) / (rows + 1);
  const lngStep = (bounds.getEast() - bounds.getWest()) / (cols + 1);
  const points = [];

  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      points.push({
        latitude: bounds.getNorth() - row * latStep,
        longitude: bounds.getWest() + col * lngStep,
      });
    }
  }

  return points;
}

function scheduleWeatherRefresh(delay = 160) {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    fetchWeather();
  }, delay);
}

async function fetchWeather() {
  const samplePoints = chooseGrid();
  const token = ++state.lastFetchToken;
  statusPill.textContent = 'Fetching atmosphere…';

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', samplePoints.map((point) => point.latitude.toFixed(4)).join(','));
  url.searchParams.set('longitude', samplePoints.map((point) => point.longitude.toFixed(4)).join(','));
  url.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,relative_humidity_2m'
  );
  url.searchParams.set('timezone', 'auto');

  try {
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Weather request failed (${response.status})`);

    const data = await response.json();
    if (token !== state.lastFetchToken) return;
    state.points = Array.isArray(data) ? data : [data];
    refreshFocusCard();
    statusPill.textContent = `Painted ${state.points.length} weather samples`;
    renderOverlay();
  } catch (error) {
    console.error(error);
    if (token === state.lastFetchToken) {
      statusPill.textContent = 'Weather fetch failed — try refresh';
    }
  }
}

function refreshFocusCard() {
  if (!state.points.length) return;

  const center = map.getCenter();
  let nearest = state.points[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  state.points.forEach((point) => {
    const distance = map.distance(center, [point.latitude, point.longitude]);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  });

  const current = nearest.current;
  focusName.textContent = state.focusLabel;
  focusTime.textContent = current.time.replace('T', ' ');
  focusTemp.textContent = `${Math.round(current.temperature_2m)} °C`;
  focusFeels.textContent = `${Math.round(current.apparent_temperature)} °C`;
  focusWind.textContent = `${Math.round(current.wind_speed_10m)} km/h`;
  focusCloud.textContent = `${Math.round(current.cloud_cover)} %`;
}

async function searchPlace(query) {
  statusPill.textContent = 'Searching map…';
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
  statusPill.textContent = `Centered on ${state.focusLabel}`;
}

function setLayer(layer) {
  state.layer = layer;
  const copy = layerCopy[layer];
  heroTitle.textContent = copy.title;
  heroCopy.textContent = copy.body;
  legendTitle.textContent = copy.legendTitle;
  legendUnit.textContent = copy.legendUnit;
  legendMin.textContent = copy.legendMin;
  legendMax.textContent = copy.legendMax;
  legendScale.className = `legend-scale ${copy.legendClass}`;

  layerControls.querySelectorAll('.chip').forEach((button) => {
    button.classList.toggle('active', button.dataset.layer === layer);
  });

  renderOverlay();
}

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  try {
    await searchPlace(query);
  } catch (error) {
    statusPill.textContent = error.message;
  }
});

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    statusPill.textContent = 'Geolocation not available in this browser';
    return;
  }

  statusPill.textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      state.focusLabel = 'Your location';
      map.flyTo([coords.latitude, coords.longitude], 8, { animate: true, duration: 1.4 });
    },
    () => {
      statusPill.textContent = 'Could not get your location';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

refreshBtn.addEventListener('click', () => {
  fetchWeather();
});

intensityInput.addEventListener('input', () => {
  state.intensity = Number(intensityInput.value) / 100;
  renderOverlay();
});

layerControls.addEventListener('click', (event) => {
  const button = event.target.closest('[data-layer]');
  if (!button) return;
  setLayer(button.dataset.layer);
});

window.addEventListener('resize', () => {
  resizeCanvas();
  renderOverlay();
});

map.on('resize', resizeCanvas);
map.on('move', renderOverlay);
map.on('moveend', () => {
  refreshFocusCard();
  scheduleWeatherRefresh();
});
map.on('zoomend', () => {
  refreshFocusCard();
  scheduleWeatherRefresh();
});

resizeCanvas();
setLayer(state.layer);
fetchWeather();

function animate(ts) {
  state.animT = ts;
  renderOverlay();
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
