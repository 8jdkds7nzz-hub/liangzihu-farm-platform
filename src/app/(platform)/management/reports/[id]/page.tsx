import ReportDetail from './report-detail';export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <><h1>管理报告授权资料</h1><ReportDetail id={id}/></>;}
