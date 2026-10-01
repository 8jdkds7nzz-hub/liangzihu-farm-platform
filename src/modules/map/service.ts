import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { text,integer,finite,choice } from '../../platform/validation';
import { uuid,audit } from '../identity/common';
import { scope,visible } from '../field/common';
export async function saveBoundary(c:PoolClient,a:Actor,b:Record<string,unknown>){
 uuid(b.objectId);await scope(c,a,b.objectId,'configure');
 const version=integer(b.version,'对象版本'),crs=integer(b.sourceCrs,'坐标系');if(![4326,4490,3857].includes(crs))throw new AppError(422,'CRS_UNSUPPORTED','仅接收EPSG4326、4490或3857，请先提供坐标转换依据');
 const status=choice(b.status,['draft','verified'] as const,'边界状态'),source=text(b.source,'边界依据',2000);
 if(status==='verified')await scope(c,a,b.objectId,'review');
 if(!b.geometry||typeof b.geometry!=='object'||JSON.stringify(b.geometry).length>500000)throw new AppError(400,'INVALID_GEOMETRY','请提供有效GeoJSON面边界');
 let shape;try{shape=(await c.query(`WITH g AS(SELECT ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1),$2),4326)) AS geom)
 SELECT ST_AsEWKT(geom) AS ewkt,ST_IsValid(geom) AS valid,ST_GeometryType(geom) AS kind,ST_IsEmpty(geom) AS empty FROM g`,[JSON.stringify(b.geometry),crs])).rows[0];}catch{throw new AppError(400,'INVALID_GEOMETRY','GeoJSON边界或坐标无效');}
 if(!shape?.valid||shape.empty||shape.kind!=='ST_MultiPolygon')throw new AppError(400,'INVALID_GEOMETRY','边界须为无自交的Polygon或MultiPolygon');
 const row=(await c.query('SELECT version FROM objects WHERE id=$1 FOR UPDATE',[b.objectId])).rows[0];
 if(row?.version!==version)throw new AppError(409,'VERSION_CONFLICT','边界版本已变化，请刷新后核对');
 const bounds=(await c.query('SELECT ST_XMin($1::geometry::box3d) AS x1,ST_XMax($1::geometry::box3d) AS x2,ST_YMin($1::geometry::box3d) AS y1,ST_YMax($1::geometry::box3d) AS y2',[shape.ewkt])).rows[0];
 if(bounds.x1 < -180||bounds.x2>180||bounds.y1 < -90||bounds.y2>90)throw new AppError(400,'INVALID_COORDINATES','转换后坐标超出经纬度范围');
 await c.query('UPDATE objects SET boundary=$2::geometry,boundary_status=$3,version=version+1 WHERE id=$1',[b.objectId,shape.ewkt,status]);
 const saved=(await c.query('INSERT INTO boundary_versions(object_id,object_version,boundary,source_crs,source,status,confirmed_by,created_by) VALUES($1,$2,$3::geometry,$4,$5,$6,$7,$8) RETURNING id,object_version,status,source',[b.objectId,version+1,shape.ewkt,crs,source,status,status==='verified'?a.id:null,a.id])).rows[0];
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
 const items=(await c.query(`SELECT id,code,name,kind,version,boundary_status,ST_AsGeoJSON(boundary)::jsonb AS geometry FROM objects
 WHERE id=ANY($1::uuid[]) AND ($2::uuid[] IS NULL OR id=ANY($2)) AND ($3::float8[] IS NULL OR ST_Intersects(boundary,ST_MakeEnvelope($3[1],$3[2],$3[3],$3[4],4326))) ORDER BY code LIMIT 500`,[objects,resources,bbox??null])).rows;
 const devices=a.role==='expert'?[]:(await c.query(`SELECT d.id,d.name,d.kind,d.model,d.object_id,p.version,p.verified,p.source,ST_AsGeoJSON(p.position)::jsonb AS geometry FROM devices d
 LEFT JOIN LATERAL(SELECT * FROM device_positions WHERE device_id=d.id ORDER BY version DESC LIMIT 1)p ON true WHERE d.object_id=ANY($1::uuid[]) ORDER BY d.id LIMIT 1000`,[objects])).rows;
 return {items,devices,crs:'EPSG:4326',limitations:['未核实边界不参与面积结论','地图邻近不证明设备归属或水力连通']};
}
