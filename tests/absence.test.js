import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeDate,reminderAt,absenceEntry,reminderDue,effectiveAbsence,absenceScheduleStatus,completedAbsenceEntry} from '../web/absence.js';
test('return reminders stay at 19:00 Ljubljana on either side of daylight saving changes',()=>{
 assert.equal(new Date(reminderAt('2026-10-25')).toISOString(),'2026-10-24T17:00:00.000Z');
 assert.equal(new Date(reminderAt('2026-10-26')).toISOString(),'2026-10-25T18:00:00.000Z');
 assert.equal(new Date(reminderAt('2027-03-29')).toISOString(),'2027-03-28T17:00:00.000Z');
 assert.equal(homeDate(Date.parse('2026-10-24T22:30Z')),'2026-10-25');
});
test('a changed return date gets a new reminder identity; confirmation and unknown dates prevent reminders',()=>{
 const now=Date.parse('2026-10-24T12:00Z'),p=absenceEntry(null,{returnDate:'2026-10-26'},'owner',now);
 assert.equal(reminderDue(p,Date.parse('2026-10-25T17:59Z')),false);assert.equal(reminderDue(p,Date.parse('2026-10-25T18:00Z')),true);
 assert.equal(reminderDue(p,Date.parse('2026-10-25T22:59Z')),true);assert.equal(reminderDue(p,Date.parse('2026-10-25T23:00Z')),false);
 const yes=absenceEntry(p,{returnDate:p.returnDate,confirmation:'confirmed'},'owner',now);assert.equal(yes.id,p.id);assert.equal(reminderDue(yes,Date.parse('2026-10-25T20:00Z')),false);
 const changed=absenceEntry(p,{returnDate:'2026-10-27'},'owner',now);assert.notEqual(changed.id,p.id);assert.equal(changed.revision,2);
 const unknown=absenceEntry(changed,{returnDate:''},'owner',now);assert.equal(unknown.remindAt,0);assert.equal(unknown.confirmation,'unknown');
 assert.throws(()=>absenceEntry(null,{returnDate:'2026-02-30'},'owner',now));assert.throws(()=>absenceEntry(null,{returnDate:'2026-10-23'},'owner',now));
});
test('only a matching durable module receipt completes absence; a new date immediately becomes active again',()=>{
 const p={id:'a',active:true,returnDate:'2026-11-16',revision:7};
 const state={device:{capabilities:{return_schedule:true}},home:{return:{id:'a',return_date:p.returnDate,status:'completed',durable:true,revision:7}}};
 assert.equal(effectiveAbsence(p,state).active,false);assert.equal(p.active,true);
 for(const patch of [{id:'old'},{return_date:'2026-11-17'},{status:'starting'},{status:'unconfirmed'},{durable:false}])assert.equal(effectiveAbsence(p,{...state,home:{return:{...state.home.return,...patch}}}).active,true);
 assert.equal(effectiveAbsence({...p,id:'new',returnDate:'2026-11-17',revision:8},state).active,true);
 assert.equal(effectiveAbsence(p,{...state,device:{capabilities:{}}}).active,true);
});
test('return status distinguishes unsupported firmware, pending dates, manual cancellation and confirmed return',()=>{
 const p={id:'a',active:true,returnDate:'2026-11-16',revision:7,confirmation:'pending'},comfort={enabled:true,day_start_minute:360};
 const r={id:'a',return_date:p.returnDate,status:'armed',durable:true,revision:7,reason:'scheduled'};
 const state={device:{capabilities:{return_schedule:true}},home:{return:r}};
 const check=(change={})=>absenceScheduleStatus(p,{...state,home:{return:{...r,...change}}},comfort,true);
 assert.equal(check().kind,'armed');assert.match(check().message,/06:00/);assert.match(check().message,/do not need to answer/);
 assert.equal(check({id:'old'}).kind,'waiting');assert.equal(check({revision:6}).kind,'waiting');
 for(const [status,kind] of [['completed','completed'],['starting','starting'],['cancelled','cancelled'],['missed','missed'],['unconfirmed','unconfirmed'],['clock_not_ready','clock'],['storage_unavailable','storage']])assert.equal(check({status}).kind,kind);
 assert.equal(absenceScheduleStatus(p,{device:{capabilities:{}}},comfort,true).kind,'unsupported');
 assert.equal(absenceScheduleStatus(p,state,comfort,false).kind,'waiting');
 assert.equal(absenceScheduleStatus({...p,returnDate:''},state,comfort,true).kind,'unknown');
 assert.equal(absenceScheduleStatus(p,state,{...comfort,enabled:false},true).kind,'disabled');
});
test('a completed return gets a new inactive identity before a later absence can be scheduled',()=>{
 const now=Date.parse('2026-11-16T07:00Z'),p=absenceEntry(null,{returnDate:'2026-11-17'},'owner',now),state={device:{capabilities:{return_schedule:true}},home:{return:{id:p.id,return_date:p.returnDate,status:'completed',durable:true}}};
 const closed=completedAbsenceEntry(p,state,'owner',now);assert.equal(closed.active,false);assert.equal(closed.revision,2);assert.notEqual(closed.id,p.id);
 const next=absenceEntry(closed,{returnDate:p.returnDate},'owner',now);assert.equal(next.active,true);assert.notEqual(next.id,closed.id);assert.notEqual(next.id,p.id);
 assert.equal(completedAbsenceEntry(next,state,'owner',now),undefined);assert.equal(completedAbsenceEntry(closed,state,'owner',now),undefined);
 const postponed=absenceEntry(p,{returnDate:'2026-11-18'},'owner',now);assert.equal(completedAbsenceEntry(postponed,state,'owner',now),undefined);
});
