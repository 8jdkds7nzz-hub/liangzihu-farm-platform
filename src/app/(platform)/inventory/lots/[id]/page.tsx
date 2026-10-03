import ItemDetail from '@/components/phase3/item-detail';export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <section className="workspace"><h1>批次授权资料</h1><ItemDetail kind="lot" id={id}/></section>;}

