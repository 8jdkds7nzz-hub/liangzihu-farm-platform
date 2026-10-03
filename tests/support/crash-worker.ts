import pg from 'pg';import {requireTestDatabaseUrl} from './db';import {claimJob} from '../../src/modules/jobs/repository';
const schema=process.env.TEST_CRASH_SCHEMA;if(!schema||!/^test_[a-f0-9]{32}$/.test(schema))throw Error('TEST_SCHEMA_REQUIRED');
const pool=new pg.Pool({connectionString:requireTestDatabaseUrl(),max:1,options:'-c search_path='+schema+',public'});
const lease=await claimJob(pool,'controlled-crash-worker',new Date(),{businessKey:process.env.TEST_CRASH_KEY,leaseMs:1000});
process.stdout.write(JSON.stringify(lease)+'\n');setInterval(()=>{},1000);
