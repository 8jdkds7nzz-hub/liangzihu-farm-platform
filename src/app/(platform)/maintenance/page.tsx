import MaintenancePanel from './maintenance-panel';
export default function MaintenancePage() { return <section className="workspace"><h1>维护、复测与导出</h1><p className="hint">按实际发生时间记录，校准写清原参数和调整结果。更正追加，不覆盖原值；手持复测独立于在线测值。</p><MaintenancePanel /></section>; }
