import {decimal,signedMicros} from '../inventory/quantity';
export function calculateEnergy(rows:any[],start:string,end:string,maxGapSeconds:number,verified:boolean){
 const gaps:string[]=[];let known=0n,segments=0;
 if(!verified)gaps.push('能源档案未核实或已撤回');
 if(rows.length<2)gaps.push('不足两个有效边界观测');
 if(!rows.length||new Date(rows[0].observed_at).toISOString()!==start||new Date(rows.at(-1).observed_at).toISOString()!==end)gaps.push('区间起止没有对应观测，不外推整段耗电');
 for(let i=1;i<rows.length;i++){
  const prev=rows[i-1],cur=rows[i],delta=prev.value===null||cur.value===null?null:signedMicros(cur.value)-signedMicros(prev.value),seconds=(+new Date(cur.observed_at)-+new Date(prev.observed_at))/1000;
  if(cur.reset||delta!==null&&delta<0n){gaps.push('计量表复位或倒退');continue;}
  if(prev.quality!=='valid'||cur.quality!=='valid'||delta===null||seconds>maxGapSeconds||seconds<=0){gaps.push('观测缺失、质量可疑或间隔超限');continue;}
  known+=delta;segments++;
 }
 return {energyKwh:gaps.length?null:decimal(known),knownSegmentKwh:segments?decimal(known):null,complete:gaps.length===0,gaps:[...new Set(gaps)],inputIds:rows.map(r=>r.id),fromAt:start,toAt:end,algorithmVersion:'counter-difference-v1'};
}
