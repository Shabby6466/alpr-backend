export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  apiPrefix: process.env.API_PREFIX || 'api',
  roc: {
    modelPath: process.env.ROC_MODEL_PATH || '/Volumes/ROCSDK/lib',
  },
  upload: {
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 20,
  },
});
