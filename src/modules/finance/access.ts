import type {PoolClient} from 'pg';import type {Action,Actor} from '../../platform/types';import {AppError} from '../../platform/error';import {access} from '../phase4/common';
export function financialRole(a:Actor){if(!['owner','technician','admin'].includes(a.role))throw new AppError(403,'FINANCE_ROLE','费用与经营明细仅向有对象授权的负责人、技术员或管理员开放');}
export async function financeAccess(c:PoolClient,a:Actor,id:unknown,action:Action='read'){financialRole(a);await access(c,a,id,action);}
