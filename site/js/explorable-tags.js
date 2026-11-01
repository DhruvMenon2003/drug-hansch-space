// Layer 1. Canvas tag geometry adapted from MbappeWU/explorable, MIT (2026),
// revision 4a72bfa74af8f912eb93701cac924ab0fb68b969,
// skills/explorable/examples/planetary-gears.html:461–473 (tag).
// Retains the anchor dot, leader and rounded backing plate; adds bounded pair layout.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function drawPairTags(ctx, items, width, height, colors) {
  if (!items.length || width < 60 || height < 40) return [];
  ctx.save(); ctx.font = '600 12px Inter, system-ui, sans-serif';
  const maxWidth = Math.max(36, Math.min(310, width - 20));
  const boxes = items.map((item, i) => {
    const fit = value => {
      let text = value;
      while (text.length > 1 && ctx.measureText(text).width > maxWidth - 16) text = text.slice(0, -2).trimEnd() + '…';
      return text;
    };
    const text = fit(item.text), tail = fit((item.tail || '').replace(/^ · /, ''));
    const w = Math.min(maxWidth, Math.max(ctx.measureText(text).width, ctx.measureText(tail).width) + 16), h = tail ? 43 : 25;
    const left = items.length === 2 ? item.x <= items[1-i].x && (item.x !== items[1-i].x || i === 0) : item.x > width / 2;
    return { ...item, text, tail, w, h, bx: clamp(item.x + (left ? -w - 22 : 22), 6, width - w - 6), by: clamp(item.y + (i ? 20 : -h-20), 6, height - h - 6) };
  });
  if (boxes.length === 2) {
    const [a,b] = boxes;
    if (a.bx < b.bx+b.w+6 && a.bx+a.w+6 > b.bx && a.by < b.by+b.h+6 && a.by+a.h+6 > b.by) {
      a.by = clamp(Math.min(a.by,b.by)-16, 6, height-a.h-b.h-12);
      b.by = a.by + a.h + 6;
    }

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
