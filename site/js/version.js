// Layer 0. The build id of THIS code. It is 'dev' in the repository. tools/stamp_build.py (run by CI only, before the site is
// uploaded) rewrites the APP_BUILD line with the commit id and writes the same id to data/drugs.json as meta.app_build, so the
// page can tell when it was loaded with code from one deploy and data from another (GitHub Pages caches files for ten minutes).
// Keep the APP_BUILD line exactly in this form: the stamp script matches it.
export const APP_BUILD = 'dev';

/**
 * True when the page should offer a reload: the code has a real build id, the data names one too, and they differ. An
 * unstamped ('dev') build never does.
 * @param {string} codeBuild APP_BUILD  @param {unknown} dataBuild meta.app_build of the data file
 */
export function buildMismatch(codeBuild, dataBuild) {
  return typeof codeBuild === 'string' && codeBuild !== '' && codeBuild !== 'dev' && typeof dataBuild === 'string' && dataBuild !== '' && dataBuild !== codeBuild;
}
