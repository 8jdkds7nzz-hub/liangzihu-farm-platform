'use client';
import { useCallback,useEffect,useState } from 'react';
import ActionForm from '@/components/platform/action-form';
type Option={id:string;name?:string;code?:string;display_name?:string;username?:string;role?:string};
function Field({name,label,type='text',required=true}:{name:string;label:string;type?:string;required?:boolean}){return <label>{label}<input name={name} type={type} required={required} maxLength={type==='text'?1000:undefined}/></label>;}
function Pick({name,label,options,required=true}:{name:string;label:string;options:Option[];required?:boolean}){return <label>{label}<select name={name} required={required} defaultValue=""><option value="">请选择</option>{options.map(o=><option value={o.id} key={o.id}>{o.name??o.display_name??o.username??o.code}{o.code?' · '+o.code:''}</option>)}</select></label>;}
const types=[{id:'pond',name:'塘口'},{id:'field',name:'地块'},{id:'channel',name:'渠道'},{id:'facility',name:'设施'},{id:'farm',name:'子场区'}];
const roles=[{id:'admin',name:'系统管理员'},{id:'owner',name:'农场负责人'},{id:'technician',name:'技术员'},{id:'worker',name:'一线工人'},{id:'maintainer',name:'维护人员'},{id:'expert',name:'外部专家'}];
const actions=[{id:'read',name:'查看'},{id:'record',name:'记录'},{id:'claim',name:'认领'},{id:'close_alert',name:'关闭告警'},{id:'review',name:'专业审核'},{id:'dispatch',name:'派单'},{id:'share',name:'分享'},{id:'configure',name:'配置'},{id:'export',name:'导出'},{id:'act',name:'动作权限（当前无设备控制）'}];
export default function RegistrySettings(){
  const [objects,setObjects]=useState<Option[]>([]),[sources,setSources]=useState<Option[]>([]),[devices,setDevices]=useState<Option[]>([]),[points,setPoints]=useState<Option[]>([]),[users,setUsers]=useState<Option[]>([]);
  const [grants,setGrants]=useState<{id:string;user_id:string;object_id:string;action:string;revoked_at:string|null;expires_at:string|null}[]>([]);
  const [isAdmin,setAdmin]=useState(false),[self,setSelf]=useState(''),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
  const load=useCallback(async()=>{try{
    async function get(path:string){const r=await fetch('/api/v1/'+path);const d=await r.json();if(!r.ok)throw Error(d.message??'读取失败');return d;}
    const me=await get('me');setAdmin(me.actor.role==='admin');setSelf(me.actor.id);
    const [o,s,d,p]=await Promise.all([get('objects?action=configure&limit=200'),get('sources'),get('devices?limit=200'),get('points')]);
    setObjects(o.items);setSources(s);setDevices(d.items);setPoints(p);
    if(me.actor.role==='admin'){const [u,g]=await Promise.all([get('identity/users'),get('identity/grants')]);setUsers(u);setGrants(g);}
    setLoaded(true);setError('');
  }catch(e){setError(e instanceof Error?e.message:'读取失败');}},[]);
  useEffect(()=>{void load();},[load]);
  if(error)return <p className="form-error" role="alert">{error}</p>;
  if(!loaded)return <p>正在加载配置权限…</p>;
  const saved=()=>void load();const obj=(name='objectId',label='所属对象')=><Pick name={name} label={label} options={objects}/>;
  return <>
    {!objects.length&&<p className="empty-state">当前没有对象配置授权。请由管理员分配；首次本机安装须先初始化场区入口。</p>}
    <details open><summary>登记地块、塘口或设施</summary><ActionForm path="/api/v1/objects" onSaved={saved}>{obj('parentId','上级场区')}<Field name="code" label="对象编号"/><Field name="name" label="名称"/><Pick name="kind" label="类型" options={types}/><Field name="source" label="登记依据（图纸、记录或现场核对）"/></ActionForm></details>
    <details><summary>登记数据来源</summary><ActionForm path="/api/v1/sources" onSaved={saved}>{obj()}<Field name="code" label="来源编号"/><Field name="name" label="来源名称"/><Field name="provider" label="厂家或服务方"/><Field name="contractRef" label="接口资料位置（可后补）" required={false}/></ActionForm></details>
    <details><summary>登记设备与核实</summary><ActionForm path="/api/v1/devices" onSaved={saved}>{obj()}<Pick name="sourceId" label="数据来源" options={sources}/><Field name="externalId" label="厂家设备编号"/><Field name="name" label="设备名称"/><Pick name="kind" label="登记类别" options={[{id:'physical',name:'物理设备'},{id:'gateway',name:'网关'},{id:'camera_channel',name:'摄像通道'}]}/><Pick name="parentDeviceId" label="上级设备（摄像通道必填）" options={devices} required={false}/><Field name="model" label="型号" required={false}/><Field name="serialNumber" label="序列号" required={false}/><Field name="source" label="资料或盘点依据"/></ActionForm>
      <ActionForm path="/api/v1/devices" method="PATCH" onSaved={saved} label="确认已现场核实"><Pick name="id" label="已核对设备" options={devices}/><Field name="evidence" label="现场核实记录或依据"/></ActionForm></details>
    <details><summary>登记测点与时效依据</summary><ActionForm path="/api/v1/points" numbers={['maxAgeMs','maxGapMs']} onSaved={saved}><Pick name="deviceId" label="所属设备" options={devices}/><Field name="code" label="测点编号"/><Field name="name" label="名称"/><Field name="metric" label="指标代号（依据接口资料）"/><Field name="unit" label="单位（保留原单位）"/><p className="hint">没有审核时效资料时，下面三项均留空，系统将显示“时效未配置”。</p><Field name="maxAgeMs" label="测值新鲜度时限（毫秒）" type="number" required={false}/><Field name="maxGapMs" label="允许采样间隔（毫秒）" type="number" required={false}/><Field name="timingSource" label="时效配置依据与审核记录" required={false}/></ActionForm></details>
    <details><summary>测点绑定或换塘</summary><ActionForm path="/api/v1/points/bindings" times={['validFrom','validTo']} booleans={['verified','endPrevious']} onSaved={saved}><Pick name="pointId" label="测点" options={points}/>{obj('objectId','测点对应对象')}<Field name="validFrom" label="生效时间（当地时间）" type="datetime-local"/><Field name="validTo" label="结束时间（可留空）" type="datetime-local" required={false}/><Field name="evidence" label="绑定或换塘依据"/><label><input name="verified" type="checkbox"/>已由人员现场核实对应关系</label><label><input name="endPrevious" type="checkbox"/>同时在生效时点结束上一段绑定</label></ActionForm></details>
    <details><summary>登记生产批次</summary><ActionForm path="/api/v1/batches" times={['startedAt','endedAt']} booleans={['verified']} onSaved={saved}>{obj()}<Field name="code" label="批次编号"/><Field name="species" label="物种"/><Field name="variety" label="品种（可后补）" required={false}/><Field name="stage" label="阶段"/><Field name="source" label="物种与阶段依据"/><Field name="startedAt" label="开始时间" type="datetime-local"/><Field name="endedAt" label="结束时间（可留空）" type="datetime-local" required={false}/><label><input name="verified" type="checkbox"/>物种与阶段已经现场核实</label></ActionForm></details>
    {isAdmin&&<>
      <details><summary>开通人员账号</summary><ActionForm path="/api/v1/identity/users" onSaved={saved}><Field name="username" label="登录账号（字母、数字或.-_@）"/><Field name="displayName" label="姓名"/><Field name="password" label="初始密码（至少12个字符）" type="password"/><Pick name="role" label="角色" options={roles}/></ActionForm><ActionForm path="/api/v1/identity/users" method="DELETE" onSaved={saved} label="停用账号并撤回授权"><Pick name="userId" label="需要停用的人员" options={users.filter(u=>u.id!==self)}/></ActionForm></details>
      <details><summary>人员对象授权与撤回</summary><ActionForm path="/api/v1/identity/grants" times={['expiresAt']} onSaved={saved}><Pick name="userId" label="人员" options={users}/>{obj('objectId','授权对象')}<Pick name="action" label="允许操作" options={actions}/><Field name="expiresAt" label="到期时间（可留空）" type="datetime-local" required={false}/></ActionForm>
        {grants.filter(g=>!g.revoked_at).map(g=><ActionForm key={g.id} path="/api/v1/identity/grants" method="DELETE" onSaved={saved} label="撤回此授权"><input type="hidden" name="grantId" value={g.id}/><p>{users.find(u=>u.id===g.user_id)?.display_name??'已登记人员'} · {objects.find(o=>o.id===g.object_id)?.name??'其他已登记对象'} · {actions.find(a=>a.id===g.action)?.name??g.action}</p><p className="hint">到期：{g.expires_at?new Date(g.expires_at).toLocaleString():'未设定'}</p></ActionForm>)}</details>
    </>}
  </>;
}
