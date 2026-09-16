// SPDX-License-Identifier: GPL-3.0-or-later
// Validate an offline demonstration trajectory and its rendered frames.
const fs=require('node:fs'); const crypto=require('node:crypto');const assert=require('node:assert/strict');
const root=process.argv[2];const trace=JSON.parse(fs.readFileSync(root+'/trajectory.json'));
assert.equal(trace.length,600);
for(const [start,end,sign] of [[80,190,1],[440,550,-1]]) {
 let maxStep=0,plateaus=0;const hashes=new Set();
 for(let i=start;i<=end;i++) {
  const delta=(trace[i].current-trace[i-1].current)*sign;
  assert(delta>=0, `Reversal at ${i}`);
  if(delta<1e-7)plateaus++;
  maxStep=Math.max(maxStep,Math.abs(Math.log(trace[i].current/trace[i-1].current)));
  hashes.add(crypto.createHash('sha256').update(fs.readFileSync(`${root}/frame-${String(i).padStart(3,'0')}.png`)).digest('hex'));
 }
 assert.equal(plateaus,0);assert(maxStep<.01);assert(hashes.size>.95*(end-start+1));
 console.log(`${start}..${end}: no stops/reversals, max relative step ${(Math.expm1(maxStep)*100).toFixed(3)}%, unique frames ${hashes.size}/${end-start+1}`);
}
assert.equal(trace[599].current,1);assert.equal(trace[599].active,false);
console.log('PASS: final zoom fully off');
