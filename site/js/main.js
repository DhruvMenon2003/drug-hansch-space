// The only script index.html loads. It imports just caps and fallback statically; the app proper is imported
// dynamically so that a failure in one part (three.js, an import map) is reported instead of leaving a blank page.
import { detectCaps } from './caps.js';
import { showFatal } from './fallback.js';

async function main() {
  const caps = detectCaps();
  try {
    // start fetching the 3D half in parallel with the core; its modules do nothing until bootGl() is called
    const glModule = import('./boot-gl.js');
    glModule.catch(() => {});                    // reported below, where it is awaited
    const core = await import('./boot-core.js');
    await core.bootCore(caps);
    (await glModule).bootGl();
    core.startTour();
  } catch (err) {
    showFatal(err);
  }
}
main();
