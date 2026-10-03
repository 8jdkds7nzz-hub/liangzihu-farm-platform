'use client';
export default function GeometryPreview({boundary,missing,overlap}:{boundary:any;missing?:any;overlap?:any}){
 const all:number[][]=[];function points(v:any){if(Array.isArray(v)&&v.length>=2&&typeof v[0]==='number'&&typeof v[1]==='number')all.push(v);else if(Array.isArray(v))v.forEach(points);}points(boundary?.coordinates);if(!all.length)return <p>缺少可展示边界。</p>;
 const xs=all.map(x=>x[0]),ys=all.map(x=>x[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),dx=maxX-minX||1,dy=maxY-minY||1;
 function paths(g:any):string[]{if(!g)return [];if(g.type==='GeometryCollection')return (g.geometries??[]).flatMap(paths);const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];return polygons.map((p:number[][][])=>p.map(r=>r.map((v,i)=>(i?'L':'M')+(20+(v[0]-minX)/dx*560)+','+(320-(v[1]-minY)/dy*300)).join(' ')+' Z').join(' '));}
 return <figure><svg viewBox="0 0 600 340" role="img" aria-label="计划边界与疑似漏重作范围" style={{width:'100%',maxHeight:360,background:'#f3f5f0'}}>{paths(boundary).map((d,i)=><path key={'b'+i} d={d} fill="#c6d6c5" stroke="#235d48" fillRule="evenodd"/>)}{paths(missing).map((d,i)=><path key={'m'+i} d={d} fill="#e8c477" fillRule="evenodd"/>)}{paths(overlap).map((d,i)=><path key={'o'+i} d={d} fill="#bf745c" fillRule="evenodd"/>)}</svg><figcaption>绿色为计划边界；黄色为轨迹推算的疑似漏作，红色为疑似重作。图示不替代现场核查。</figcaption></figure>;
}

