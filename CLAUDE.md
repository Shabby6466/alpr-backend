# ALPR API — AI Context

NestJS REST API that wraps the ROC SDK native Node.js addon to perform Automatic License Plate Recognition (ALPR). Persists detection events, persons, watchlist entries, and alerts to SQLite via TypeORM.

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
DYLD_LIBRARY_PATH=/Volumes/ROCSDK/lib nest start --watch
# All npm scripts already prepend DYLD_LIBRARY_PATH — so just:
npm run start:dev
```

The `DYLD_LIBRARY_PATH` prefix is **mandatory** on macOS so that `roc.node` can find `libroc.3.14.dylib` at runtime. Without it the process crashes immediately with `dlopen` errors.

## Environment (.env)

```
ROC_MODEL_PATH=/Volumes/ROCSDK/lib   # directory containing *.rmodel files
ROC_LIC=/Users/Akmal/Downloads/Lic-files/ROC-RC-MACOS.lic
PORT=3000
API_PREFIX=api
MAX_FILE_SIZE_MB=20
```

## ROC SDK — Critical Details

- **Addon file**: `roc.node` lives at the project root (not inside `src/`). It was copied from `/Volumes/ROCSDK/nodejs/roc.node` and patched: `install_name_tool -add_rpath /Volumes/ROCSDK/lib roc.node` then re-signed with `codesign --sign - --force roc.node`. Without the rpath patch it cannot find the dylib.
- **Load path**: always `require(path.resolve(process.cwd(), 'roc.node'))`. Using `__dirname` breaks in compiled code because `dist/src/roc/` is not the project root.
- **No `roc_read_image_buffer`**: the SDK only exposes `roc_read_image(filePath, colorSpace)`. To process a `Buffer`, write it to a temp file in `os.tmpdir()`, call `roc_read_image`, then delete the file in `finally`.
- **Lifecycle**: `roc_initialize(null)` and `roc_set_model_path(modelPath)` are called in `onModuleInit`. `roc_finalize()` is called in `onModuleDestroy`.
- **Video/Streams**: `roc_open_video(filePathOrUrl, colorSpace)` → loop `roc_read_frame(video)` until it returns falsy. Same temp-file pattern for uploads, but supports direct URLs (RTSP/HTTP) for live feeds. The temp file is written with the **original file extension** (e.g. `.mov`) so the SDK picks the right FFmpeg demuxer.
- **`roc_video` plugin**: The SDK lazy-loads `libroc_video` via `dlopen("roc_video", ...)` using a bare name (no `lib` prefix, no `.dylib`). Because `/Volumes/ROCSDK` is a read-only DMG, a symlink `lib/roc_video → /Volumes/ROCSDK/lib/libroc_video.dylib` lives in the project root `lib/` directory, and `DYLD_LIBRARY_PATH` includes `./lib` so dlopen finds it.
- **Frame skipping**: configurable via `frameStep` param (default 15 for files, 5 for live streams).
- **Quality Tuning**: Default `minQuality` lowered to **0.2** for better detection on mobile/grainy video feeds.
- **Stream Robustness**:
  - **Timestamp Fix**: Network streams (RTSP/HTTP) automatically have `?system_timestamps=true` appended to avoid RTCP sender report errors.
  - **Frame Validation**: Frames are validated for pixel data (`frame.data`) before processing; "Null image data" errors are caught and skipped to prevent stream interruption.
- **roc-serve is NOT used**. The `ROC-RC-MACOS.lic` license type forces roc-serve into floating-license-server mode — it cannot process detection requests. All detection goes through the native addon directly.

## Project Structure

```
alpr-api/
├── roc.node                        # Native addon — project root
├── data/alpr.sqlite                # SQLite database (auto-created)
├── .env
├── src/
│   ├── main.ts                     # Bootstrap; dotenv loaded here before NestFactory
│   ├── app.module.ts               # Root module — TypeORM config lives here
│   ├── config/
│   │   └── configuration.ts        # Typed config factory (port, roc.modelPath, upload.maxFileSizeMb)
│   ├── common/
│   │   └── plate.util.ts           # normalizePlate(): uppercase + strip spaces/hyphens
│   ├── roc/
│   │   └── roc.service.ts          # SDK wrapper — detectLicensePlates(), detectVideoFrames(), ping()
│   ├── alpr/
│   │   ├── alpr.service.ts         # Orchestration: detect → enrich → log → alert → SSE
│   │   ├── alpr.controller.ts      # POST /api/alpr/detect, detect-url, detect-video; GET /health
│   │   └── dto/
│   │       ├── detect-plate.dto.ts
│   │       └── plate-result.dto.ts
│   ├── events/
│   │   ├── detection-event.entity.ts
│   │   ├── events.service.ts       # create(), findAll() with filters + pagination, findByPerson(), delete()
│   │   └── events.controller.ts    # GET /api/events, SSE /api/events/stream, DELETE /:id
│   ├── persons/
│   │   ├── person.entity.ts
│   │   ├── persons.service.ts      # findByPlate() uses LIKE '%"<plate>"%' on JSON column
│   │   └── persons.controller.ts   # CRUD; GET /:id returns person + visits array
│   ├── watchlist/
│   │   ├── watchlist.entity.ts
│   │   ├── alert.entity.ts
│   │   ├── watchlist.service.ts    # checkAndAlert(), getAlerts(), acknowledgeAlert()
│   │   └── watchlist.controller.ts # WatchlistController + AlertsController in same file
│   └── notifications/
│       └── notifications.service.ts # Two RxJS Subjects — events$ and alerts$ — for SSE broadcast
```

## API Endpoints

### ALPR (`/api/alpr`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/detect` | Upload image (multipart `image` field), returns `AlprResultDto` |
| `POST` | `/detect-url` | JSON body `{ imageUrl, region, ... }`, fetches and detects |
| `POST` | `/detect-video` | Upload video (multipart `video` field), streams SSE frames |
| `POST` | `/detect-stream` | JSON body `{ url, region, ... }`, streams live feed SSE frames |
| `GET` | `/health` | `{ status, rocInitialized, modelPath }` |

