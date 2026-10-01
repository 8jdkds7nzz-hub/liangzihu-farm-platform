'use client';
import { useState } from 'react';
import { useApi } from '@/components/platform/use-api';
import ActionForm from '@/components/platform/action-form';
import { Field, Pick, type Option } from '@/components/platform/fields';
type Roster = {
    id: string;
    object_id: string;
    object_name: string;
    onsite_name: string;
    technician_name: string;
    owner_name: string;
    maintainer_name: string;
    starts_at: string;
    ends_at: string;
    night_shift: boolean;
    cancelled_at: string | null;
};
function PeopleFields({ objectId }: {
    objectId: string;
}) { const { data, error } = useApi<Option[]>('/api/v1/duty/people?objectId=' + encodeURIComponent(objectId)); if (error)
    return <p className="form-error">{error}</p>; if (!data)
    return <p>加载可安排人员…</p>; return <><Pick name="onsiteId" label="能到现场的当班人员" options={data.filter(u => ['worker', 'technician', 'owner'].includes(u.role ?? ''))}/><Pick name="technicianId" label="第二联系人：技术员" options={data.filter(u => ['technician', 'owner'].includes(u.role ?? ''))}/><Pick name="ownerId" label="第三联系人：负责人" options={data.filter(u => u.role === 'owner')}/><Pick name="maintainerId" label="监测中断时的维护人员" options={data.filter(u => ['maintainer', 'technician', 'owner'].includes(u.role ?? ''))}/></>; }
function ContactForm() { const { data, error } = useApi<Option[]>('/api/v1/identity/users'); if (error)
    return <p className="form-error">{error}</p>; if (!data)
    return null; return <ActionForm path="/api/v1/duty/contacts" booleans={['verified']}><Pick name="userId" label="人员" options={data}/><Pick name="channel" label="通知通道" options={[{ id: 'wecom', name: '企业微信成员标识' }, { id: 'voice', name: '电话' }]}/><Field name="address" label="已核实的成员标识或手机号"/><Field name="evidence" label="联系资料与通知用途核实依据"/><label><input name="verified" type="checkbox" required/>已核实此联系信息及使用用途</label></ActionForm>; }
export default function DutyPanel() {
    const me = useApi<{
        actor: {
            role: string;
        };
        scopes: {
            action: string;
            objectIds: string[];
        }[];
    }>('/api/v1/me'), objects = useApi<{
        items: Option[];
    }>('/api/v1/objects?limit=200'), rosters = useApi<Roster[]>('/api/v1/duty');
    const [selected, setSelected] = useState('');
    const error = me.error || objects.error || rosters.error;
    if (error)
        return <p className="form-error">{error}</p>;
    if (!me.data || !objects.data || !rosters.data)
        return <p>正在读取值班安排…</p>;
    const can = (id: string) => me.data!.scopes.some(s => s.action === 'configure' && s.objectIds.includes(id)), config = objects.data.items.filter(o => can(o.id));
    return <>{!!config.length && <details><summary>登记值班安排</summary><label>选择对象<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">请选择</option>{config.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>{selected && <ActionForm path="/api/v1/duty" times={['startsAt', 'endsAt']} numbers={['callTimeoutMs']} scales={{ callTimeoutMs: 1000 }} booleans={['nightShift', 'verified']} onSaved={() => void rosters.reload()}><input type="hidden" name="objectId" value={selected}/><PeopleFields objectId={selected}/><Field name="startsAt" label="值班开始" type="datetime-local"/><Field name="endsAt" label="值班结束" type="datetime-local"/><label><input name="nightShift" type="checkbox"/>这是已核实的夜班时段</label><Field name="callTimeoutMs" label="语音服务已核实的单次呼叫等待时限（秒；夜班必填）" type="number" required={false}/><Field name="evidence" label="值班表与语音等待时限依据"/><label><input name="verified" type="checkbox" required/>已核实人员能到场、时段与升级顺序</label></ActionForm>}</details>}
    {me.data.actor.role === 'admin' && <details><summary>配置加密联系人信息</summary><ContactForm /></details>}
    {!rosters.data.length && <p className="empty-state">尚无已登记值班安排；平台不能据此宣称夜间通知已经就绪。</p>}
    {rosters.data.map(r => <section className="rule-card" key={r.id}><h2>{r.object_name} · {r.night_shift ? '夜班' : '白班'}{r.cancelled_at ? ' · 已撤销' : ''}</h2><p>{new Date(r.starts_at).toLocaleString()}—{new Date(r.ends_at).toLocaleString()}</p><p>当班 {r.onsite_name} → 技术员 {r.technician_name} → 负责人 {r.owner_name}；维护 {r.maintainer_name}。</p>{!r.cancelled_at && can(r.object_id) && <ActionForm path="/api/v1/duty" method="DELETE" onSaved={() => void rosters.reload()} label="撤销此安排"><input type="hidden" name="id" value={r.id}/></ActionForm>}</section>)}
  </>;
}
