import {AppError} from '../../platform/error';import {quantity,micros,decimal} from '../inventory/quantity';
export function money(v:unknown,allowZero=true){const q=quantity(v),n=micros(q);if(n%10000n!==0n||!allowZero&&n===0n)throw new AppError(400,'MONEY_INVALID','人民币金额最多两位小数，付款和申领须大于0');return decimal(n);}
export const cents=(v:unknown)=>micros(money(v))/10000n;
export const yuan=(v:bigint)=>decimal(v*10000n);
export const pricedAmount=(quantityValue:unknown,unitPrice:unknown)=>yuan((micros(quantityValue)*cents(unitPrice)+500000n)/1000000n);
