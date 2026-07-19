# SimpleFit

A GitHub Pages rebuild of SimpleFit.org: static content plus an offline-friendly PWA workout companion.

## Features

- Static content pages for workouts, nutrition, community, FAQ
- Installable PWA via `manifest.webmanifest` and `service-worker.js`
- Beginner SimpleFit workout runner
- AMRAP countdown and stopwatch modes
- Workout history stored locally in IndexedDB
- JSON export/import for user-owned data

## Local preview

```bash
python3 -m http.server 8123
```

Open <http://127.0.0.1:8123/>.

## GitHub Pages

Set Pages to deploy from the `main` branch root, or use Actions later if a build step is introduced.

Custom domain is configured with `CNAME` = `simplefit.org`.
