import {readApi,writeApi} from '@/platform/api';
import {AppError} from '@/platform/error';
import {createLot,createLocation} from '@/modules/inventory/catalog';
import {postMovement} from '@/modules/inventory/ledger';
import {recordPurchase,recordApplication} from '@/modules/inventory/inputs';
import {transformStock} from '@/modules/inventory/transforms';
import {packStock,handoff} from '@/modules/inventory/handoffs';
import {stockOverview,stockDetail,exportStock} from '@/modules/inventory/queries';
const handlers={lots:createLot,locations:createLocation,movements:postMovement,purchases:recordPurchase,applications:recordApplication,transformations:transformStock,packages:packStock,handoffs:handoff};
type Context={params:Promise<{section:string}>};
export async function GET(r:Request,ctx:Context){const {section}=await ctx.params,url=new URL(r.url);return readApi(r,(c,a)=>{
 if(section==='overview')return stockOverview(c,a,url.searchParams.get('objectId')??'');
 if(section==='lot')return stockDetail(c,a,url.searchParams.get('id')??'');
 throw new AppError(404,'STOCK_ENDPOINT','库存查询入口不存在');
});}
export async function POST(r:Request,ctx:Context){const {section}=await ctx.params;return writeApi(r,(c,a,b)=>{
 if(section==='export')return exportStock(c,a,b.objectId);
 const fn=handlers[section as keyof typeof handlers];if(!fn)throw new AppError(404,'STOCK_ENDPOINT','库存操作入口不存在');return fn(c,a,b);
},200,262144);}

