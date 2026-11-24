import fs from 'node:fs';
const out = process.argv[2];
const oa = JSON.parse(fs.readFileSync(`${out}/openalex_papers.json`, 'utf8'));
const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const cols = ['mechanism', 'keyword', 'rank', 'query_used', 'match_kind', 'title', 'year', 'first_author', 'n_authors', 'journal', 'type', 'cited_by', 'doi', 'open_access', 'oa_status', 'oa_url', 'openalex_id'];
fs.writeFileSync(`${out}/paper_list_openalex.csv`, '﻿' + [cols.join(','), ...oa.rows.map(r => cols.map(c => q(r[c])).join(','))].join('\r\n'));
console.log('csv rows', oa.rows.length);
