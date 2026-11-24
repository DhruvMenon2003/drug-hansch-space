// Read-only: check every extracted quote against the book PDF's text layer. Writes a report; touches no chNN.json.
// Two normalisations are tried, because the book stores some Greek letters as symbol-font Latin characters:
//  A) strip every non [a-z0-9] character, so Greek letters vanish on both sides
//  B) transliterate common Greek letters to Latin first, then strip
// A quote counts as found if EITHER normalisation locates it.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [exDir, pdf, outFile] = process.argv.slice(2);
const G = { 'μ': 'u', 'µ': 'u', 'δ': 'd', 'α': 'a', 'β': 'b', 'γ': 'g', 'κ': 'k', 'Δ': 'd', 'σ': 's', 'ω': 'w' };
const strip = s => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const translit = s => strip(s.replace(/[μµδαβγκΔσω]/g, c => G[c]));
const dec = s => s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&amp;/g,'&');
const cache = new Map();
function pageText(p){ if(cache.has(p)) return cache.get(p); let raw=''; try{ raw=dec(execFileSync('pdftotext',['-f',String(p),'-l',String(p),pdf,'-'],{encoding:'utf8',maxBuffer:1<<26})); }catch(e){} const v={a:strip(raw),b:translit(raw)}; cache.set(p,v); return v; }
const out=[];
for (const f of fs.readdirSync(exDir).filter(f=>/^ch\d+\.json$/.test(f)).sort()){
  let j; try{ j=JSON.parse(fs.readFileSync(`${exDir}/${f}`,'utf8')); }catch(e){ out.push({file:f,error:'invalid json'}); continue; }
  (j.records||[]).forEach((r,i)=>{
    const qa=strip(r.quote||''), qb=translit(r.quote||''); const p=r.pdf_page_index;
    let found=null, kind='NOT FOUND', via=null;
    if(qa.length>=8){
      for(const c of [p,p+1,p-1,p+2,p-2]){ if(c<1) continue; const t=pageText(c);
        if(t.a.includes(qa)){ found=c; kind='exact'; via='strip'; break; }
        if(t.b.includes(qb)){ found=c; kind='exact'; via='greek-transliterated'; break; } }
      if(!found){ const pieces=(r.quote||'').split(/\.\.\.|…|\[[^\]]*\]/).filter(x=>strip(x).length>=25).sort((a,b)=>b.length-a.length);
        for(const pc of pieces){ for(const c of [p,p+1,p-1]){ if(c<1)continue; const t=pageText(c);
          if(t.a.includes(strip(pc))||t.b.includes(translit(pc))){ found=c; kind='partial'; via='longest piece'; break; } } if(found) break; } }
    } else kind='quote too short to check';
    out.push({chapter:j.chapter_number,record:i+1,drug:r.drug||'',mechanism:r.mechanism_rule_name||'',stated_page:p,found_page:found,result:kind,matched_via:via,page_matches:found===p,target_class:r.target_class,book_typo_restored:r.book_typo_restored===true});
  });
}
fs.writeFileSync(outFile,JSON.stringify({checked_utc:new Date().toISOString(),method:'pdftotext text layer; two normalisations tried (plain strip, and Greek transliterated to Latin); pages p, p+-1, p+-2',records:out},null,1));
const c=k=>out.reduce((m,r)=>(m[String(r[k])]=(m[String(r[k])]||0)+1,m),{});
console.log('records checked',out.length); console.log('result',c('result'),'via',c('matched_via'));
const bad=out.filter(r=>r.result!=='exact');
console.log('not exact:',bad.length);
const byCh={}; for(const r of bad) byCh['ch'+r.chapter]=(byCh['ch'+r.chapter]||0)+1; console.log('by chapter',byCh);
console.log('of the 21 corrected records, still not exact:',out.filter(r=>r.book_typo_restored&&r.result!=='exact').length);
