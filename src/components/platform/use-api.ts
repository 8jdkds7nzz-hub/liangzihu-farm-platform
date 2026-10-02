'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
export function useApi<T>(path: string) {
    const [data, setData] = useState<T | null>(null), [error, setError] = useState(''),[loading,setLoading]=useState(true),sequence=useRef(0),loadedPath=useRef(''),controller=useRef<AbortController|null>(null);
    const reload = useCallback(async () => { controller.current?.abort();const abort=new AbortController();controller.current=abort;const request=++sequence.current;setLoading(true);setError('');if(loadedPath.current!==path)setData(null);loadedPath.current=path;try {
        const r = await fetch(path, { cache: 'no-store',signal:abort.signal });
        const d = await r.json();
        if (!r.ok)
            throw Error(d.message ?? '读取失败');
        if(request===sequence.current){setData(d);setError('');}
    }
    catch (e) {
        if(!abort.signal.aborted&&request===sequence.current){setData(null);setError(e instanceof TypeError ? '网络不可用，读取未完成，请恢复后重试。' : e instanceof Error ? e.message : '读取失败');}
    } finally{if(request===sequence.current&&!abort.signal.aborted)setLoading(false);} }, [path]);
    useEffect(() => { void reload();return()=>{sequence.current++;controller.current?.abort();}; }, [reload]);
    return { data:loadedPath.current===path?data:null, error, loading, reload };
}
