import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { resolveSession, SESSION_COOKIE } from '@/modules/identity/session';
import { AppError } from '@/platform/error';
import FeedbackLink from '@/components/platform/feedback-link';
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
    return <main><header><a className="brand" href="/objects">梁子湖 · 智慧农业</a><a href="/account">我的账号</a></header><nav className="platform-nav"><a href="/objects">对象台账</a><a href="/map">二维地图</a><a href="/records">农事与照片</a><a href="/tasks">任务与日历</a><a href="/imagery">监控与航次</a><a href="/analysis">分析复盘</a><a href="/knowledge">知识资料</a><a href="/assistant">权限内问答</a><a href="/briefings">简报审阅</a><a href="/devices">设备与测点</a><a href="/alerts">告警与核查</a><a href="/rules">规则审核</a><a href="/duty">值班安排</a><a href="/maintenance">维护与复测</a>{actor.role === 'admin' && <a href="/operations">运行与费用</a>}<a href="/settings">配置管理</a><a href="/help">操作帮助</a><FeedbackLink/></nav>{children}</main>;
}
