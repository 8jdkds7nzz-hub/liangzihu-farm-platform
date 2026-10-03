import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {access,exportTables} from '../phase4/common';
export const energyTables=['energy_meters','energy_meter_reviews','energy_readings'] as const;
export async function energyOverview(c:PoolClient,a:Actor,objectId:string){await access(c,a,objectId,'read');return {
 meters:(await c.query(`SELECT m.*,COALESCE((SELECT action='approve' FROM energy_meter_reviews WHERE meter_id=m.id ORDER BY seq DESC LIMIT 1),false) AND d.verified AND d.object_id=m.object_id AND NOT EXISTS(SELECT 1 FROM energy_meters n WHERE n.supersedes_id=m.id) AS verified FROM energy_meters m JOIN devices d ON d.id=m.device_id WHERE m.object_id=$1 ORDER BY m.created_at DESC,m.id LIMIT 200`,[objectId])).rows,
 readings:(await c.query('SELECT r.*,NOT EXISTS(SELECT 1 FROM energy_readings n WHERE n.supersedes_id=r.id) AS current FROM energy_readings r WHERE object_id=$1 ORDER BY observed_at DESC,version DESC,id LIMIT 200',[objectId])).rows,
 devices:(await c.query("SELECT id,name,external_id FROM devices WHERE object_id=$1 AND kind='physical' ORDER BY name,id LIMIT 200",[objectId])).rows,
 points:(await c.query('SELECT DISTINCT p.id,p.name,p.metric,p.unit FROM points p JOIN point_bindings b ON b.point_id=p.id WHERE b.object_id=$1 AND b.verified AND b.valid_from<=clock_timestamp() AND (b.valid_to IS NULL OR b.valid_to>clock_timestamp()) ORDER BY p.name,p.id LIMIT 200',[objectId])).rows,
 limit:200,externalAdapter:'not_implemented_pending_procurement',unitNote:'录入已核换算后的kW/kWh/%，换算依据写入原记录；不从功率推算电量或控制负载'};}
export const exportEnergy=(c:PoolClient,a:Actor,id:string)=>exportTables(c,a,id,energyTables);
