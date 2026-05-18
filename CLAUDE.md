# ALPR API — AI Context

NestJS REST API that wraps the ROC SDK native Node.js addon to perform Automatic License Plate Recognition (ALPR). Persists detection events, persons, watchlist entries, alerts, face events, and cameras to SQLite via TypeORM.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | NestJS 10 |
| Language | TypeScript 5 |
| Database | SQLite via `better-sqlite3` + TypeORM 0.3 |
| SDK | ROC SDK 3.14.2 — native Node.js addon (`roc.node`) |
| Real-time | SSE via NestJS `@Sse()` + RxJS `Subject` |
| Validation | `class-validator` + `class-transformer` |
| Docs | Swagger UI at `/api/docs` |

## Running

```bash
# SDK volume must be mounted first — double-click the .dmg at /Volumes/ROCSDK
npm run start:dev   # DYLD_LIBRARY_PATH is prepended by the npm script
```

The `DYLD_LIBRARY_PATH` prefix is **mandatory** on macOS so that `roc.node` can find `libroc.3.14.dylib` at runtime. Without it the process crashes immediately with `dlopen` errors.

## Environment (.env)

```
PORT=3000
API_PREFIX=api
ROC_MODEL_PATH=/Volumes/ROCSDK/lib
ROC_LIC=/Users/Akmal/Downloads/Lic-files/ROC-RC-MACOS.lic
MAX_FILE_SIZE_MB=20
API_KEYS=                    # empty = auth disabled
RETENTION_DAYS=90
ENABLE_OBJECT_DETECTION=true
ENABLE_GUN_DETECTION=true
PERSIST_FACE_EVENTS=true
```

See `.env.example` for full documentation of every variable.

## ROC SDK — Critical Details

- **Addon file**: `roc.node` lives at the project root. Patched with `install_name_tool -add_rpath /Volumes/ROCSDK/lib roc.node` and re-signed with `codesign --sign - --force roc.node`.
- **Load path**: always `require(path.resolve(process.cwd(), 'roc.node'))`. Using `__dirname` breaks in compiled code.
- **No `roc_read_image_buffer`**: write buffer to `os.tmpdir()`, call `roc_read_image(tmpPath)`, delete in `finally`.
- **Lifecycle**: `roc_initialize(null)` + `roc_set_model_path()` in `onModuleInit`. `roc_finalize()` in `onModuleDestroy`.
- **Video/Streams**: `roc_open_video(filePathOrUrl)` → loop `roc_read_frame(video)` until `!frame || !frame.data`. Temp files use the **original extension** so FFmpeg picks the right demuxer.
- **`roc_video` plugin**: SDK lazy-loads it via `dlopen("roc_video", ...)`. A symlink `lib/roc_video → /Volumes/ROCSDK/lib/libroc_video.dylib` in the project root makes it findable.
- **Frame null guard**: `if (!frame || !frame.data) break` — end-of-stream sometimes returns a truthy frame with null pixel data; this prevents "Null image data!" crashes.
- **License capability probe**: at startup, `probeCapabilities()` runs a 1×1 JPEG through vehicle/gun detection to check what the license supports. Results cached in `vehicleDetectionSupported` / `gunDetectionSupported` flags — prevents per-frame error spam when a feature is unlicensed.
- **Face detection**: runs unconditionally on every frame (outside the vehicle-first gate) so pedestrians and motorcyclists aren't missed. Quality threshold `0.05` for surveillance sensitivity.
- **roc-serve is NOT used**. The `ROC-RC-MACOS.lic` license type forces roc-serve into floating-license-server mode.

## Detection Thresholds (defaults)

| Param | Default | Notes |
|-------|---------|-------|
| `minQuality` | `0.2` | LPR quality gate. Lower = more detections but more noise. Do not go below `0.1`. |
| `relativeMinSize` | `0.02` | Min plate width as fraction of image width. `0.01` causes 5× slower processing. |
| `ignorePartial` | `false` | `true` was dropping hood-occluded plates entirely. |
| `falseDetectionRate` | `0.1` | |
| `maxPlates` | `10` | |

