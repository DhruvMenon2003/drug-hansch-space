import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestInMap, sliceSummary, focusExtent } from '../../site/js/inquiry-math.js';
test('map neighbours ignore missing coordinates and do not mutate frozen records',()=>{
 const rows=[{cid:1,d:{x:0,y:0}},{cid:2,d:{x:2,y:2}},{cid:3,d:{x:1,y:1}},{cid:4,d:{x:null,y:1}}];
 const before=JSON.stringify(rows),axes=[d=>d.d.x,d=>d.d.y];
 assert.deepEqual(nearestInMap(rows,rows[0],axes).map(d=>d.cid),[3,2]);
 assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(nearestInMap(rows,rows[3],axes),[]);
});
test('neighbour distances are invariant to coordinate units; ties resolve by CID',()=>{
 const rows=[{cid:1,x:0,y:0},{cid:3,x:1,y:1},{cid:2,x:1,y:1},{cid:4,x:8,y:2}];
 assert.deepEqual(nearestInMap(rows,rows[0],[d=>d.x,d=>d.y]).map(d=>d.cid),[2,3,4]);
 assert.deepEqual(nearestInMap(rows,rows[0],[d=>d.x*1000,d=>d.y]).map(d=>d.cid),[2,3,4]);
});
test('population slice distinguishes absent TPSA and missing route from negative observations',()=>{
 const rows=[{d:{tpsa:140},routes:['ORAL']},{d:{tpsa:141},routes:['ORAL']},{d:{tpsa:50},routes:[]},{d:{tpsa:null},routes:[]}];
 assert.deepEqual(sliceSummary(rows,140),{below:2,above:1,missing:1,oralBelow:1,knownRouteBelow:1,total:4});
});

test('viewport extent pads fixed coordinates without changing rows or neighbour metric',()=>{
 const rows=[{cid:1,x:2},{cid:2,x:4}];const before=JSON.stringify(rows);
 assert.deepEqual(focusExtent(rows,d=>d.x),{lo:1.7,hi:4.3});
 assert.deepEqual(focusExtent([{x:0}],d=>d.x),{lo:-0.5,hi:0.5});
 assert.equal(focusExtent([],d=>d.x),null);
 assert.equal(JSON.stringify(rows),before);
});
