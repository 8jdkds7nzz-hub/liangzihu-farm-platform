const stages = [
  { number: '1a', title: '基础平台与监测告警', text: '从可信测值到通知、认领与核查，让每次处理留下依据。' },
  { number: '1b', title: '现场作业与影像管理', text: '把农事、任务、照片和航次成果关联到同一个生产对象。' },
  { number: '1c', title: '分析与智能助手', text: '由程序计算指标，技术员审核有依据的简报与建议。' },
];

export default function Home() {
  return (
    <main>
      <header><span className="brand">梁子湖 · 智慧农业</span><span className="badge">开发基座</span></header>
      <section className="intro">
        <p className="eyebrow">当前工作项 A00</p>
        <h1>让现场数据<br />成为可核查的行动依据。</h1>
        <p className="lead">独立项目已建立。接下来按一期计划推进账号权限、设备台账与监测告警。</p>
        <a className="health-link" href="/api/v1/health/live">查看应用存活检查 <span aria-hidden="true">↗</span></a>
      </section>
      <section aria-label="一期实施路径" className="stages">
        {stages.map(stage => <article key={stage.number}>
          <span className="number">{stage.number}</span><h2>{stage.title}</h2><p>{stage.text}</p>
        </article>)}
      </section>
      <footer><strong>当前范围</strong><span>A00基础工程。业务功能、设备接入和生产验收将按后续工作项推进。</span></footer>
    </main>
  );
}
