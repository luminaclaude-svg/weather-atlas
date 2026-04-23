# Weather Atlas

A lightweight OpenStreetMap weather map with a small backend that serves a paced, shared weather snapshot.

## What it does
- Uses OpenStreetMap tiles as the base map.
- Calls a tiny `/api/field` backend that builds one global snapshot on a fixed cadence instead of sampling the current viewport on every pan/zoom.
- Renders temperature, wind, rain, and cloud overlays from structured weather data instead of draping a static image over the map.
- Lets you search locations via Nominatim and jump around the globe.

## Architecture
- **Frontend:** plain HTML/CSS/JS + Leaflet.
- **Backend:** Vercel serverless function at `api/field.js`.
- **Weather source:** Open-Meteo batch current-weather queries over a fixed global grid.
- **Pacing model:** shared 15-minute snapshot with CDN caching, so interaction stays smooth without hammering upstream providers.

## Run locally

```bash
cd weather-atlas
vercel dev
```

Then open the local URL Vercel prints.

## Notes
- Pan and zoom only change rendering and center sampling on the client; they do not trigger new upstream weather fetches.
- The backend returns one real sampled global grid per refresh cycle, with cache headers aligned to the snapshot cadence.
- Wind uses the same sampled grid plus direction vectors.
- Search uses the public Nominatim endpoint.