Query params for detection: `region` (`NORTH_AMERICAN` \| `EUROPEAN` \| `PACIFIC`), `maxPlates`, `minQuality`, `relativeMinSize`, `thumbnail`, `ignorePartial`.

### Events (`/api/events`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Paginated list — query: `plate`, `personId`, `source`, `startDate`, `endDate`, `limit`, `offset` |
| `GET` | `/stream` | SSE — emits `detection` events in real time |
| `DELETE` | `/:id` | Delete a single event |

### Persons (`/api/persons`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | All persons |
| `POST` | `/` | Create — body: `{ name, plateNumbers: string[], notes? }` |
| `GET` | `/:id` | Person + `visits` array (matching detection events) |
| `PUT` | `/:id` | Update |
| `DELETE` | `/:id` | Delete |

### Watchlist (`/api/watchlist`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | All entries — query: `activeOnly=true` |
| `POST` | `/` | Create — body: `{ plateText, reason? }` |
| `PATCH` | `/:id` | Update — body: `{ active?, reason? }` |
| `DELETE` | `/:id` | Delete |

### Alerts (`/api/alerts`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | All alerts — query: `acknowledged=false` |
| `PATCH` | `/:id/acknowledge` | Mark acknowledged |
| `DELETE` | `/:id` | Delete |
| `GET` | `/stream` | SSE — emits `alert` events in real time |

## Database Schema

**`detection_events`** — every ALPR detection. Indexed on `plateText` and `timestamp`.

**`persons`** — registered persons. `plateNumbers` is stored as a JSON array (TypeORM `simple-json`). Plate lookup uses `LIKE '%"<plate>"%'` — the quotes are intentional to avoid partial matches inside the JSON string.

**`watchlist`** — flagged plates. `plateText` is unique. `active` bool controls whether alerts fire.

**`alerts`** — fired when a watchlist plate is detected. `acknowledged` defaults to false. References `watchlistEntryId` and `detectionEventId` (not FK-constrained — SQLite/TypeORM simple columns).

TypeORM `synchronize: true` is on — schema migrations happen automatically on startup.

## Detection Pipeline

```
POST /alpr/detect
  → RocService.detectLicensePlates()   # write buffer → tmp file → roc_read_image → roc_represent_lpr_ex
  → AlprService.enrichPlates()         # for each plate: PersonsService.findByPlate() → attach personId/personName
  → AlprService.logAndAlert()          # per plate:
      EventsService.create()           # INSERT detection_event
      NotificationsService.emitEvent() # push to events$ Subject → SSE /events/stream
      WatchlistService.checkAndAlert() # if active watchlist entry exists:
          Alert INSERT
          NotificationsService.emitAlert() # push to alerts$ Subject → SSE /alerts/stream
```

## Plate Normalization

`normalizePlate()` in `src/common/plate.util.ts`: `toUpperCase().replace(/[\s\-_]/g, '')`. Applied before all DB writes and lookups. The watchlist `plateText` column stores normalized values; `findByPlate` normalizes the input before querying.

## SSE Architecture

`NotificationsService` holds two `Subject<SseMessage>` instances. Controllers pipe them through RxJS `map` to produce `MessageEvent` objects. The frontend connects with `EventSource` and listens for `detection` and `alert` event types.

## Known Constraints

- ROC SDK volume (`/Volumes/ROCSDK`) must be mounted before starting the server — `onModuleInit` will throw if the model path is unreachable.
- `DYLD_LIBRARY_PATH` must be set in the shell; it cannot be set from inside Node.js after the process starts.
- SQLite `better-sqlite3` is synchronous — TypeORM wraps it in async APIs but there is no connection pool. Concurrent heavy video jobs can stall.
- Video detection processes every 15th frame by default. For high-frame-rate footage, tune `frameStep`.
- Max video upload size is **1GB**.