## Pre-filter Gates (`passesPreFilters`)

Applied before tracker/session input and before DB write.

| Check | Threshold | Rationale |
|-------|-----------|-----------|
| Width | ≥ 40 px | 60px was rejecting plates at typical traffic distances (LEF4869 appeared at 53px) |
| Confidence | ≥ 0.65 | 0.75 was rejecting valid plates at angle/distance |
| Aspect ratio (w/h) | ≥ 1.1 | Blocks portrait badges/logos only. New-format Pakistani green plates are two-line stacked (~1.0–1.3 ratio); 1.5 was blocking them. Regex is the primary false-positive gate. |
| Pakistani regex | `^[A-Z]{2,4}\d{3,8}$` | Primary false-positive filter |

Debug-level logs emit the rejection reason + raw text for every skipped plate.

## Pakistani Plate Validation

`src/common/plate.util.ts` — `isValidPakistaniPlate(normalized)`:
- Regex: `^[A-Z]{2,4}\d{3,8}$`
- Covers old format (`ABC1234`) and new format (`ABC121234`, i.e. `ABC-12-1234` after stripping hyphens)
- Applied in `passesPreFilters()` before tracker/session input — see Pre-filter Gates table for all thresholds
- **For Pakistani plates use `NORTH_AMERICAN` region** — the `ASIAN` classifier is optimized for East Asian plates (Chinese/Japanese/Korean formats)

## Project Structure

```
alpr-api/
├── roc.node                          # Native addon — project root
├── data/alpr.sqlite                  # SQLite database (auto-created)
├── .env / .env.example
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/configuration.ts
│   ├── common/
│   │   ├── plate.util.ts             # normalizePlate() + isValidPakistaniPlate()
│   │   ├── plate-tracker.ts          # PlateTracker — for camera/stream SSE mode
│   │   └── vehicle-tracker.ts        # VehicleTracker — for video session mode
│   ├── roc/
│   │   └── roc.service.ts            # SDK wrapper
│   ├── alpr/
│   │   ├── alpr.service.ts           # Orchestration + video session management
│   │   ├── alpr.controller.ts
│   │   └── dto/
│   ├── cameras/                      # Camera entity + CRUD + CameraWorkerService
│   ├── events/                       # DetectionEvent entity + CRUD + SSE
│   ├── face-events/                  # FaceEvent entity + CRUD (controller added)
│   ├── persons/
│   ├── watchlist/
│   └── notifications/                # events$, alerts$, guns$ RxJS Subjects
```

## API Endpoints

### ALPR (`/api/alpr`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/detect` | Upload image (multipart `image`). Optional `?sessionId=` for video session tracking. |
| `POST` | `/detect-url` | JSON `{ imageUrl, region, ... }` |
| `POST` | `/detect-video` | Upload video (multipart `video`), streams SSE frames |
| `POST` | `/detect-stream` | JSON `{ url, region, ... }`, streams live feed SSE |
| `POST` | `/sessions/:sessionId/flush` | Commit one best event per tracked vehicle in a video session |
| `GET` | `/gun-alerts` | SSE stream of real-time gun detection alerts |
| `GET` | `/health` | `{ status, rocInitialized, modelPath, capabilities }` — no auth required |

`capabilities` in health response: `{ lpr, face, vehicle, gun }` booleans reflecting what the license supports.

Query params for `/detect`: `region`, `maxPlates`, `minQuality`, `relativeMinSize`, `thumbnail`, `ignorePartial`, `frameStep`, `sessionId`.

### Events (`/api/events`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Paginated — query: `plate`, `personId`, `source`, `startDate`, `endDate`, `limit`, `offset` |
| `GET` | `/stream` | SSE — emits `detection` events in real time |
| `DELETE` | `/:id` | Delete |

