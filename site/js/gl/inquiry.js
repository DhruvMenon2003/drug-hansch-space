// Reuses the existing on-demand renderer. Rings and trails encode identity, never molecular geometry.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { app, anim, bus, S, reduceMotion } from '../kernel.js';
import { stage, wake, disposeGroup } from './scene.js';
export function initInquiryScene() {
  const group = new THREE.Group(); stage.scene.add(group);
  const rings = Array.from({ length: 6 }, (_, i) => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(i ? 0.29 : 0.46, i ? 0.34 : 0.53, 40), new THREE.MeshBasicMaterial({ color: i ? '#248c93' : '#ba512e', side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: i ? 0.8 : 1 }));
    mesh.renderOrder = 5; group.add(mesh); return mesh;
  });
  const labels = Array.from({ length: 5 }, (_, i) => {
    const el=document.createElement('span');el.className='inquiry-point-label';el.textContent=String(i+1);
    const label=new CSS2DObject(el);label.center.set(-0.5,1.5);group.add(label);return label;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(36), 3));
  const trails = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#248c93', transparent: true, opacity: 0.5 }));
  trails.frustumCulled = false; group.add(trails);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2*S,2*S), new THREE.MeshBasicMaterial({color:'#248c93',transparent:true,opacity:0.13,side:THREE.DoubleSide,depthWrite:false}));
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plane.geometry),new THREE.LineBasicMaterial({color:'#248c93',transparent:true,opacity:0.8}));
  group.add(plane,edge);
  const prior=stage.scene.onBeforeRender;
  stage.scene.onBeforeRender=function(...args){
    prior?.apply(this,args);
    const q=app.inquiry, ids=q?.active && q.cid != null ? [q.cid,...q.neighbours.map(d=>d.cid)] : [];
    const a=geo.attributes.position.array; a.fill(0);
    const placed = [];
    const projectedPin = ids.length ? new THREE.Vector3(...anim.cur.slice(app.drugs.findIndex(d=>d.cid===ids[0])*4,app.drugs.findIndex(d=>d.cid===ids[0])*4+3)).project(stage.camera) : null;
    const width=stage.renderer.domElement.clientWidth,height=stage.renderer.domElement.clientHeight;
    rings.forEach((ring,j)=>{
      const index=ids[j] == null ? -1 : app.drugs.findIndex(d=>d.cid===ids[j]), k=index*4;
      ring.visible=index>=0 && anim.cur[k+3]>0.5;
      ring.scale.setScalar(q?.focused ? 0.24 : 1);
      if(j>0){labels[j-1].visible=ring.visible;if(ring.visible)labels[j-1].position.set(anim.cur[k],anim.cur[k+1],anim.cur[k+2]);}
      if(!ring.visible)return;
      ring.position.set(anim.cur[k],anim.cur[k+1],anim.cur[k+2]);ring.quaternion.copy(stage.camera.quaternion);
      if(q?.focused){const dist=ring.position.distanceTo(stage.camera.position);ring.scale.setScalar(Math.min(1,Math.max(0.24,10*dist*Math.tan(stage.camera.fov*Math.PI/360)/(Math.max(1,height)*0.29))));}
      if(j>0 && ring.visible){
        const p=ring.position.clone().project(stage.camera),xy={x:(p.x+1)*width/2,y:(1-p.y)*height/2};
        const nearPin=projectedPin && Math.abs(p.x-projectedPin.x)*width/2<65 && Math.abs(p.y-projectedPin.y)*height/2<22;
        labels[j-1].visible=!nearPin && p.z>=-1 && p.z<=1 && !placed.some(q=>Math.hypot(q.x-xy.x,q.y-xy.y)<28);
        if(labels[j-1].visible)placed.push(xy);
      }
      a.set([anim.from[k],anim.from[k+1],anim.from[k+2],anim.cur[k],anim.cur[k+1],anim.cur[k+2]],j*6);
    });
    trails.visible=ids.length>0 && anim.t<1;geo.attributes.position.needsUpdate=true;
    const axis=['x','y','z'].find(a=>app.view[a]==='tpsa'),value=q?.active ? q.slice : null,sc=axis&&app.scales?.[axis];
    plane.visible=edge.visible=value!=null && !!sc && value>=sc.lo && value<=sc.hi;
    if(plane.visible){plane.rotation.set(0,0,0);plane.position.set(0,0,0);if(axis==='y')plane.rotation.x=-Math.PI/2;else if(axis==='x')plane.rotation.y=Math.PI/2;plane.position[axis]=sc.map(value);edge.rotation.copy(plane.rotation);edge.position.copy(plane.position);}
  };
  function focus() {
    const q=app.inquiry; if(!q?.active || !q.focused || !app.visible.some(d=>d.cid===q.cid))return;
    const ids=[q.cid,...q.neighbours.map(d=>d.cid)];
    const coords=ids.map(cid=>{const k=app.drugs.findIndex(d=>d.cid===cid)*4;return new THREE.Vector3(anim.to[k],anim.to[k+1],anim.to[k+2]);});
    const box=new THREE.Box3().setFromPoints(coords),center=box.getCenter(new THREE.Vector3());
    const radius=Math.max(1.6,box.getSize(new THREE.Vector3()).length()/2);
    const camera=stage.camera,target=stage.controls.target;
    const dir=camera.position.clone().sub(target).normalize();
    const halfFov=Math.atan(Math.tan(camera.fov*Math.PI/360)*Math.min(1,camera.aspect));
    const distance=Math.max(stage.controls.minDistance,radius/Math.sin(halfFov)*1.5);
    const to=center.clone().addScaledVector(dir,distance);
    window.gsap?.killTweensOf(camera.position);window.gsap?.killTweensOf(target);
    if(reduceMotion.matches || !window.gsap){camera.position.copy(to);target.copy(center);wake();return;}
    window.gsap.to(camera.position,{x:to.x,y:to.y,z:to.z,duration:1.1,ease:'power2.inOut',onUpdate:wake});
    window.gsap.to(target,{x:center.x,y:center.y,z:center.z,duration:1.1,ease:'power2.inOut',onUpdate:wake});
  }
  const offFocus=bus.on('inquiry:focus',focus);
  const offLayoutFocus=bus.on('layout',focus,20);
  focus();
  const off=bus.on('inquiry:changed' ,()=>{stage.dirty.inst=true;wake();});
  return ()=>{off();offFocus();offLayoutFocus();stage.scene.onBeforeRender=prior;disposeGroup(group);};
}
