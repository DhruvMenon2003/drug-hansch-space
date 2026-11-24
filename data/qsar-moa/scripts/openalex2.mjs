// Two OpenAlex searches per mechanism: "<mechanism>s" QSAR and "<mechanism>s" Pharmacokinetics, top 10 by relevance.
// If the exact-phrase search returns fewer than 10 works, a second search without the quotation marks fills the list (flagged).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [out, key] = process.argv.slice(2);
const inc = JSON.parse(fs.readFileSync(`${out}/rows.json`, 'utf8'));
const mechs = [...new Set(inc.rows.map(r => r.mechanism_group))].sort();
const cacheFile = `${out}/papers/openalex_raw.json`;
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sel = 'id,doi,title,publication_year,cited_by_count,type,primary_location,open_access,authorships';
async function search(q) {
  if (cache[q]) return cache[q];
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=10&select=${sel}` + (key ? `&api_key=${key}` : '');
  for (let t = 0; t < 4; t++) {
    try { const j = JSON.parse(execFileSync('curl', ['-sS', '-m', '60', url], { encoding: 'utf8', maxBuffer: 1 << 26 })); if (j.results) { cache[q] = { count: j.meta.count, results: j.results }; fs.writeFileSync(cacheFile, JSON.stringify(cache)); await sleep(150); return cache[q]; } } catch (e) { }
    await sleep(1500 * (t + 1));
  }
  return { count: null, results: [], error: true };
}
const rows = []; const summary = [];
for (const m of mechs) for (const kw of ['QSAR', 'Pharmacokinetics']) {
  const exactQ = `"${m}s" ${kw}`; const ex = await search(exactQ);
  let list = ex.results.map(w => ({ w, q: exactQ, kind: 'exact phrase' }));
  let looseCount = null;
  if (list.length < 10) { const looseQ = `${m}s ${kw}`; const lo = await search(looseQ); looseCount = lo.count; const have = new Set(list.map(x => x.w.id)); for (const w of lo.results) { if (list.length >= 10) break; if (!have.has(w.id)) list.push({ w, q: looseQ, kind: 'fallback without quotation marks' }); } }
  summary.push({ mechanism: m, keyword: kw, exact_query: exactQ, exact_total: ex.count, fallback_total: looseCount, listed: list.length, error: !!ex.error });
  list.forEach((x, i) => { const w = x.w; rows.push({ mechanism: m, keyword: kw, rank: i + 1, query_used: x.q, match_kind: x.kind, title: (w.title || '').replace(/\s+/g, ' '), year: w.publication_year, first_author: w.authorships?.[0]?.author?.display_name || '', n_authors: w.authorships?.length || 0, journal: w.primary_location?.source?.display_name || '', type: w.type, cited_by: w.cited_by_count, doi: w.doi || '', open_access: w.open_access?.is_oa ? 'yes' : 'no', oa_status: w.open_access?.oa_status || '', oa_url: w.open_access?.oa_url || '', openalex_id: w.id }); });
}
fs.writeFileSync(`${out}/papers/openalex_papers.json`, JSON.stringify({ retrieved_utc: new Date().toISOString(), summary, rows }, null, 1));
console.log('mechanisms', mechs.length, 'searches', summary.length, 'paper rows', rows.length, 'unique works', new Set(rows.map(r => r.openalex_id)).size);
console.log('errors', summary.filter(s => s.error).length, 'exact>=10:', summary.filter(s => s.exact_total >= 10).length, 'exact 1-9:', summary.filter(s => s.exact_total > 0 && s.exact_total < 10).length, 'exact 0:', summary.filter(s => s.exact_total === 0).length, 'lists shorter than 10:', summary.filter(s => s.listed < 10).length);
console.log('open access rows', rows.filter(r => r.open_access === 'yes').length, 'rows with doi', rows.filter(r => r.doi).length);
for (const s of summary.slice(0, 8)) console.log(JSON.stringify(s));
