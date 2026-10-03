import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { resolveSession, SESSION_COOKIE } from '@/modules/identity/session';
import { AppError } from '@/platform/error';
import AppShell from '@/components/platform/app-shell';
import ActorSnapshotProvider from '@/components/platform/actor-snapshot';
export default async function PlatformLayout({ children }: {
    children: ReactNode;
}) {
    let actor;
    try {
        actor = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value ?? '');
    }
    catch (e) {
        if (e instanceof AppError && e.status === 401)
            redirect('/login');
        return <main><h1>暂时无法连接平台</h1><p>请稍后刷新；当前没有确认任何保存操作。</p></main>;
    }
    return <ActorSnapshotProvider actorId={actor.id}><AppShell role={actor.role}>{children}</AppShell></ActorSnapshotProvider>;
}
