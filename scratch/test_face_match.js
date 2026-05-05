/**
 * Face match end-to-end test.
 *
 * Usage (from alpr-api/ root):
 *   ROC_LIC=/Users/Akmal/Downloads/Lic-files/ROC-RC-MACOS.lic \
 *   DYLD_LIBRARY_PATH=./lib:/Volumes/ROCSDK/lib \
 *   node scratch/test_face_match.js <path-to-image>
 *
 * What it tests:
 *   1. roc_represent_face returns a valid template with non-empty fv
 *   2. roc_enroll with native template + person_id = '{uuid}' succeeds
 *   3. roc_enroll with { fv, person_id } (gallery-sync path) succeeds
 *   4. roc_search_persons finds the enrolled face and returns the correct person_id
 *   5. Similarity is above the 0.5 threshold used by runFace()
 */

const path = require('path');
const fs   = require('fs');

// Load .env from alpr-api root so ROC_LIC is set before roc_initialize
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const roc = require(path.resolve(process.cwd(), 'roc.node'));

const imagePath = process.argv[2] || '/Users/Akmal/Desktop/test/2.png';
if (!fs.existsSync(imagePath)) {
  console.error('File not found:', imagePath);
  process.exit(1);
}

const TEST_PERSON_ID = 'e9c9a9ba-4bb4-47be-9caa-3b8f8e48eae4';
const SIMILARITY_THRESHOLD = 0.5;

function pass(msg) { console.log('  ✓', msg); }
function fail(msg) { console.error('  ✗', msg); }
function info(msg) { console.log('   ', msg); }

