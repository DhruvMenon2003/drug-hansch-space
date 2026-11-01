// Layer 1. Canvas tag geometry adapted from MbappeWU/explorable, MIT (2026),
// revision 4a72bfa74af8f912eb93701cac924ab0fb68b969,
// skills/explorable/examples/planetary-gears.html:461–473 (tag).
// Retains the anchor dot, leader and rounded backing plate; adds bounded pair layout.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function drawPairTags(ctx, items, width, height, colors, reserved = []) {
  if (!items.length || width < 60 || height < 40) return [];
  ctx.save(); ctx.font = '600 12px Inter, system-ui, sans-serif';
  const maxWidth = Math.max(36, Math.min(310, width - 20));
  const boxes = [];
  const occupied = reserved.map(r => ({ ...r }));
  for (const [i, item] of items.entries()) {
    const fit = value => {
      let text = value;
      while (text.length > 1 && ctx.measureText(text).width > maxWidth - 16) text = text.slice(0, -2).trimEnd() + '…';
      return text;
    };
    const text = fit(item.text), tail = fit((item.tail || '').replace(/^ · /, ''));
    const w = Math.min(maxWidth, Math.max(ctx.measureText(text).width, ctx.measureText(tail).width) + 16), h = tail ? 43 : 25;
    const left = items.length === 2 ? item.x <= items[1-i].x && (item.x !== items[1-i].x || i === 0) : item.x > width / 2;
    if (w > width-12 || h > height-12) continue;
    const preferredX = clamp(item.x + (left ? -w-22 : 22), 6, width-w-6);
    const preferredY = clamp(item.y + (i ? 20 : -h-20), 6, height-h-6);
    // Candidate edges include real overlays, not a fixed mobile bottom offset.
    const xs = [preferredX, item.x-w-22, item.x+22, 6, width-w-6,
      ...occupied.flatMap(r => [r.x-w-6, r.x+r.width+6])].map(x => clamp(x, 6, width-w-6));
    const ys = [preferredY, item.y-h-20, item.y+20, 6, height-h-6,
      ...occupied.flatMap(r => [r.y-h-6, r.y+r.height+6])].map(y => clamp(y, 6, height-h-6));
    const candidates = xs.flatMap(bx => ys.map(by => ({ bx, by }))).filter(({ bx, by }) =>
      !occupied.some(r => bx < r.x+r.width+5 && bx+w+5 > r.x && by < r.y+r.height+5 && by+h+5 > r.y));
    candidates.sort((a,b) => (a.bx-preferredX)**2+(a.by-preferredY)**2 - (b.bx-preferredX)**2-(b.by-preferredY)**2);
    if (!candidates.length) continue; // A sheet covering the plot must not be overpainted.
    const box = { ...item, text, tail, w, h, ...candidates[0] };
    boxes.push(box);
    occupied.push({ x: box.bx, y: box.by, width: w, height: h });
  }
  for (const b of boxes) {
    ctx.fillStyle=colors.ink; ctx.beginPath(); ctx.arc(b.x,b.y,2.5,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=colors.ink; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(b.x,b.y); ctx.lineTo(clamp(b.x,b.bx+6,b.bx+b.w-6),clamp(b.y,b.by,b.by+b.h)); ctx.stroke();
    ctx.fillStyle=colors.panel; ctx.globalAlpha=0.96; ctx.beginPath(); ctx.roundRect(b.bx,b.by,b.w,b.h,7); ctx.fill(); ctx.globalAlpha=1;
    ctx.strokeStyle=colors.muted; ctx.stroke(); ctx.fillStyle=colors.ink; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(b.text,b.bx+8,b.by+13);
    if(b.tail){ctx.fillStyle=colors.muted;ctx.fillText(b.tail,b.bx+8,b.by+31);}
  }
  ctx.restore(); return boxes;
}
