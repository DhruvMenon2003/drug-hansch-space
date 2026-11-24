// Crop one book screenshot per row: around the quote where it is in the text layer, else the whole page with a label.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [rowsFile, pdf, outDir] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const G = { 'μ':'u','µ':'u','δ':'d','α':'a','β':'b','γ':'g','κ':'k','Δ':'d','σ':'s','ω':'w' };
const strip = s => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
const translit = s => strip(s.replace(/[μµδαβγκΔσω]/g,c=>G[c]));
const dec = s => s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&amp;/g,'&');
const cache = new Map();
function page(p){ if(cache.has(p)) return cache.get(p);
  const x = execFileSync('pdftotext',['-bbox','-f',String(p),'-l',String(p),pdf,'-'],{encoding:'utf8',maxBuffer:1<<26});
  const pg = x.match(/<page width="([\d.]+)" height="([\d.]+)"/);
  const words=[...x.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)]
    .map(m=>({x0:+m[1],y0:+m[2],x1:+m[3],y1:+m[4],t:dec(m[5])})).filter(w=>strip(w.t));
  let a='',b='',own=[];
  words.forEach((w,i)=>{ const sa=strip(w.t), sb=translit(w.t); for(let k=0;k<sa.length;k++) own.push(i); a+=sa; b+=sb; });
  const v={w:+pg[1],h:+pg[2],words,a,b,own}; cache.set(p,v); return v;
}
const slug = s => (s||'x').normalize('NFKD').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,46)||'x';
const DPI=200, K=DPI/72, PAD=30;
let cropped=0, whole=0; const index=[];
for (const r of d.rows){
  const p=r.pdf_page_index; if(!p) continue;
  const pg=page(p); const qa=strip(r.quote||''), qb=translit(r.quote||'');
  let i=qa.length>=8?pg.a.indexOf(qa):-1, len=qa.length;
  if(i<0 && qb.length>=8){ const k=pg.b.indexOf(qb); if(k>=0){ i=k; len=qb.length; } }
  const name=`ch${String(r.chapters[0]).padStart(2,'0')}_p${String(p).padStart(3,'0')}_${slug(r.drug==='(no drug named — the book states the mechanism only)'?r.mechanism_group:r.drug)}`;
  const file=`${outDir}/${name}.png`;
  let how;
  if(i>=0){
    const ws=[...new Set(pg.own.slice(i,i+len))].map(k=>pg.words[k]);
    const y0=Math.max(0,Math.min(...ws.map(w=>w.y0))-PAD), y1=Math.min(pg.h,Math.max(...ws.map(w=>w.y1))+PAD);
    execFileSync('pdftoppm',['-f',String(p),'-l',String(p),'-r',String(DPI),'-x','0','-y',String(Math.round(y0*K)),'-W',String(Math.round(pg.w*K)),'-H',String(Math.round((y1-y0)*K)),'-png','-singlefile',pdf,file.replace(/\.png$/,'')]);
    how='cropped to the quoted lines'; cropped++;
  } else {
    execFileSync('pdftoppm',['-f',String(p),'-l',String(p),'-r','150','-png','-singlefile',pdf,file.replace(/\.png$/,'')]);
    how=`whole page (the quoted text sits inside a ${r.location_on_page||'figure or table'}, which is a picture, so it cannot be located in the page's text)`; whole++;
  }
  r.screenshot=`book-screenshots/${name}.png`; r.screenshot_kind=how;
  index.push({file:r.screenshot,how,drug:r.drug,mechanism:r.mechanism_group,pdf_page_index:p,printed_page:r.printed_page,chapter:r.chapters[0],quote:r.quote,source:'Pharmacology, ed. L. Gallelli (InTech, 2012)'});
}
fs.writeFileSync(rowsFile,JSON.stringify(d,null,1));
fs.writeFileSync(`${outDir}/_index.json`,JSON.stringify({made_utc:new Date().toISOString(),dpi_cropped:200,dpi_whole_page:150,count:index.length,images:index},null,1));
console.log('screenshots',index.length,'| cropped to the quote',cropped,'| whole page',whole);
