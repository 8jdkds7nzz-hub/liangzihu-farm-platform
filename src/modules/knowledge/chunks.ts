export function terms(s:string){const tokens=new Set<string>();for(const part of s.toLowerCase().match(/[a-z0-9_.-]+|[\u3400-\u9fff]+/g)??[]){if(/^[\u3400-\u9fff]+$/.test(part)){if(part.length===1)tokens.add(part);for(let i=0;i<part.length-1;i++)tokens.add(part.slice(i,i+2));for(const word of ['溶解氧','小龙虾','武昌鱼','亚硝酸盐','总磷','总氮','氨氮','稻田','积温','追肥','灌排'])if(part.includes(word))tokens.add(word);}else tokens.add(part);}return [...tokens].slice(0,1000);}
export function chunkMarkdown(body:string,max=400){const output:{heading:string;text:string}[]=[],headings:string[]=[];let buffer:string[]=[];const heading=()=>headings.filter(Boolean).join(' / ');function flush(){if(buffer.length){output.push({heading:heading(),text:[heading(),...buffer].filter(Boolean).join('\n')});buffer=[];}}
 const lines=body.replaceAll('\r\n','\n').split('\n');let tableHeader:string[]=[];
 for(let i=0;i<lines.length;i++){const line=lines[i],h=/^(#{1,6})\s+(.+)$/.exec(line);if(h){flush();headings.length=h[1].length;headings[h[1].length-1]=h[2];tableHeader=[];continue;}
 const table=line.trim().startsWith('|');if(table&&i+1<lines.length&&/^\s*\|?[\s:|-]+\|/.test(lines[i+1]))tableHeader=[line,lines[i+1]];
 if(buffer.join('\n').length+line.length>max){flush();if(table&&tableHeader.length&&!tableHeader.includes(line))buffer.push(...tableHeader);}
 if(line.length>max){flush();for(let start=0;start<line.length;start+=max-100)output.push({heading:heading(),text:[heading(),line.slice(start,start+max)].filter(Boolean).join('\n')});}else buffer.push(line);
 if(!table&&line.trim())tableHeader=[];
 }flush();return output.filter(c=>c.text.trim());}
