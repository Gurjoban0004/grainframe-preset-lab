// bridge.js — Main-thread Promise wrapper around the pipeline Web Worker
// No framework imports.

/**
 * Create a managed pipeline worker instance.
 * Sends a warmup message immediately to force JIT compilation.
 * @returns {{ process: Function, terminate: Function }}
 */
export function createPipelineWorker() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let pending = null;

  worker.onmessage = function (event) {
    // Silently ignore warmup-done messages
    if (event.data?.type === 'warmup-done') return;
    if (!pending) return;
    const { resolve, reject } = pending;
    pending = null;
    if (event.data.error) {
      reject(new Error(event.data.error));
    } else {
      resolve(event.data.imageData);
    }
  };

  worker.onerror = function (err) {
    if (!pending) return;
    const { reject } = pending;
    pending = null;
    reject(new Error(err.message || 'Worker error'));
  };

  // Trigger warmup immediately — forces module parse + LUT pre-bake
  worker.postMessage({ type: 'warmup' });

  return {
    /**
     * Process an ImageData through the pipeline.
     * @param {ImageData} imageData
     * @param {object}    preset
     * @param {string}    [mode='preview']
     * @param {object}    [options]  { previewWidth, exportWidth }
     * @returns {Promise<ImageData>}
     */
    process(imageData, preset, mode = 'preview', options = {}) {
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        worker.postMessage(
          { imageData, preset, mode, ...options },
          [imageData.data.buffer]
        );
      });
    },

    /** Terminate the worker and release resources. */
    terminate() {
      worker.terminate();
      if (pending) {
        pending.reject(new Error('Worker terminated'));
        pending = null;
      }
    },
  };
}
