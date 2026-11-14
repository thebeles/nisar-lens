# Project status

- React 18 + Vite application with a Cesium 3D globe.
- The explorer uses a bundled ASF catalog snapshot and bundled SME2 soil-moisture points.
- Live catalog searches are proxied to NASA ASF through `/api/asf-search`.
- Protected NASA Earthdata assets are proxied through `/api/earthdata-asset`; set `EARTHDATA_TOKEN` in the server environment when access is required.
- Mission watchpoints are stored in browser `localStorage` under `nisar-lens-watchpoints-v1`.
- There is no external database or cloud file cache.

Start with `npm install` and `npm run dev`. Build with `npm run build`.
