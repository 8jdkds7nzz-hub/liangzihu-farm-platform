import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

// 绘图依赖安装在独立工具目录；应用运行不依赖绘图库。
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const engine=process.argv[2];
if(!engine)throw new Error('请传入 beautiful-mermaid/dist/index.js 的路径，见绘图说明。');
const {renderMermaidSVG}=await import(pathToFileURL(path.resolve(engine)).href);
const font='PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif';
const C={ink:'#17352e',muted:'#596e68',line:'#a3b6ad',border:'#dce7e0',green:'#24775a',blue:'#3568a6',purple:'#7759a3',amber:'#a16d25',red:'#a75045'};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const text=(x,y,s,size=20,color=C.ink,weight=400,anchor='start')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${esc(s)}</text>`;
const rect=(x,y,w,h,fill='#fff',stroke=C.border,r=16)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const line=(d,color=C.line,dash=false,both=false)=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"${dash?' stroke-dasharray="7 6"':''} marker-end="url(#arrow)"${both?' marker-start="url(#arrow)"':''}/>`;
const badge=(x,y,label,color=C.green)=>rect(x,y,132,28,'#fff',color,14)+text(x+66,y+20,label,16,color,600,'middle');
function canvas(title,subtitle,height,body){return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="${height}" viewBox="0 0 1280 ${height}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)}</title><desc id="desc">${esc(subtitle)}</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${C.line}"/></marker></defs><g font-family="${font}"><rect width="1280" height="${height}" rx="20" fill="#fbfdfb"/>${rect(1,1,1278,height-2,'none',C.border,20)}<path d="M 40 37 H 96" stroke="${C.green}" stroke-width="5" stroke-linecap="round"/>${text(40,83,title,34,C.ink,700)}${text(40,116,subtitle,19,C.muted)}${body}</g></svg>`;}
function box(x,y,w,h,title,lines,color,fill='#fff',status){
 let s=rect(x,y,w,h,fill,C.border)+`<rect x="${x}" y="${y+18}" width="4" height="${h-36}" rx="2" fill="${color}"/>`+text(x+24,y+39,title,24,color,650);
 lines.forEach((t,i)=>s+=text(x+24,y+70+i*29,t,19,C.muted));
 if(status)s+=badge(x+w-155,y+16,status,color);
 return s;
}

// 功能名称直接取自现有界面，保持 6 板块 / 29 子模块的唯一口径。
const shell=await readFile(path.join(root,'src/components/platform/app-shell.tsx'),'utf8');
const menu=shell.split('const groups=[',2)[1].split('];',1)[0];
const groups=[...menu.matchAll(/\{name:'([^']+)',links:\[(.*?)\]\}/g)].map(m=>({name:m[1],items:[...m[2].matchAll(/\['([^']+)','([^']+)'/g)].map(n=>({route:n[1],name:n[2]}))}));
if(groups.length!==6||groups.flatMap(g=>g.items).length!==29)throw new Error('导航分组已变化，请复核功能图排版。');
const colors=[C.green,C.blue,C.amber,'#348388',C.purple,'#657369'];
const purposes=['安排今天的工作，跟进现场处理','记录从投入品到产品交付的过程','核对资源、服务、费用与科研证据','定位对象，管理空间与影像原件','从资料形成分析、审阅与任务草稿','维护规则、岗位、配置与运行条件'];
let overview=rect(40,151,1200,62,'#eaf3ed','none',14)+text(640,190,'梁子湖农场工作空间 · 同一套对象、记录与授权',24,C.green,650,'middle');
groups.forEach((g,i)=>{
 const x=40+(i%3)*407,y=246+Math.floor(i/3)*338,w=386,color=colors[i];
 overview+=rect(x,y,w,310,'#fff',C.border)+rect(x+18,y+18,45,38,color,'none',10)+text(x+40.5,y+45,String(i+1).padStart(2,'0'),20,'#fff',700,'middle')+text(x+78,y+45,g.name,25,color,650)+text(x+w-22,y+78,`${g.items.length} 个模块`,16,C.muted,400,'end');
 overview+=`<path d="M ${x+22} ${y+94} H ${x+w-22}" stroke="${C.border}"/>`;
 g.items.forEach((item,j)=>overview+=text(x+22,y+126+j*25,`${i+1}.${j+1}`,16,color,600)+text(x+65,y+126+j*25,item.name,21));
 overview+=text(x+22,y+289,purposes[i],16,C.muted);
});
overview+=rect(40,924,1200,90,'#f1f5f2','none')+text(66,958,'贯穿各板块的对象',18,C.muted,600)+text(66,991,'场区  /  塘口  /  地块  /  设备与测点  /  生产批次',23,C.ink,600)+text(1212,958,'功能分类图 · 无业务先后关系',17,C.muted,400,'end');
await writeFile(path.join(here,'功能全景.svg'),canvas('功能全景｜六大板块，29 个工作入口','从岗位工作找到入口；图中名称与当前界面菜单一致。',1040,overview));

// 架构采用双入口、同工程边界与独立任务层，折线路由显式避开文字。
let arch='';
arch+=rect(32,284,524,353,'#eef5fb','#c7d9eb',18)+text(56,311,'同一个 Next.js 工程',17,C.blue,600);
arch+=line('M 292 254 V 329',C.line,false,true)+text(310,294,'页面操作',17,C.muted);
arch+=line('M 980 254 V 329')+text(998,294,'测值 / 影像 / 作业文件',17,C.muted);
arch+=line('M 292 429 V 483',C.line,false,true)+text(310,464,'/api/v1 接口',17,C.muted);
arch+=line('M 980 429 V 483',C.line,true)+text(998,464,'真实账户与样本待联调',17,C.amber);
arch+=line('M 720 541 H 540')+text(630,527,'标准化记录',17,C.muted,400,'middle');
arch+=text(56,665,'后台任务独立运行，通过数据库领取任务',18,C.muted);
arch+=line('M 292 800 V 876',C.line,false,true)+text(310,843,'任务领取与结果记录',17,C.muted);
arch+=line('M 40 570 H 16 V 929 H 40',C.line,false,true);
arch+=text(40,843,'业务读写 / 任务入队',16,C.muted);
arch+=line('M 540 584 H 650 V 921 H 720',C.line,false,true)+text(667,655,'原件读写',17,C.muted);
arch+=line('M 540 747 H 598 V 969 H 720',C.line,false,true)+text(610,823,'派生成果',17,C.muted);
arch+=box(40,153,500,101,'人员终端',['电脑、手机浏览器 · 现场离线草稿'],C.blue,'#fff');
arch+=box(720,153,520,101,'现场设备终端',['传感器、摄像头、无人机、机场、机具'],C.amber,'#fff','待真实联调');
arch+=box(40,329,500,100,'前端界面',['React / TypeScript · 页面、表单与空间视图'],C.blue);
arch+=box(720,329,520,100,'厂家平台与资料入口',['授权接口 / 标准文件 / 人工登记'],C.amber,'#fff');
arch+=box(40,483,500,130,'后端业务服务',['身份与对象授权 · 校验、版本与业务状态','控制准备只登记申请、条件与反馈'],C.green);
arch+=box(720,483,520,130,'接入程序',['取数、转换、去重、核验','只读采集软件已有，实装接入另行验收'],C.green);
arch+=box(40,690,500,110,'独立后台任务',['告警、媒体、模型、地形、农情与报告'],C.purple);
arch+=rect(720,690,520,110,'#fff4ee','#edcfc2')+text(745,727,'真实执行适配器：尚未实现',23,C.red,650)+text(745,761,'G15 待开发与联合测试；当前不下发设备动作',18,C.red);
arch+=box(40,876,500,135,'数据库',['PostgreSQL / PostGIS / pgvector','业务与空间记录、授权、索引和任务队列'],C.green,'#edf5ef');
arch+=box(720,876,520,135,'私有文件存储',['本地 / S3 · 原件、预览、模型与派生成果','API 与后台任务分别按当前授权读写'],C.green,'#edf5ef');
arch+=text(40,1053,'实线：已有软件的数据路径     虚线：真实来源待联调     红色提示：未实现的设备执行能力',18,C.muted);
await writeFile(path.join(here,'系统架构.svg'),canvas('系统架构｜两类终端，共用业务与数据','人员使用界面；设备提供资料；后台任务独立运行并共用数据库与私有文件。',1090,arch));

const flows=[
 {name:'监测与核查',note:'从测值异常到有依据的处置结果',color:C.green,source:`flowchart LR
 measurement(["有效测值<br/>时间与质量"]) --> alarm["生成告警<br/>规则版本"]
 alarm --> check["人工核查<br/>认领、复测、处置"]
 check --> resolution(["核对恢复<br/>关闭或交班"])
 class check human
 `},
 {name:'生产与交付',note:'计划、实际执行、质量放行与交付分别留痕',color:C.blue,source:`flowchart LR
 work["人工确认任务<br/>实际农事记录"] --> stock["投入品与加工<br/>库存分录"]
 stock --> quality["独立质量审核<br/>检测凭证与放行"]
 quality --> delivery["包装与发货<br/>分次签收"]
 delivery --> customer(["审核客户摘要<br/>公开查询或撤回"])
 class work,quality,customer human
 `},
 {name:'资料与辅助分析',note:'模型给出候选与依据，人员审阅后形成任务草稿',color:C.purple,source:`flowchart LR
 materials["航次、影像、地形<br/>审核知识"] --> compute["程序计算与检索<br/>模型候选"]
 compute --> draft["简报草稿<br/>出处与限制"]
 draft --> review(["人员审阅与复核<br/>任务草稿"])
 class review human
 `},
 {name:'资源、服务与科研',note:'记录输入口径，保留核实、验收与报告快照',color:C.amber,source:`flowchart LR
 evidence["计量、称量、作业<br/>费用与试验观测"] --> verify["核实出处与单位<br/>版本与适用范围"]
 verify --> snapshot["差分、对账、验收<br/>结果快照"]
 snapshot --> report(["综合指标报告<br/>受控分享"])
 class verify human
 `}
];
let workflow='';
for(let i=0;i<flows.length;i++){
 const f=flows[i],y=155+i*218;
 const source=`%% ${f.name}：依据现有 README 中的业务步骤，不增加自动执行关系。\n${f.source}classDef human fill:#efeafa,stroke:#a995c1,color:#584277\n`;
 await writeFile(path.join(here,`${f.name}.mmd`),source);
 let svg=renderMermaidSVG(source,{font,bg:'#fbfdfb',fg:C.ink,line:C.line,accent:f.color,muted:C.muted,surface:'#fff',border:'#d5e2da',padding:16,nodeSpacing:28,layerSpacing:36});
 const [,w,h]=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
 const scale=Math.min(1125/Number(w),135/Number(h),1.65);
 // 每个独立流程保留引擎样式作用域与 marker ID，避免四图叠加时互相覆盖。
 svg=svg.replace(/id="([^"]+)"/g,(_,id)=>`id="flow${i}-${id}"`).replace(/url\(#([^)]*)\)/g,(_,id)=>`url(#flow${i}-${id})`);
 svg=svg.replace(/\s*@import url\([^\n]*\);/g,'').replaceAll(`'${font}', system-ui, sans-serif`,font).replace('text {',`svg.flow${i} text {`).replace('svg {',`svg.flow${i} {`);
 svg=svg.replace('<svg ',`<svg class="flow${i}" x="0" y="0" `).replace(/width="[\d.]+"/,'width="'+w+'"').replace(/height="[\d.]+"/,'height="'+h+'"');
 workflow+=rect(40,y,1200,198,'#fff',C.border)+rect(58,y+17,38,32,f.color,'none',9)+text(77,y+39,String(i+1).padStart(2,'0'),17,'#fff',700,'middle')+text(111,y+41,f.name,24,f.color,650)+text(1216,y+40,f.note,17,C.muted,400,'end')+`<g transform="translate(${640-Number(w)*scale/2} ${y+62}) scale(${scale})">${svg}</g>`;
}
workflow+=text(40,1070,'紫色节点：需要人员核查、确认或审阅。任务草稿须经人工确认后派发；模型候选不触发自动控制。',18,C.muted);
await writeFile(path.join(here,'业务流程.svg'),canvas('业务流程｜从输入证据到可复核结果','四条路径分别阅读；箭头表示工作顺序与记录关联，关键节点保留人员确认。',1100,workflow));
console.log('已生成：功能全景.svg、系统架构.svg、业务流程.svg及四条流程源文件。');
