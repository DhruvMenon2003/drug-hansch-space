// Layer 0. Feature probes. detectCaps() is cheap and synchronous; webglUsable() creates a throwaway context (and
// releases it at once), so it is only called by code that needs the answer. main.js calls detectCaps() first and
// decides from it whether the 3D layer is worth loading.

let webgl;
/** WebGL2 (then WebGL1) on a throwaway canvas; failIfMajorPerformanceCaveat stays false so software GL counts as usable. */
export function webglUsable() {
  if (webgl !== undefined) return webgl;
  try {
    const mk = () => document.createElement('canvas');
    const gl = mk().getContext('webgl2') || mk().getContext('webgl');
    webgl = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();   // give the probe's context back at once
  } catch { webgl = false; }
  return webgl;
}

/** @returns {{importmap: boolean, coarsePointer: boolean, xrApi: boolean, webgl: boolean}} */
export function detectCaps() {
  return {
    importmap: typeof HTMLScriptElement !== 'undefined' && !!HTMLScriptElement.supports?.('importmap'),
    coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    xrApi: typeof navigator !== 'undefined' && 'xr' in navigator,
    webgl: webglUsable(),
  };
}
