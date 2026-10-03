'use client';
import { useContext, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {ActorSnapshot} from './actor-snapshot';
export default function ActionForm({ path, children, method = 'POST', numbers = [], times = [], booleans = [], nullableBooleans = [], jsonFields = [], multiFields = [], scales = {}, onSaved, stableKey = false, label = '保存' }: {
    path: string;
    children: ReactNode;
    method?: string;
    numbers?: string[];
    times?: string[];
    booleans?: string[];
    nullableBooleans?: string[];
    jsonFields?: string[];
    multiFields?: string[];
    scales?: Record<string, number>;
    onSaved?: () => void;
    stableKey?: boolean;
    label?: string;
}) {
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
    const key = useRef<string | null>(null);
    const actorId=useContext(ActorSnapshot),actorAtOpen=useRef(actorId);
    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setBusy(true);
        setError('');
        setMessage('');
        const form = e.currentTarget;
        try {
            const data: Record<string, unknown> = Object.fromEntries(new FormData(form));
            for(const name of multiFields)data[name]=new FormData(form).getAll(name);
            if(actorAtOpen.current&&/^\/api\/v1\/(inventory|traceability|protection|agronomy|control-records)\//.test(path))data.expectedActorId=actorAtOpen.current;
            for (const name of numbers) {
                if (data[name] === '')
                    delete data[name];
                else
                    data[name] = Number(data[name]);
            }
            for (const [name, scale] of Object.entries(scales))
                if (typeof data[name] === 'number')
                    data[name] = (data[name] as number) * scale;
            for (const name of times) {
                if (data[name] === '')
                    delete data[name];
                else
                    data[name] = new Date(String(data[name])).toISOString();
            }
            for (const name of booleans)
                data[name] = data[name] === 'on';
            for(const name of nullableBooleans)data[name]=data[name]==='yes'?true:data[name]==='no'?false:null;
            for (const name of jsonFields)
                data[name] = JSON.parse(String(data[name]));
            if (stableKey) {
                key.current ??= crypto.randomUUID();
                data.requestKey = key.current;
            }
            const headers: Record<string,string> = { 'Content-Type': 'application/json' };
            if(actorAtOpen.current)headers['X-Expected-Actor-Id']=actorAtOpen.current;
            const response = await fetch(path, { method, headers, body: JSON.stringify(data) });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.message ?? '操作未完成');
            let partialFailure = false;
            if (Array.isArray(result.rows)) {
                const failures = result.rows.filter((r: {
                    ok: boolean;
                }) => !r.ok);
                partialFailure = failures.length > 0;
                setMessage(`已导入${result.rows.length - failures.length}行；${failures.length}行未导入。` + failures.map((r: {
                    row: number;
                    message: string;
                }) => `第${r.row}行：${r.message}`).join('；'));
            }
            else
                setMessage('已保存');
            key.current = null;
            if(!partialFailure)form.reset();
            onSaved?.();
        }
        catch (e) {
            setError(e instanceof TypeError ? '网络不可用，尚未确认保存，请恢复网络后重试。' : e instanceof Error ? e.message : '操作未完成，请重试');
        }
        finally {
            setBusy(false);
        }
    }
    return <form className="business-form" onSubmit={submit}>{children}<button disabled={busy}>{busy ? '正在提交…' : label}</button>{error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}</form>;
}
