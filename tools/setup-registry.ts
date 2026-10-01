import { transaction,closePool } from '../src/db/pool';
async function main(){
  await transaction(async c=>{
    if((await c.query('SELECT current_database() AS name')).rows[0].name!=='agri_dev')throw new Error('仅初始化开发库');
    const user=(await c.query("SELECT id FROM users WHERE username='farm-admin' AND role='admin' AND enabled")).rows[0];
    if(!user)throw new Error('请先初始化管理员');
    await c.query('LOCK TABLE objects IN SHARE ROW EXCLUSIVE MODE');
    if((await c.query("SELECT 1 FROM objects WHERE code='LZH-ROOT'")).rowCount){console.log('场区入口已存在，未重复创建或修改授权。');return;}
    const root=(await c.query("INSERT INTO objects(code,name,kind,source,created_by) VALUES('LZH-ROOT','梁子湖农场','farm','平台项目入口；边界、地块和设备仍待现场核实',$1) RETURNING *",[user.id])).rows[0];
    for(const action of ['read','configure'])await c.query('INSERT INTO grants(user_id,object_id,action,created_by) VALUES($1,$2,$3,$1)',[user.id,root.id,action]);
    await c.query("INSERT INTO object_versions(object_id,version,snapshot,reason,created_by) VALUES($1,1,$2,'受控初始化',$3)",[root.id,{code:root.code,name:root.name,kind:'farm',boundaryStatus:'unknown'},user.id]);
    await c.query("INSERT INTO audit_events(event_type,target_id) VALUES('local_farm_bootstrapped',$1)",[root.id]);
    console.log('已创建场区入口及管理员查看/配置授权；没有导入未经核实的物理设备或阈值。');
  });
}
main().catch(()=>{console.error('场区初始化未完成，请核对开发库、迁移和初始管理员。');process.exitCode=1;}).finally(closePool);
