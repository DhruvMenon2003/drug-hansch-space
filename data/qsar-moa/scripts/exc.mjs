import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const els = j.elements.filter(e => !e.isDeleted);
const types = {}; for (const e of els) types[e.type] = (types[e.type] || 0) + 1;
console.log('types', types, 'files', Object.keys(j.files || {}).length);
const r = e => `x=${Math.round(e.x)} y=${Math.round(e.y)} w=${Math.round(e.width)} h=${Math.round(e.height)}`;
for (const e of els.sort((a, b) => a.y - b.y || a.x - b.x)) {
  if (e.type === 'text') console.log('TEXT', r(e), `font=${e.fontSize} color=${e.strokeColor}`, JSON.stringify(e.text.slice(0, 600)), e.link ? 'LINK=' + e.link : '');
  else if (e.type === 'image') { const f = j.files[e.fileId]; console.log('IMAGE', r(e), e.fileId.slice(0, 8), f ? f.mimeType + ' ' + Math.round(f.dataURL.length * 0.75 / 1024) + 'KB' : 'nofile', e.link ? 'LINK=' + e.link : ''); }
  else if (e.type === 'arrow' || e.type === 'line') console.log(e.type.toUpperCase(), r(e), 'from', e.startBinding?.elementId?.slice(0, 6), 'to', e.endBinding?.elementId?.slice(0, 6));
  else console.log(e.type.toUpperCase(), r(e), `stroke=${e.strokeColor} bg=${e.backgroundColor}`, e.link ? 'LINK=' + e.link : '');
}
if (process.argv[3]) { fs.mkdirSync(process.argv[3], { recursive: true }); let i = 0; for (const e of els.filter(e => e.type === 'image').sort((a, b) => a.y - b.y || a.x - b.x)) { const f = j.files[e.fileId]; if (!f) continue; const ext = f.mimeType.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg'); fs.writeFileSync(`${process.argv[3]}/img${String(++i).padStart(2, '0')}_x${Math.round(e.x)}_y${Math.round(e.y)}.${ext}`, Buffer.from(f.dataURL.split(',')[1], 'base64')); } console.log('wrote', i); }
