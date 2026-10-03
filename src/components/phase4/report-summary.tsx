'use client';
type Row=Record<string,any>;
const sections:[string,string,[string,string][]][]=[
 ['devices','设备与采集',[['registeredNow','生成时已登记设备'],['verifiedNow','已核实设备'],['canonicalObservations','窗口内规范观测'],['validObservations','有效规范观测'],['validObservationRate','有效规范观测占比']]],
 ['operations','现场作业',[['recordedInWindow','窗口内农事记录'],['reviewedRecords','已审核农事记录']]],
 ['quality','质量',[['reportsInWindow','窗口内检测报告'],['failedReportRecords','其中未通过报告'],['openCasesNow','生成时未结质量问题']]],
 ['scheduling','任务调度',[['tasksNow','生成时任务记录'],['pendingNow','未复核结束任务'],['overdueNow','其中已逾期'],['unknownDueDates','未登记期限']]],
 ['economics','经营记录',[['expenseRecords','窗口内费用条数'],['unknownAmountRecords','其中金额未知'],['knownRegisteredCny','已知登记费用元'],['recordedNetPaidCny','人工登记净实付元']]],
 ['service','农机服务',[['plannedOrdersInWindow','窗口内计划服务单'],['currentAccepted','生成时证据仍有效的验收'],['cancelledOrders','已取消服务单']]],
 ['risk','风险记录',[['openAlertRecordsNow','生成时未关闭告警'],['severeOpenRecordsNow','其中严重告警'],['openQualityCaseRecordsNow','未结质量问题']]],
];
export default function ReportSummary({report}:{report:Row}){const result=report.result;if(!result)return <p role="status">{report.state==='failed'?'计算未完成：'+report.error_code:'报告排队或计算中，请稍后刷新。'}</p>;return <><p>定义版本：{report.definition_version}；统计窗口：{report.from_at} 至 {report.to_at}（结束不含）。生成完成：{report.finished_at}。</p><div className="stack">{sections.map(([key,title,columns])=><section key={key}><h2>{title}</h2><dl>{columns.map(([name,label])=><div key={name}><dt>{label}</dt><dd>{result[key][name]===null?'未知／无分母':name==='validObservationRate'?(result[key][name]*100).toFixed(1)+'%':String(result[key][name])}</dd></div>)}</dl></section>)}</div>{result.limits.map((s:string)=><p className="hint" key={s}>{s}</p>)}</>;}
