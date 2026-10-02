const stages = [
  { number: '01', title: '监测与现场核查', text: '从可信测值到通知、认领与核查，让每次处理留下依据。' },
  { number: '02', title: '作业与空间资料', text: '把农事、任务、照片和航次成果关联到同一个生产对象。' },
  { number: '03', title: '分析与专业协作', text: '由程序计算指标，技术员审核有依据的简报与建议。' },
];

export default function Home() {
  return (
    <main>
      <header><span className="brand">梁子湖 · 智慧农业</span><span className="badge">农场工作空间</span></header>
      <section className="intro">
        <p className="eyebrow">现场 · 资料 · 协作</p>
        <h1>让现场数据<br />成为可核查的行动依据。</h1>
        <p className="lead">使用已开通的账号管理台账、查看告警、记录农事与核查、检索资料和审阅简报。真实设备、通知渠道和生产恢复链仍待联调验收。</p>
        <a className="health-link" href="/login">登录工作空间 <span aria-hidden="true">↗</span></a>
      </section>
      <section aria-label="工作入口" className="stages">
        {stages.map(stage => <article key={stage.number}>
          <span className="number">{stage.number}</span><h2>{stage.title}</h2><p>{stage.text}</p>
        </article>)}
      </section>
      <footer><strong>使用说明</strong><span>按已授予范围访问业务和资料。现场设备、通知渠道与生产灾备须完成验收后投用。</span></footer>
    </main>
  );
}