### Face Events (`/api/face-events`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Query: `personId`, `cameraId`, `spoofOnly`, `startDate`, `endDate`, `limit`, `offset` |
| `DELETE` | `/:id` | Delete |

### Persons, Watchlist, Alerts — unchanged from previous version.

### Cameras (`/api/cameras`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | All cameras with `streaming` status |
| `POST` | `/` | Create + start stream worker |
| `PUT` | `/:id` | Update (setting `active: false` stops the worker) |
| `DELETE` | `/:id` | Delete + stop worker |

## Tracking Architecture

Two separate trackers exist for different use cases:

### PlateTracker (`src/common/plate-tracker.ts`)
Used by **camera workers** and **live stream SSE** (`processCombinedFrame`).
- Matches by: OCR text similarity (Levenshtein ≤ 2) **OR** spatial proximity (centroid within 4× plate size)
- Winner: most observations, confidence as tiebreaker
- Commits after **8s idle**, requires **≥3 observations**
- Tracks centroid X for direction-of-travel (`left` / `right` / `stationary`)

### VehicleTracker (`src/common/vehicle-tracker.ts`)
Used by **video sessions** (client-side frame capture from the detect page).
- Matches by: **spatial proximity only** (centroid within 4× plate size) — text not used
- Winner: **largest bounding box** (= vehicle physically closest = sharpest OCR read)
- Commits after **8s idle**, requires **≥1 reading** (single clean frame is enough — prefilters already ensure quality)
- Sessions keyed by `sessionId` UUID, auto-expire after **2 minutes** idle

### Video Session Flow
1. Frontend generates UUID `sessionId` when analysis starts
2. Each frame POST includes `?sessionId=<uuid>`
3. Backend feeds plates into `VehicleTracker` per session — **no DB write yet**
4. On video end/stop, frontend calls `POST /api/alpr/sessions/:id/flush`
5. Server commits one event per vehicle track (best reading) → DB + watchlist + SSE
6. Result: one clean DB event per vehicle, always from the closest/clearest frame

## Detection Pipeline

### Image upload (no sessionId)
```
POST /alpr/detect
  → detectLicensePlates() + detectFaces() + detectObjectsFromBuffer()  [parallel]
  → enrichPlates() → logAndAlert() per plate → EventsService.create() + SSE + watchlist check
```

### Image upload (with sessionId — video tab)
```
POST /alpr/detect?sessionId=xxx
  → detect [same as above]
  → processIntoSession(): passesPreFilters() → VehicleTracker.observe()  [no DB write]
  → returns detection result for overlay display

POST /api/alpr/sessions/xxx/flush  (on video stop/end)
  → VehicleTracker.flushAll() → logAndAlert() per committed track → DB + SSE
```

### Camera / stream SSE
```
CameraWorkerService / detectLiveStream()
  → processVideoSource(): vehicle gate → LPR + vehicles + guns [if vehiclePresent]
                          face detection [always, unconditional]
  → processCombinedFrame(): PlateTracker.observe() → logCommitted() on idle sessions
```

## SSE Architecture

`NotificationsService` holds three `Subject<SseMessage>` instances:
- `events$` → `/api/events/stream` (`detection` events)
- `alerts$` → `/api/alerts/stream` (`alert` events)
- `guns$` → `/api/alpr/gun-alerts` (`gun` events)

## Known Constraints

- ROC SDK volume (`/Volumes/ROCSDK`) must be mounted before starting.
- `DYLD_LIBRARY_PATH` must be set in the shell before the process starts.
- SQLite `better-sqlite3` is synchronous — no connection pool; concurrent heavy video jobs can stall.
- `relativeMinSize: 0.01` causes 5–7× slower LPR (more scale pyramid levels). Keep at `0.02` minimum.
- Max video upload size is **1GB** (for server-side video SSE mode).
- Video session tracker lives in `AlprService` memory — restarting the server loses any unflushed sessions.
