import type {PoolClient} from 'pg';import {AppError} from '../../platform/error';
export async function normalizePolygon(c:PoolClient,geometry:unknown,crs:number){
 if(![4326,4490,3857].includes(crs))throw new AppError(422,'CRS_UNSUPPORTED','仅接收EPSG4326、4490或3857');if(!geometry||typeof geometry!=='object'||JSON.stringify(geometry).length>500000)throw new AppError(400,'INVALID_GEOMETRY','请提供有效GeoJSON面');
 let g;try{g=(await c.query(`WITH g AS(SELECT ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1),$2),4326)) AS geom) SELECT ST_AsEWKT(geom) AS ewkt,ST_IsValid(geom) AS valid,ST_GeometryType(geom) AS kind,ST_IsEmpty(geom) AS empty,ST_XMin(geom::box3d) AS x1,ST_XMax(geom::box3d) AS x2,ST_YMin(geom::box3d) AS y1,ST_YMax(geom::box3d) AS y2 FROM g`,[JSON.stringify(geometry),crs])).rows[0];}catch{throw new AppError(400,'INVALID_GEOMETRY','GeoJSON或坐标无效');}
 if(!g?.valid||g.empty||g.kind!=='ST_MultiPolygon')throw new AppError(400,'INVALID_GEOMETRY','须为有效非空面边界');if(g.x1 < -180||g.x2>180||g.y1 < -90||g.y2>90)throw new AppError(400,'INVALID_COORDINATES','转换后经纬度超范围');return g.ewkt as string;
}
