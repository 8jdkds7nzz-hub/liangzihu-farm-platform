import InventoryPanel from './panel';
export default function Page(){return <section className="workspace"><p className="eyebrow">生产业务 / 投入品与采收</p><h1>库存与批次</h1><p className="hint">采购、入库、领用和实际施用分别记录。库存按批次与仓位核算，放行结论由质量审核确认。</p><InventoryPanel/></section>;}

