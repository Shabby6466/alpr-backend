# ALPR API — Engineering Learnings & Notes

## Detection Quality Issues (and fixes applied)

### Problem: Ghosting (same plate logged 3–5× per vehicle pass)
Every processed frame was treated as a unique event. A car at 30fps with frameStep=15 generates one DB row every 2 seconds while in view.

**Fix applied** (`alpr.service.ts`):
- `PlateTracker` groups reads within a 5s idle window, commits one winner per vehicle pass
- 30-second cooldown (`recentlyLogged` map) suppresses re-logging if the same plate re-enters the frame

### Problem: Character confusion (LEF4869 vs LEF4849)
OCR misreads 1–2 characters when the plate is at an angle or partially blurred.

**Fix applied** (`src/common/plate-tracker.ts`):
- Levenshtein distance ≤ 2 groups readings of the same plate into one session
- Majority-vote picks the winner; ties broken by highest confidence
- Result: `LEF4849` (1 vote, 96%) loses to `LEF4869` (3 votes, 100%) → one correct DB row

### Problem: OCR hallucinations on distant/approaching plates (e.g. LYB4949 at 91%)
ROC reads garbage when the plate bounding box is only a few pixels wide.

**Fix applied** (`alpr.service.ts`):
- `MIN_PLATE_PX_WIDTH = 60` — plates narrower than 60px are dropped before enrichment
- Pakistani plate regex `^[A-Z]{2,4}\d{3,5}$` (`plate.util.ts`) rejects impossible strings

**Net result on a 7-second vehicle pass**: 5 DB rows → 1 DB row (best confidence, correct text).

---

## Face Detection in Video — Current State

- Combined face + plate detection runs per frame via `roc_represent_face` + `roc_represent_lpr_ex` in parallel.
- Face results are yielded in the SSE frame payload (`faces[]`) — visible to the frontend in real-time.
- **Faces are NOT persisted to the database.** Only plates create `detection_events` rows.
- Face matching requires enrolled persons in the in-memory gallery (`POST /api/persons` with a face photo). Without enrolled persons, `personId` is always `null`.
- Night/mobile video: `ROC_FACE_ACCURATE_SUGGESTED_MIN_QUALITY` drops faces below threshold. Low frameStep (15) means a driver looking at the camera for <300ms may land entirely in skipped frames.

---

## ROC SDK — Node.js Addon Capability Map

Probed via `roc.node` directly. Key findings:

### Available and working
| Function / Flag | Notes |
|---|---|
| `roc_represent_lpr_ex` | Main LPR — stable, well-tested |
| `roc_represent_face` | Face detection + representation |
| `roc_represent_face_ex` | Newer face API accepting a params struct |
| `roc_represent_object_ex` | Vehicle / person / gun / tattoo detection |
| `ROC_VEHICLE_DETECTION` = 32768 | Detects vehicles per frame |
| `ROC_PERSON_DETECTION` = 524288 | Detects pedestrians |
| `ROC_ALL_OBJECT_DETECTION` = 622592 | All object classes combined |
| `ROC_OBJECT_FAST_DETECTION` = 536870912 | Faster, lower-accuracy object pass |
| `roc_roi_from_detection` | Converts a detection bbox → `{x,y,width,height}` ROI. Works. |
| `roc_tracker_algorithm_parameters_for_*` | Returns default config structs (NOT the tracker itself) |
| `roc_open_video` / `roc_read_frame` | Frame-by-frame video decode — stable |

### Default tracker parameters (for reference when tuning)
```json
// roc_tracker_algorithm_parameters_for_license_plate_recognition()
{
  "min_count": 2,                 // minimum votes before committing
  "max_time_separation": 3000,    // ms — session window
  "min_similarity": 0.75,         // plate text similarity threshold
  "text_filter": "^[0-9A-Z]{2,8}$",
  "multimodal_tracking": true     // face+plate jointly tracked
}

// roc_tracker_algorithm_parameters_for_vehicle_detection()
{
  "min_count": 2,
  "max_time_separation": 5000,
  "max_detection_distance": 1,
  "min_similarity": 0.30
}

// roc_tracker_algorithm_parameters_for_face_recognition()
{
  "min_count": 2,
  "max_time_separation": 5000,
  "tracking_time_separation": 1500,
  "min_similarity": 0.45
}
```

