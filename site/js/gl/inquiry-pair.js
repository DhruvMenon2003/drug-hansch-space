// Layer 3. Two identity tags follow the actual interpolated drug coordinates.
import * as THREE from 'three';
import { app, anim, bus, cap } from '../kernel.js';
import { drawPairTags } from '../explorable-tags.js';
import { stage, wake } from './scene.js';
export function initPairScene() {
  const scene=stage.scene, source=stage.renderer?.domElement;
  if (!scene || !source) return () => {};
  const canvas=document.createElement('canvas'); canvas.className='inquiry-pair-tags'; canvas.setAttribute('aria-hidden','true');
  // Same positioned parent and canvas offsets preserve the mobile toolbar row.
  source.parentElement.append(canvas);
  const ctx=canvas.getContext('2d'), point=new THREE.Vector3();
  if (!ctx) { canvas.remove(); return () => {}; }
  let disposed=false;
  const prior=scene.onBeforeRender;
  function render(...args) {
    prior?.apply(this,args);
    if(disposed)return;
    const width=source.clientWidth,height=source.clientHeight,dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.style.left=`${source.offsetLeft}px`;canvas.style.top=`${source.offsetTop}px`;canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
    const w=Math.round(width*dpr),h=Math.round(height*dpr);
    if(canvas.width!==w || canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const q=app.inquiry;
    if(!q?.active || q.cid==null || q.comparisonCid==null || !anim.cur)return;
    const descriptor=q.descriptor || 'tpsa', specs={tpsa:['TPSA','Å²'],logp:['log P',''],mr:['MR','cm³/mol']},spec=specs[descriptor] || specs.tpsa;
    const key=specs[descriptor]?descriptor:'tpsa';
    const axis=['x','y','z'].findIndex(a=>app.view[a]===key);
    const items=[q.cid,q.comparisonCid].map((cid,i)=>{
      const index=app.drugs.findIndex(d=>d.cid===cid),k=index*4;
      if(index<0 || anim.cur[k+3]<=0.5)return null;
      point.set(anim.cur[k],anim.cur[k+1],anim.cur[k+2]).project(stage.camera);
      if(!Number.isFinite(point.x)||point.z < -1 || point.z > 1 || Math.abs(point.x)>1 || Math.abs(point.y)>1)return null;
      const drug=app.drugs[index],value=drug.d?.[key];
      return {world:[anim.cur[k],anim.cur[k+1],anim.cur[k+2]],x:(point.x+1)*width/2,y:(1-point.y)*height/2,text:`${i?'Compare':'Pinned'}: ${cap(drug.name)}`,tail:` · ${spec[0]} ${Number.isFinite(value)?value.toFixed(key==='logp'?3:2):'missing'}${Number.isFinite(value)&&spec[1]?' '+spec[1]:''}${axis<0?' · not a map axis':''}`};
    }).filter(Boolean);
    const css=getComputedStyle(canvas);
    if(items.length===2 && axis>=0 && anim.t===1) {
      const [a,b]=items, mid=a.world.map((v,i)=>(v+b.world[i])/2);
      const ends=[a,b].map(item=>{const v=[...mid];v[axis]=item.world[axis];point.set(...v).project(stage.camera);return {x:(point.x+1)*width/2,y:(1-point.y)*height/2,z:point.z};});
      if(ends.every(v=>Number.isFinite(v.x)&&v.z>=-1&&v.z<=1&&v.x>=0&&v.x<=width&&v.y>=0&&v.y<=height)) {
        const [c,d]=ends, dx=d.x-c.x,dy=d.y-c.y,len=Math.hypot(dx,dy),nx=len? -dy/len*4:4,ny=len?dx/len*4:0;
        ctx.save();ctx.strokeStyle=css.getPropertyValue('--pair-muted').trim()||'#607678';ctx.lineWidth=1.25;
        ctx.beginPath();ctx.moveTo(c.x,c.y);ctx.lineTo(d.x,d.y);ctx.moveTo(c.x-nx,c.y-ny);ctx.lineTo(c.x+nx,c.y+ny);ctx.moveTo(d.x-nx,d.y-ny);ctx.lineTo(d.x+nx,d.y+ny);ctx.stroke();
        ctx.setLineDash([2,4]);ctx.globalAlpha=0.7;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(c.x,c.y);ctx.moveTo(b.x,b.y);ctx.lineTo(d.x,d.y);ctx.stroke();ctx.restore();
      }
    }
    const bounds=source.getBoundingClientRect();
    const reserved=['inquiry-beacon','detail'].flatMap(id=>{
      const el=document.getElementById(id);
      if(!el || el.hidden || !el.getClientRects().length)return [];
      const r=el.getBoundingClientRect(),sx=width/bounds.width,sy=height/bounds.height;
      const x=Math.max(0,(r.left-bounds.left)*sx),y=Math.max(0,(r.top-bounds.top)*sy);
      const right=Math.min(width,(r.right-bounds.left)*sx),bottom=Math.min(height,(r.bottom-bounds.top)*sy);
      return right>x && bottom>y ? [{x,y,width:right-x,height:bottom-y}] : [];
    });
    drawPairTags(ctx,items,width,height,{ink:css.getPropertyValue('--pair-ink').trim()||'#183c43',panel:css.getPropertyValue('--pair-panel').trim()||'#fffdf5',muted:css.getPropertyValue('--pair-muted').trim()||'#607678'},reserved);
  }
  scene.onBeforeRender=render;
  // The sheet's CSS height transition can outlast the scene tween. Redraw on its
  // actual bounds changes so identity tags never retain a pre-transition position.
  const refresh=()=>{stage.dirty.labels=true;wake();};
  const sheet=document.getElementById('detail'), observer=new ResizeObserver(refresh);
  if(sheet)observer.observe(sheet);
  const off=bus.on('inquiry:changed',refresh);refresh();
  return ()=>{disposed=true;observer.disconnect();off();if(scene.onBeforeRender===render)scene.onBeforeRender=prior;canvas.remove();};
}
