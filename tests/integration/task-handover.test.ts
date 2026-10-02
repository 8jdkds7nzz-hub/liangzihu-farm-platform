import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {withDb} from '../support/db';import {actorFixture,objectFixture,permit} from '../support/fixtures';import {transaction} from '../../src/db/pool';import {createTask,transitionTask} from '../../src/modules/tasks/service';
test('T08重新指派甲到乙，撤销旧领取资格并保留交班历史',()=>withDb(async pool=>{
 const tech=await actorFixture(pool,'technician'),a=await actorFixture(pool,'worker'),b=await actorFixture(pool,'worker'),objectId=await objectFixture(pool,tech.id);await permit(pool,tech.id,objectId,['read','record','dispatch']);for(const w of [a,b])await permit(pool,w.id,objectId,['read','record','claim']);let task=await transaction(c=>createTask(c,tech,{objectId,title:'合成交班',instructions:'现场核查',kind:'inspection',requestKey:randomUUID()}),pool);
 const action=(who:typeof tech,kind:string,extra:Record<string,unknown>={})=>transaction(c=>transitionTask(c,who,{id:task.id,version:task.version,action:kind,note:'合成交班依据',requestKey:randomUUID(),...extra}),pool);
 task=await action(tech,'dispatch',{assigneeId:a.id,confirm:true});task=await action(a,'claim');const oldVersion=task.version;
 await assert.rejects(()=>action(a,'reassign',{assigneeId:b.id,confirm:true}),{status:403});task=await action(tech,'reassign',{assigneeId:b.id,confirm:true});assert.equal(task.assignee_id,b.id);assert.equal(task.claimed_by,null);assert.equal(task.state,'dispatched');
 await assert.rejects(()=>transaction(c=>transitionTask(c,a,{id:task.id,version:oldVersion,action:'report',note:'旧反馈',requestKey:randomUUID()}),pool),{code:'VERSION_CONFLICT'});task=await action(b,'claim');await assert.rejects(()=>action(a,'report'),{code:'TASK_REPORT'});
 const event=(await pool.query("SELECT payload FROM field_task_events WHERE task_id=$1 AND action='reassign'",[task.id])).rows[0].payload;assert.equal(event.previousAssigneeId,a.id);assert.equal(event.previousClaimedBy,a.id);
}));
