import PublicationPanel from './panel';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <><h1>已分享简报</h1><PublicationPanel id={id}/></>;}