### NOT exposed in the Node.js addon (in .h but not in roc.node)
| Missing function | Impact |
|---|---|
| `roc_new_tracker` | Can't use the native SORT-style tracker |
| `roc_tracker_add_image` | Can't feed frames to native tracker |
| `roc_tracker_take_event` | Can't receive native tracker events |
| `roc_tracker_set_rois` | Can't set per-track ROI constraints natively |
| `roc_video_service_*` (beyond `roc_new_video_service`) | Exposed but segfaults — unusable |

**Consequence**: All tracking, deduplication, and ROI logic must be implemented in application code (TypeScript). The `PlateTracker` in `src/common/plate-tracker.ts` is our substitute for the native tracker.

### Helmet / occlusion detection
- No helmet detection model or algorithm flag exists in the SDK.
- `ROC_ALL_OBJECT_DETECTION` covers: vehicles, persons, guns, tattoos — no helmet class.
- **Workaround**: Face quality score drops sharply when the golden triangle (eyes-nose-mouth) is hidden. A face with `quality < 0.1` after detection can be flagged `occluded: true` rather than discarded silently.

---

## Motorcycle / Two-Wheeler Roadmap

Three architectural challenges vs cars, and their feasibility given the SDK constraints:

### 1. Adaptive frameStep
**Problem**: Motorcycles move faster and more erratically. At frameStep=15 (30fps → 2fps effective) a rider glancing at the camera for 200ms is likely missed entirely.

**Solution (buildable now)**:
- Default frameStep for video files: lower from 15 → 5
- In-loop state: when a vehicle is detected in the current frame, set `localSkip = 2` (every 3rd frame) for the next 30 frames. When no vehicles → `localSkip = 15`.
- No SDK tracker required — pure loop state.

### 2. Vehicle-first gating
**Problem**: Running full LPR + face on every frame is wasteful on empty-road segments.

**Solution (buildable now — `roc_represent_object_ex` is available)**:
```
per frame:
  1. roc_represent_object_ex(frame, ROC_VEHICLE_DETECTION | ROC_OBJECT_FAST_DETECTION)
  2. if vehicles.length == 0 → skip LPR + face entirely
  3. else → run LPR + face as normal
```
Estimated savings: 60–80% of CPU on a low-traffic feed.

### 3. Dynamic ROI for face search
**Problem**: For cars, faces are always in the windshield band (top 25% of frame). For bikes, rider height varies. Scanning the whole frame wastes CPU and generates false positives.

**Theory**: `roc_roi_from_detection` converts a vehicle bbox to an ROI. `roc_represent_face_ex` accepts a params struct that likely includes ROI constraints. Feed the vehicle bbox top-30% as the face search zone.

**Status**: Partially validated. `roc_roi_from_detection` works. `roc_represent_face_ex` is exposed but the params struct binding is untested — calling `roc_represent_object_ex` with real image data segfaulted during probing. **Needs careful integration before shipping.**

### 4. Plate size and angle on motorcycles
**Problem**: Motorcycle plates in Pakistan are smaller, mounted at steeper angles, and sometimes hand-painted. `frameStep` needs to be lower during the bike's approach.

**Solution**: Same as adaptive frameStep above. Additionally:
- `MIN_PLATE_PX_WIDTH = 60` already filters out distant plates
- The LPR tracker's `min_similarity = 0.75` (from default params) is the reference for how aggressively to vote — our `PlateTracker` uses edit distance ≤ 2 which is roughly equivalent

### 5. Helmet occlusion flag (soft signal)
**Problem**: Full-face helmets make facial recognition impossible. Open-face helmets degrade quality.

**Solution (buildable now)**:
After `roc_represent_face`, check `template.quality`. If below a threshold (e.g. 0.05), yield the face detection but attach `occluded: true` to the face result. Useful for the UI to show "face detected but unreadable" rather than nothing.

---

## Immediate Improvements (not yet implemented)

In priority order:

1. **Lower default frameStep to 5** — one-line change in `roc.service.ts`
2. **Vehicle-first gating** — add `roc_represent_object_ex` fast pass before LPR/face
3. **Adaptive frameStep** — loop state variable, no SDK changes
4. **Helmet/occlusion soft flag** — quality threshold check in `enrichFaces`
5. **Persist face events to DB** — `face_events` entity or a `modality` column on `detection_events`
6. **ROI-constrained face search** — requires validating `roc_represent_face_ex` params struct binding first
