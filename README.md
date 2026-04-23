# Weather Atlas

A lightweight OpenStreetMap + Open-Meteo prototype.

## What it does
- Uses OpenStreetMap tiles as the base map.
- Samples live weather points across the visible viewport with Open-Meteo.
- Paints stylish overlay modes for temperature, wind, rain, and cloud cover.
- Lets you search locations via Nominatim and jump around the map.

## Run locally

```bash
cd weather-atlas
python3 -m http.server 8123
```

Then open <http://localhost:8123>.

## Notes
- Weather data is sampled dynamically from the current map bounds, so panning and zooming repaints the field.
- Search uses the public Nominatim endpoint.
- No build step required.
