import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { text,integer,finite,choice } from '../../platform/validation';
import { uuid,audit } from '../identity/common';
import { scope,visible } from '../field/common';
import {normalizePolygon} from './geometry';
export async function saveBoundary(c:PoolClient,a:Actor,b:Record<string,unknown>){
 uuid(b.objectId);await scope(c,a,b.objectId,'configure');
 const version=integer(b.version,'对象版本'),crs=integer(b.sourceCrs,'坐标系');if(![4326,4490,3857].includes(crs))throw new AppError(422,'CRS_UNSUPPORTED','仅接收EPSG4326、4490或3857，请先提供坐标转换依据');
 const status=choice(b.status,['draft','verified'] as const,'边界状态'),source=text(b.source,'边界依据',2000);
 if(status==='verified')await scope(c,a,b.objectId,'review');
 const shape=await normalizePolygon(c,b.geometry,crs),row=(await c.query('SELECT version FROM objects WHERE id=$1 FOR UPDATE',[b.objectId])).rows[0];if(row?.version!==version)throw new AppError(409,'VERSION_CONFLICT','边界版本已变化，请刷新后核对');
 await c.query('UPDATE objects SET boundary=$2::geometry,boundary_status=$3,version=version+1 WHERE id=$1',[b.objectId,shape,status]);
 const saved=(await c.query('INSERT INTO boundary_versions(object_id,object_version,boundary,source_crs,source,status,confirmed_by,created_by) VALUES($1,$2,$3::geometry,$4,$5,$6,$7,$8) RETURNING id,object_version,status,source',[b.objectId,version+1,shape,crs,source,status,status==='verified'?a.id:null,a.id])).rows[0];
 const snapshot=(await c.query('SELECT id,parent_id,code,name,kind,version,boundary_status,ST_AsGeoJSON(boundary)::jsonb AS boundary FROM objects WHERE id=$1',[b.objectId])).rows[0];
 await c.query('INSERT INTO object_versions(object_id,version,snapshot,reason,created_by) VALUES($1,$2,$3,$4,$5)',[b.objectId,version+1,snapshot,source,a.id]);await audit(c,a.id,'boundary_saved',saved.id);return saved;
}
export async function savePosition(c:PoolClient,a:Actor,b:Record<string,unknown>){
 uuid(b.deviceId);const d=(await c.query('SELECT * FROM devices WHERE id=$1 FOR UPDATE',[b.deviceId])).rows[0];if(!d)throw new AppError(404,'DEVICE_NOT_FOUND','设备不存在');await scope(c,a,d.object_id,'configure');
 const lng=finite(b.lng,'经度'),lat=finite(b.lat,'纬度');if(Math.abs(lng)>180||Math.abs(lat)>90)throw new AppError(400,'INVALID_COORDINATES','经纬度超出范围');
 const version=Number((await c.query('SELECT COALESCE(max(version),0) AS n FROM device_positions WHERE device_id=$1',[d.id])).rows[0].n)+1;
 return (await c.query('INSERT INTO device_positions(device_id,object_id,version,position,source,verified,created_by) VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326),$6,$7,$8) RETURNING id,version,verified',[d.id,d.object_id,version,lng,lat,text(b.source,'定位依据',2000),b.verified===true,a.id])).rows[0];
}
export async function listMap(c:PoolClient,a:Actor,bbox?:number[]){
 const {objects,resources}=await visible(c,a,'map');if(bbox){if(bbox.length!==4||bbox.some(x=>!Number.isFinite(x))||bbox[0]>=bbox[2]||bbox[1]>=bbox[3]||Math.abs(bbox[0])>180||Math.abs(bbox[2])>180||Math.abs(bbox[1])>90||Math.abs(bbox[3])>90)throw new AppError(400,'INVALID_BBOX','空间查询范围无效');}
 const items=a.role==='expert'?(await c.query(`SELECT b.object_id AS id,COALESCE(v.snapshot->>'code','已授权对象') AS code,COALESCE(v.snapshot->>'name','已授权边界') AS name,v.snapshot->>'kind' AS kind,b.object_version AS version,b.id AS boundary_version_id,b.status AS boundary_status,ST_AsGeoJSON(b.boundary)::jsonb AS geometry FROM boundary_versions b LEFT JOIN object_versions v ON v.object_id=b.object_id AND v.version=b.object_version WHERE b.object_id=ANY($1::uuid[]) AND b.id=ANY($2::uuid[]) AND ($3::float8[] IS NULL OR ST_Intersects(b.boundary,ST_MakeEnvelope($3[1],$3[2],$3[3],$3[4],4326))) ORDER BY b.created_at DESC LIMIT 500`,[objects,resources,bbox??null])).rows:(await c.query(`SELECT o.id,o.code,o.name,o.kind,o.version,o.boundary_status,(SELECT b.id FROM boundary_versions b WHERE b.object_id=o.id ORDER BY object_version DESC LIMIT 1) AS boundary_version_id,ST_AsGeoJSON(o.boundary)::jsonb AS geometry FROM objects o WHERE o.id=ANY($1::uuid[]) AND ($2::float8[] IS NULL OR ST_Intersects(o.boundary,ST_MakeEnvelope($2[1],$2[2],$2[3],$2[4],4326))) ORDER BY o.code LIMIT 500`,[objects,bbox??null])).rows;
 const positions=await visible(c,a,'position'),devices=a.role==='expert'?(await c.query(`SELECT p.device_id AS id,p.id AS position_id,'已授权点位' AS name,NULL AS kind,NULL AS model,p.object_id,p.version,p.verified,p.source,ST_AsGeoJSON(p.position)::jsonb AS geometry FROM device_positions p JOIN devices d ON d.id=p.device_id WHERE p.object_id=ANY($1::uuid[]) AND p.id=ANY($2::uuid[]) ORDER BY p.created_at DESC LIMIT 1000`,[positions.objects,positions.resources])).rows:(await c.query(`SELECT d.id,d.name,d.kind,d.model,d.object_id,p.id AS position_id,p.version,p.verified,p.source,ST_AsGeoJSON(p.position)::jsonb AS geometry FROM devices d LEFT JOIN LATERAL(SELECT * FROM device_positions WHERE device_id=d.id AND object_id=d.object_id ORDER BY version DESC LIMIT 1)p ON true WHERE d.object_id=ANY($1::uuid[]) ORDER BY d.id LIMIT 1000`,[objects])).rows;
 const flightScope=await visible(c,a,'flight'),coverageScope=await visible(c,a,'coverage'),rasterScope=await visible(c,a,'raster'),annotationScope=await visible(c,a,'annotation');
 const coverages=(await c.query(`SELECT DISTINCT ON(v.flight_id) v.id,v.flight_id,v.object_id,v.version,v.status,v.source_ref,f.started_at,f.finished_at,f.capture_conditions,ST_AsGeoJSON(v.geometry)::jsonb AS geometry FROM flight_coverages v JOIN flights f ON f.id=v.flight_id WHERE v.object_id=ANY($1::uuid[]) AND($2::uuid[] IS NULL OR v.id=ANY($2)) AND($3::float8[] IS NULL OR ST_Intersects(v.geometry,ST_MakeEnvelope($3[1],$3[2],$3[3],$3[4],4326))) ORDER BY v.flight_id,v.version DESC LIMIT 500`,[coverageScope.objects,coverageScope.resources,bbox??null])).rows;
 const rasters=(await c.query('SELECT id,file_id,flight_id,object_id,bounds,source_ref,state,error_code,preview_asset_id FROM flight_rasters WHERE object_id=ANY($1::uuid[]) AND($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY created_at DESC LIMIT 200',[rasterScope.objects,rasterScope.resources])).rows;
 const annotations=(await c.query('SELECT n.*,f.object_id FROM flight_annotations n JOIN flights f ON f.id=n.flight_id WHERE f.object_id=ANY($1::uuid[]) AND($2::uuid[] IS NULL OR n.id=ANY($2)) AND NOT EXISTS(SELECT 1 FROM flight_annotations x WHERE x.supersedes_id=n.id) ORDER BY n.created_at DESC LIMIT 500',[annotationScope.objects,annotationScope.resources])).rows;
 const flights=(await c.query('SELECT id,object_id,started_at,finished_at,capture_conditions,source_ref FROM flights WHERE object_id=ANY($1::uuid[]) AND($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY started_at DESC LIMIT 100',[flightScope.objects,flightScope.resources])).rows;

 return {items,devices,coverages,rasters,annotations,flights,crs:'EPSG:4326',limitations:['未核实边界不参与面积结论','地图邻近不证明设备归属或水力连通']};
}
