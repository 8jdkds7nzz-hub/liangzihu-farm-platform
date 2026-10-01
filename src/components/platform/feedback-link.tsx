'use client';
import { usePathname } from 'next/navigation';
export default function FeedbackLink(){return <a href={'/feedback?from='+encodeURIComponent(usePathname())}>问题反馈</a>;}
