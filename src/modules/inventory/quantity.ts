import {AppError} from '../../platform/error';
const SCALE=1000000n,MAX=1000000000n*SCALE;
export function decimal(v:bigint):string {
 const sign=v<0n?'-':'';v=v<0n?-v:v;
 const tail=(v%SCALE).toString().padStart(6,'0').replace(/0+$/,'');
 return sign+(v/SCALE).toString()+(tail?'.'+tail:'');
}
export function quantity(value:unknown,unit?:string):string {
 const s=typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?value:'';
 if(!/^\d{1,16}(\.\d{1,6})?$/.test(s))throw new AppError(400,'QUANTITY_INVALID','数量须为非负十进制数，最多六位小数；未知不能填0');
 const [whole,fraction='']=s.split('.'),v=BigInt(whole)*SCALE+BigInt(fraction.padEnd(6,'0'));
 if(v>MAX||unit==='piece'&&v%SCALE!==0n)throw new AppError(400,'QUANTITY_INVALID','数量超限或件数不是整数');
 return decimal(v);
}
export function micros(v:unknown):bigint {
 const [w,f='']=quantity(v).split('.');return BigInt(w)*SCALE+BigInt(f.padEnd(6,'0'));
}
export function positive(value:unknown,unit?:string){const n=quantity(value,unit);if(n==='0')throw new AppError(400,'QUANTITY_POSITIVE','过账数量必须大于0');return n;}
export function signedMicros(value:string):bigint{
 if(!/^-?\d+(\.\d{1,6})?$/.test(value))throw new AppError(400,'QUANTITY_INVALID','内部数量口径无效');
 const negative=value.startsWith('-'),[w,f='']=(negative?value.slice(1):value).split('.');
 const result=BigInt(w)*SCALE+BigInt(f.padEnd(6,'0'));return negative?-result:result;
}
