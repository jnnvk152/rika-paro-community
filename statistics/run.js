import {observeStatistics,statisticsStatus} from './policy.js';
import {dayKey} from '../web/statistics.js';
export async function runStatistics(io){
 const now=io.now(),[stored,sample]=await Promise.all([io.runtime(),io.sample()]);
 let previous=stored.value?structuredClone(stored.value):null;
 // Publishing is idempotent and monotonic. A crash after the cursor commit is
 // repaired next tick; its consumption delta is never applied a second time.
 if(previous)for(const [date,record] of Object.entries(previous.pending||{}).slice(0,2))if(await io.publishDay(record))delete previous.pending[date];
 let cleanupDate=previous?.cleanupDate;
 if(cleanupDate!==dayKey(now)){try{if(await io.prune(now)!==false)cleanupDate=dayKey(now);}catch{/* Retry retention next minute; collection remains available. */}}
 const next=observeStatistics(previous,sample,now);
 if(!next)return {status:'unchanged'};
 if(cleanupDate)next.cleanupDate=cleanupDate;
 if(!await io.claim(next,stored.etag))return {status:'busy'};
 for(const record of [...Object.values(next.pending).slice(0,2),next.day])await io.publishDay(record);
 await io.publishStatus(statisticsStatus(next));
 return {status:next.lastReady?'recorded':'missing',date:next.day.date};
}
