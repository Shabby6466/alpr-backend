export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  apiPrefix: process.env.API_PREFIX || 'api',
  roc: {
    modelPath: process.env.ROC_MODEL_PATH || '/Volumes/ROCSDK/lib',
  },
  upload: {
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 20,
  },
  auth: {
    // Comma-separated list of valid API keys. Empty = auth disabled.
    apiKeys: (process.env.API_KEYS ?? '').split(',').map(k => k.trim()).filter(Boolean),
  },
  retention: {
    // Days to keep detection/face/alert records. 0 = keep forever.
    days: parseInt(process.env.RETENTION_DAYS, 10) || 90,
  },
  features: {
    // Enable roc_represent_object_ex for vehicle/gun detection.
    // Disable if your roc.node segfaults on object params.
    objectDetection: process.env.ENABLE_OBJECT_DETECTION !== 'false',
    gunDetection: process.env.ENABLE_GUN_DETECTION === 'true',
    // Write face detection events to the face_events table.
    persistFaceEvents: process.env.PERSIST_FACE_EVENTS !== 'false',
  },
});
