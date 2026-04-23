const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const SNAPSHOT_CADENCE_MINUTES = 15;
const SNAPSHOT_BOUNDS = {
  north: 82,
  south: -82,
  west: -180,
  east: 180,
};
const SNAPSHOT_COLS = 24;
const SNAPSHOT_ROWS = 12;
const UPSTREAM_BATCH_SIZE = 180;
const CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'cloud_cover',
  'wind_speed_10m',
  'wind_direction_10m',
];

function buildAxis(start, end, count) {
  if (count <= 1) return [(start + end) / 2];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => start + index * step);
}

function computeStats(values) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  values.forEach((value) => {
    if (!Number.isFinite(value)) return;
    if (value < min) min = value;
    if (value > max) max = value;
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: null, max: null };
  }

  return {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
  };
}

function alignSnapshotTimes(now = new Date()) {
  const cadenceMs = SNAPSHOT_CADENCE_MINUTES * 60 * 1000;
  const currentTime = now.getTime();
  const bucketStart = Math.floor(currentTime / cadenceMs) * cadenceMs;
  const bucketEnd = bucketStart + cadenceMs;

  return {
    bucketStart: new Date(bucketStart),
    bucketEnd: new Date(bucketEnd),
  };
}

async function fetchSampleBatch(latitudes, longitudes) {
  const upstreamUrl = new URL(OPEN_METEO_URL);
  upstreamUrl.searchParams.set('latitude', latitudes.join(','));
  upstreamUrl.searchParams.set('longitude', longitudes.join(','));
  upstreamUrl.searchParams.set('current', CURRENT_FIELDS.join(','));
  upstreamUrl.searchParams.set('timezone', 'UTC');
  upstreamUrl.searchParams.set('wind_speed_unit', 'kmh');
  upstreamUrl.searchParams.set('precipitation_unit', 'mm');

  const upstreamResponse = await fetch(upstreamUrl, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!upstreamResponse.ok) {
    const text = await upstreamResponse.text();
    throw new Error(`Open-Meteo request failed (${upstreamResponse.status}): ${text.slice(0, 400)}`);
  }

  const upstreamJson = await upstreamResponse.json();
  return Array.isArray(upstreamJson) ? upstreamJson : [upstreamJson];
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const latitudes = buildAxis(SNAPSHOT_BOUNDS.north, SNAPSHOT_BOUNDS.south, SNAPSHOT_ROWS);
  const longitudes = buildAxis(SNAPSHOT_BOUNDS.west, SNAPSHOT_BOUNDS.east, SNAPSHOT_COLS);
  const requestLatitudes = [];
  const requestLongitudes = [];

  latitudes.forEach((lat) => {
    longitudes.forEach((lon) => {
      requestLatitudes.push(lat.toFixed(4));
      requestLongitudes.push(lon.toFixed(4));
    });
  });

  try {
    const samples = [];

    for (let index = 0; index < requestLatitudes.length; index += UPSTREAM_BATCH_SIZE) {
      const latitudeBatch = requestLatitudes.slice(index, index + UPSTREAM_BATCH_SIZE);
      const longitudeBatch = requestLongitudes.slice(index, index + UPSTREAM_BATCH_SIZE);
      const batchSamples = await fetchSampleBatch(latitudeBatch, longitudeBatch);
      samples.push(...batchSamples);
    }

    if (!samples.length) {
      return res.status(502).json({ error: 'Open-Meteo returned no samples' });
    }

    const temperature = [];
    const apparentTemperature = [];
    const precipitation = [];
    const cloudCover = [];
    const windSpeed = [];
    const windDirection = [];

    samples.forEach((sample) => {
      temperature.push(sample.current?.temperature_2m ?? null);
      apparentTemperature.push(sample.current?.apparent_temperature ?? null);
      precipitation.push(sample.current?.precipitation ?? null);
      cloudCover.push(sample.current?.cloud_cover ?? null);
      windSpeed.push(sample.current?.wind_speed_10m ?? null);
      windDirection.push(sample.current?.wind_direction_10m ?? null);
    });

    const units = samples[0].current_units || {};
    const { bucketStart, bucketEnd } = alignSnapshotTimes(new Date());

    res.setHeader(
      'Cache-Control',
      `public, s-maxage=${SNAPSHOT_CADENCE_MINUTES * 60}, stale-while-revalidate=86400`
    );

    return res.status(200).json({
      source: 'weather-atlas-snapshot-api',
      provider: 'Open-Meteo',
      mode: 'globalSnapshot',
      coverage: 'Global shared field snapshot',
      generatedAt: new Date().toISOString(),
      sampleTime: samples[0].current?.time ?? null,
      snapshotWindowStartedAt: bucketStart.toISOString(),
      nextRefreshAt: bucketEnd.toISOString(),
      cadenceMinutes: SNAPSHOT_CADENCE_MINUTES,
      bbox: SNAPSHOT_BOUNDS,
      rows: SNAPSHOT_ROWS,
      cols: SNAPSHOT_COLS,
      latitudes,
      longitudes,
      fields: {
        temperature,
        apparentTemperature,
        precipitation,
        cloudCover,
        windSpeed,
        windDirection,
      },
      stats: {
        temperature: computeStats(temperature),
        apparentTemperature: computeStats(apparentTemperature),
        precipitation: computeStats(precipitation),
        cloudCover: computeStats(cloudCover),
        windSpeed: computeStats(windSpeed),
      },
      units: {
        temperature: units.temperature_2m || '°C',
        apparentTemperature: units.apparent_temperature || '°C',
        precipitation: units.precipitation || 'mm',
        cloudCover: units.cloud_cover || '%',
        windSpeed: units.wind_speed_10m || 'km/h',
        windDirection: units.wind_direction_10m || '°',
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to build field snapshot',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
