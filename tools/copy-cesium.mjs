import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),base=resolve(root,'node_modules/cesium/Build/Cesium'),target=resolve(root,'public/vendor/cesium');await mkdir(target,{recursive:true});
for(const name of ['Workers','ThirdParty','Assets','Widgets','Cesium.js'])await cp(resolve(base,name),resolve(target,name),{recursive:true,force:true});
await cp(resolve(root,'node_modules/cesium/LICENSE.md'),resolve(target,'LICENSE.md'));
const info=JSON.parse(await readFile(resolve(root,'node_modules/cesium/package.json'),'utf8'));await writeFile(resolve(target,'version.json'),JSON.stringify({version:info.version,source:'cesium npm package',containsFarmData:false}));console.log('已准备本地Cesium '+info.version+'运行资源，不包含农场模型。');
