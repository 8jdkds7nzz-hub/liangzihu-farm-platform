const stages = [
  { number: '1a', title: '基础平台与监测告警', text: '从可信测值到通知、认领与核查，让每次处理留下依据。' },
  { number: '1b', title: '现场作业与影像管理', text: '把农事、任务、照片和航次成果关联到同一个生产对象。' },
  { number: '1c', title: '分析与智能助手', text: '由程序计算指标，技术员审核有依据的简报与建议。' },
];

export default function Home() {
  return (
    <main>
      <header><span className="brand">梁子湖 · 智慧农业</span><span className="badge">一期建设中</span></header>
      <section className="intro">
        <p className="eyebrow">一期1a · 本地验证版</p>
        <h1>让现场数据<br />成为可核查的行动依据。</h1>
        <p className="lead">使用已开通的账号管理台账、查看告警、记录核查与维护。真实设备、通知渠道和生产恢复链仍待联调验收。</p>
        <a className="health-link" href="/login">进入平台 <span aria-hidden="true">↗</span></a>
      </section>
      <section aria-label="一期实施路径" className="stages">
        {stages.map(stage => <article key={stage.number}>
          <span className="number">{stage.number}</span><h2>{stage.title}</h2><p>{stage.text}</p>
        </article>)}
      </section>
      <footer><strong>当前范围</strong><span>1a程序与本地验证。真实企业微信、电话和设备接入尚未验收；继续保留现场值守。</span></footer>
    </main>
  );
}
