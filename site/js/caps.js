// Layer 0. Feature probes. detectCaps() is cheap and synchronous; webglUsable() creates a throwaway context, so it is
// only called by code that needs the answer. S1 wires neither into the boot path (behaviour-preserving split); the
// fallback work builds on them.

/** @returns {{importmap: boolean, coarsePointer: boolean, xrApi: boolean}} */
export function detectCaps() {
  return {
    importmap: typeof HTMLScriptElement !== 'undefined' && !!HTMLScriptElement.supports?.('importmap'),
    coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    xrApi: typeof navigator !== 'undefined' && 'xr' in navigator,
  };
}

let webgl;
/** WebGL2 (then WebGL1) on a throwaway canvas; failIfMajorPerformanceCaveat stays false so software GL counts as usable. */
export function webglUsable() {
  if (webgl !== undefined) return webgl;
  try {
    const mk = () => document.createElement('canvas');
    webgl = !!(mk().getContext('webgl2') || mk().getContext('webgl'));
  } catch { webgl = false; }
  return webgl;
}
