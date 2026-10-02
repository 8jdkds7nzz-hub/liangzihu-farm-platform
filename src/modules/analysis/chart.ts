export interface ChartPoint{id:string;time:number;value:number|null;valid:boolean;label?:string}
export function chartSeries(input:ChartPoint[],maxGapMs:number|null){
 const ordered=input.filter(p=>Number.isFinite(p.time)).sort((a,b)=>a.time-b.time),points=ordered.filter(p=>p.value!==null&&Number.isFinite(p.value)),segments:ChartPoint[][]=[];let current:ChartPoint[]=[],previous:ChartPoint|null=null;
 for(const p of ordered){const usable=p.valid&&p.value!==null&&Number.isFinite(p.value);if(!usable||!maxGapMs||previous&&p.time-previous.time>maxGapMs){if(current.length)segments.push(current);current=[];}if(usable){current.push(p);previous=p;}else previous=null;}if(current.length)segments.push(current);
 const values=points.map(p=>p.value!),min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1,pad=max===min?Math.max(Math.abs(max)*.05,1):(max-min)*.1;
 return {points,segments,domain:{from:ordered[0]?.time??0,to:ordered.at(-1)?.time??1,min:min-pad,max:max+pad}};
}
