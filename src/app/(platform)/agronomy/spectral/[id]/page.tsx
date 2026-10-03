import ItemDetail from '@/components/phase3/item-detail';export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <section className="workspace"><h1>多光谱授权资料</h1><ItemDetail kind="spectral" id={id}/></section>;}

