'use client';
import ReferenceField from './reference-field';
export type Option = {
    id: string;
    name?: string;
    code?: string;
    display_name?: string;
    username?: string;
    role?: string;
};
export function Field({ name, label, type = 'text', required = true }: {
    name: string;
    label: string;
    type?: string;
    required?: boolean;
}) { const kind=({objectId:'object',fromObjectId:'object',toObjectId:'object',deviceId:'device',pointId:'point',assigneeId:'person',recipientId:'person',userId:'person'} as Record<string,string>)[name];if(type==='text'&&kind)return <ReferenceField name={name} label={label} kind={kind} required={required}/>;return <label>{label}<input name={name} type={type} step={type === 'number' ? 'any' : undefined} required={required} maxLength={type === 'text' ? 2000 : undefined}/></label>; }
export function Pick({ name, label, options, required = true }: {
    name: string;
    label: string;
    options: Option[];
    required?: boolean;
}) { return <label>{label}<select name={name} aria-label={label} required={required} defaultValue=""><option value="">请选择</option>{options.map(o => <option value={o.id} key={o.id}>{o.name ?? o.display_name ?? o.username ?? o.code}{o.code ? ' · ' + o.code : ''}</option>)}</select></label>; }
