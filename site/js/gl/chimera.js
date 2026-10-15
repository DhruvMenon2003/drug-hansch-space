// Layer 3. ChimeraX-style finish for the molecule views: matte materials, soft fill light and a dark silhouette drawn by an
// inverted hull (each instance redrawn back-faces-only, pushed out along its normals), the look of ChimeraX's "lighting soft"
// with "graphics silhouettes true".
import * as THREE from 'three';

/** A matte, non-metallic material for atoms and bonds. */
export const matte = () => new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });

/** Soft studio lighting: strong sky/ground fill, one gentle key light riding with the camera. */
export function softLights(scene, camera) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 2.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(-4, 6, 10);
  camera.add(key);
}

/** Add a silhouette for an InstancedMesh: same instances, back faces only, grown by `w` in local units. */
export function outline(mesh, w = 0.05, color = 0x15171a) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = s => { s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normal * ${w.toFixed(3)};`); };
  const hull = new THREE.InstancedMesh(mesh.geometry, mat, mesh.count);
  hull.instanceMatrix = mesh.instanceMatrix;
  hull.count = mesh.count;
  mesh.parent?.add(hull);
  return hull;
}
