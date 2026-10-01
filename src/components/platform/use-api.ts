'use client';
import { useCallback, useEffect, useState } from 'react';
export function useApi<T>(path: string) {
    const [data, setData] = useState<T | null>(null), [error, setError] = useState('');
    const reload = useCallback(async () => { try {
        const r = await fetch(path, { cache: 'no-store' });
        const d = await r.json();
        if (!r.ok)
            throw Error(d.message ?? '读取失败');
        setData(d);
        setError('');
    }
    catch (e) {
        setData(null);
        setError(e instanceof TypeError ? '网络不可用，读取未完成，请恢复后重试。' : e instanceof Error ? e.message : '读取失败');
    } }, [path]);
    useEffect(() => { void reload(); }, [reload]);
    return { data, error, reload };
}