(async () => {
  console.log('\n=== ROC Face Match Test ===\n');

  // Init
  roc.roc_initialize(null);
  roc.roc_set_model_path('/Volumes/ROCSDK/lib');
  info(`Model path: /Volumes/ROCSDK/lib`);
  info(`Image:      ${imagePath}`);
  info(`Person ID:  ${TEST_PERSON_ID}\n`);

  // ── Step 1: Represent face ──────────────────────────────────────────────
  console.log('Step 1: roc_represent_face');
  const image = await roc.roc_read_image(imagePath, roc.ROC_BGR24);
  info(`Image size: ${image.width}x${image.height}`);

  const adaptiveMinSize = roc.roc_adaptive_minimum_size(
    image.width, image.height,
    roc.ROC_SUGGESTED_RELATIVE_MIN_SIZE,
    roc.ROC_SUGGESTED_ABSOLUTE_MIN_SIZE,
  );

  const templates = await roc.roc_represent_face(
    image,
    roc.ROC_FACE_DETECTION | roc.ROC_FACE_ACCURATE_REPRESENTATION | roc.ROC_FACE_THUMBNAIL,
    adaptiveMinSize,
    1,    // max faces
    1.0,  // false detection rate
    0.0,  // min quality
  );

  if (templates.length === 0) {
    fail('No face detected in image — cannot continue');
    roc.roc_finalize();
    process.exit(1);
  }
  pass(`Detected ${templates.length} face(s)`);

  const t = templates[0];
  info(`fv type:    ${t.fv?.constructor?.name}`);
  info(`fv length:  ${t.fv?.length ?? 'undefined'}`);
  info(`tn length:  ${t.tn?.length ?? 'undefined'}`);
  info(`person_id:  ${JSON.stringify(t.person_id)}`);
  info(`detection:  ${JSON.stringify(t.detection)}`);

  if (!t.fv || t.fv.length === 0) {
    fail('fv (feature vector) is empty — face template has no data');
    roc.roc_finalize();
    process.exit(1);
  }
  pass(`fv has ${t.fv.length} bytes`);

  // ── Step 2: Enroll with native template (controller path) ───────────────
  console.log('\nStep 2: roc_enroll — native template path (controller)');
  const gallery1 = await roc.roc_open_gallery(null);
  const nativeTemplate = templates[0]; // fresh reference
  nativeTemplate.person_id = `{${TEST_PERSON_ID}}`;
  info(`Setting person_id = ${nativeTemplate.person_id}`);
  try {
    await roc.roc_enroll(gallery1, nativeTemplate);
    pass('roc_enroll with native template succeeded');
  } catch (err) {
    fail(`roc_enroll failed: ${err.message}`);
    roc.roc_finalize();
    process.exit(1);
  }

  // ── Step 3: Search gallery1 with the same image ─────────────────────────
  console.log('\nStep 3: roc_search_persons — gallery1 (native enroll)');
  const probeTemplates = await roc.roc_represent_face(
    image,
    roc.ROC_FACE_DETECTION | roc.ROC_FACE_ACCURATE_REPRESENTATION,
    adaptiveMinSize, 1, 1.0, 0.0,
  );

  if (probeTemplates.length === 0) {
    fail('No face in probe — cannot search');
  } else {
    const results = await roc.roc_search_persons(gallery1, probeTemplates, 5, 0.0, true, false);
    info(`Results type: ${Array.isArray(results) ? 'array' : typeof results}, length: ${results?.length}`);
    info(`results[0] type: ${Array.isArray(results?.[0]) ? 'array' : typeof results?.[0]}`);
    // roc_search_persons returns a flat array of candidates (not array-of-arrays)
    const candidates = Array.isArray(results) ? results : [];
    info(`Candidates returned: ${candidates.length}`);

    if (candidates.length === 0) {
      fail('roc_search_persons returned 0 candidates — gallery may be empty after enroll');
    } else {
      const best = candidates[0];
      const returnedId = roc.roc_uuid_to_string(best.person_id, false);
      info(`Best match person_id: ${returnedId}`);
      info(`Best match similarity: ${best.similarity.toFixed(4)}`);

      if (returnedId === TEST_PERSON_ID) {
        pass(`Person ID matches correctly`);
      } else {
        fail(`Person ID mismatch — got "${returnedId}", expected "${TEST_PERSON_ID}"`);
      }

      if (best.similarity >= SIMILARITY_THRESHOLD) {
        pass(`Similarity ${best.similarity.toFixed(4)} ≥ threshold ${SIMILARITY_THRESHOLD}`);
      } else {
        fail(`Similarity ${best.similarity.toFixed(4)} < threshold ${SIMILARITY_THRESHOLD} — would show "Unknown Face"`);
        info('Consider lowering SIMILARITY_THRESHOLD in runFace() from 0.5');
      }
    }
  }

  // ── Step 4: Enroll via fv-only path (syncGallery path) ──────────────────
  console.log('\nStep 4: roc_enroll — fv-only path (syncGallery)');
  const gallery2 = await roc.roc_open_gallery(null);
  const fvBuffer = Buffer.from(t.fv);
  info(`Stored fv size: ${fvBuffer.length} bytes`);
  try {
    const minimal = { fv: new Uint8Array(fvBuffer), person_id: `{${TEST_PERSON_ID}}` };
    await roc.roc_enroll(gallery2, minimal);
    pass('roc_enroll with { fv, person_id } succeeded');
  } catch (err) {
    fail(`roc_enroll (fv-only) failed: ${err.message}`);
    roc.roc_finalize();
    process.exit(1);
  }

  // ── Step 5: Search gallery2 ──────────────────────────────────────────────
  console.log('\nStep 5: roc_search_persons — gallery2 (fv-only enroll)');
  const results2 = await roc.roc_search_persons(gallery2, probeTemplates, 5, 0.0, true, false);
  const candidates2 = Array.isArray(results2) ? results2 : [];
  info(`Candidates returned: ${candidates2.length}`);

  if (candidates2.length === 0) {
    fail('roc_search_persons returned 0 candidates from fv-only gallery');
  } else {
    const best2 = candidates2[0];
    const returnedId2 = roc.roc_uuid_to_string(best2.person_id, false);
    info(`Best match person_id: ${returnedId2}`);
    info(`Best match similarity: ${best2.similarity.toFixed(4)}`);

    if (returnedId2 === TEST_PERSON_ID) {
      pass('Person ID matches (fv-only path)');
    } else {
      fail(`Person ID mismatch — got "${returnedId2}"`);
    }

    if (best2.similarity >= SIMILARITY_THRESHOLD) {
      pass(`Similarity ${best2.similarity.toFixed(4)} ≥ threshold ${SIMILARITY_THRESHOLD} (fv-only path)`);
    } else {
      fail(`Similarity ${best2.similarity.toFixed(4)} < threshold ${SIMILARITY_THRESHOLD} (fv-only path)`);
    }
  }

  console.log('\n=== Done ===\n');
  roc.roc_finalize();
})().catch(err => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
