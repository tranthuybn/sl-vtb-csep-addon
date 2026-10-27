const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');
const base = path.resolve(__dirname, '..');
function load(name, extras = {}) {
  const ctx = vm.createContext({Date, Math, JSON, isFinite, encodeURIComponent, ...extras});
  vm.runInContext(fs.readFileSync(path.join(base, name + '.js'), 'utf8'), ctx, {filename:name});
  return ctx;
}
const cal = load('ESD_HTKT_SLA_CALENDAR');
const calc = load('ESD_HTKT_SLA_CALCULATOR');
const rules = load('ESD_HTKT_EXPENSE_SLA');
const engine = load('ESD_HTKT_SLA_SERVICE');
const T = engine.SLA_T;
const calendar = {timezone:'Asia/Ho_Chi_Minh',workingHours:[],holidays:[]};
for (let d=1;d<=5;d++) for (const [a,b] of [['08:00','12:00'],['13:00','17:00']]) calendar.workingHours.push({dayOfWeek:d,startTime:a,endTime:b});
const time = (d,h) => `2026-10-${d}T${h}:00+07:00`;
const iso = t => new Date(t).toISOString();
let tests=0;
function test(name,fn) {fn(); tests++; console.log('PASS',name);}
const clone = x => JSON.parse(JSON.stringify(x));
function memoryStore() {
  const db = {}; let writes=0, failAt=null, locked=false;
  return {db,
    get(t,id){return clone(db[t]?.[id] || null);},
    list(t,filter){return Object.values(db[t]||{}).filter(x=>Object.entries(filter).every(([k,v])=>String(x[k])===String(v))).map(clone);},
    put(t,row){writes++;if(writes===failAt)throw Error('INJECTED_WRITE_FAILURE');(db[t] ||= {})[row.id] = clone(row);},
    withPaymentLock(id,fn){if(locked)throw Error('BUSY');locked=true;try{return fn();}finally{locked=false;}},
    decodeInstant:x=>x,decodeTime:x=>x,decodeDate:x=>x,
    failAfter(n){failAt=writes+n;}, clearFailure(){failAt=null;}
  };
}
function fixture(id='DC01',initial='dmms',rs1=true,rs2=true) {
  const store=memoryStore();
  store.put(T.calendar,{id:'CAL',timezone:calendar.timezone});
  calendar.workingHours.forEach((x,i)=>store.put(T.hours,{id:'H'+i,'calendar.id':'CAL','day.of.week':x.dayOfWeek,'start.time':x.startTime,'end.time':x.endTime}));
  store.put(T.config,{id:'CFG','transaction.type':'Dự chi','product.type':'Tất cả','calendar.id':'CAL','effective.from':time('01','00:00'),'effective.to':null,status:'Đang hoạt động'});
  const roles=['CB_DE_NGHI','CB_KTTC','RA_SOAT_1','PHE_DUYET_DM','PHE_DUYET_KTTC','RA_SOAT_2','PHE_DUYET_TQ'];
  roles.forEach(role=>store.put(T.detail,{id:role,'sla.config.id':'CFG','role.code':role,'sla.hours':1,'alert.stage1.rate':.7,'alert.stage2.rate':.9,'is.active':true}));
  let payment={id,'transaction.type':'Dự chi','initial.role':initial,'current.phase':'start',status:initial+'_created','created.by':'maker','require.check.level1':rs1,'require.check.level2':rs2,'user.checker.kttc':'kttc','user.checker.dmms':'rs1','user.approver.dmms':'pd_dmms','user.approver.kttc':'pd_kttc','user.checker.final':'rs2','user.approver.final':'pd_final'};
  store.put('esdHTKTpayment',payment);
  const service=engine.createService(store,cal,calc,rules,{resolveEmail:u=>u+'@test.invalid'});
  let seq=0;
  const events=[];
  function send(kind,at,patch={},extra={}) {
    const before=kind==='CREATE'?null:clone(payment);payment={...payment,...patch};store.put('esdHTKTpayment',payment);
    const e={id:'OP'+(++seq),kind,eventAt:at,performedBy:'actor',before,after:clone(payment),...extra};events.push(e);
    service.applyExpenseEvent(e);return e;
  }
  function tracks(){return store.list(T.tracking,{'payment.id':id});}
  return {store,service,send,tracks,events,get payment(){return payment;}};
}
test('Lunch break, weekend, holiday, UTC+07 independent of host timezone',()=>{
 assert.equal(cal.getWorkingMinutes(calendar,time('27','11:30'),time('27','14:30')),120);
 assert.equal(iso(cal.addWorkingMinutes(calendar,time('27','11:30'),120)),iso(time('27','14:30')));
 assert.equal(iso(cal.addWorkingMinutes(calendar,time('30','16:30'),60)),'2026-11-02T01:30:00.000Z');
 const c={...calendar,holidays:['2026-10-28']};
 assert.equal(iso(cal.addWorkingMinutes(c,time('27','16:30'),60)),iso(time('29','08:30')));
 assert.equal(cal.getWorkingMinutes(calendar,time('27','12:00'),time('27','13:00')),0);
 assert.equal(iso(cal.addWorkingMinutes(calendar,time('27','17:00'),60)),iso(time('28','09:00')));
});
test('Invalid calendars, overlapping shifts and ambiguous datetimes fail',()=>{
 assert.throws(()=>cal.compileCalendar({...calendar,workingHours:[{dayOfWeek:1,startTime:'08:00',endTime:'12:00'},{dayOfWeek:1,startTime:'11:00',endTime:'13:00'}]}),/OVERLAPPING/);
 assert.throws(()=>cal.compileCalendar({...calendar,timezone:'UTC'}),/TIMEZONE/);
 assert.throws(()=>cal.compileCalendar({...calendar,holidays:['2026-02-30']}),/HOLIDAY/);
 assert.throws(()=>cal.toMillis('27/10/2026 08:00:00'),/INVALID_INSTANT/);
});
test('Fractional minutes are preserved; exact deadline is breach; closed breach remains visible',()=>{
 const start=time('27','08:00'),end='2026-10-27T08:00:30+07:00';
 let x=calc.calculateTracking(cal,calendar,{startedAt:start,slaMinutes:60},[{startedAt:start}],end);
 assert.equal(x.elapsedMinutes,.5);
 x=calc.calculateTracking(cal,calendar,{startedAt:start,endedAt:time('27','09:00'),slaMinutes:60},[{startedAt:start,endedAt:time('27','09:00')}],time('27','09:10'));
 assert.equal(x.isBreached,true);assert.equal(x.status,'Đã kết thúc');assert.equal(x.canAlert,false);
});
test('Pause gaps excluded; due date moves; overlapping segments rejected',()=>{
 const start=time('27','08:00');
 const x=calc.calculateTracking(cal,calendar,{startedAt:start,slaMinutes:60},[{startedAt:start,endedAt:time('27','08:30')},{startedAt:time('27','09:00')}],time('27','09:15'));
 assert.equal(x.elapsedMinutes,45);assert.equal(iso(x.dueAt),iso(time('27','09:30')));
 const paused=calc.calculateTracking(cal,calendar,{startedAt:start,slaMinutes:60},[{startedAt:start,endedAt:time('27','08:30')}],time('27','09:15'));
 assert.equal(paused.dueAt,null);assert.equal(paused.isRunning,false);
 assert.throws(()=>calc.calculateTracking(cal,calendar,{startedAt:start,slaMinutes:60},[{startedAt:start,endedAt:time('27','08:30')},{startedAt:time('27','08:20')}],time('27','09:15')),/OVERLAPPING/);
});
test('Full DMMS flow persists all roles; RS2 starts early and keeps original tracking',()=>{
 const f=fixture();f.send('CREATE',time('27','08:00'));
 f.send('TRANSITION',time('27','08:01'),{'current.phase':'initial_dmms'});
 f.send('TRANSITION',time('27','08:10'),{'current.phase':'initial_kttc',status:'dmms_initiated'});
 f.send('TRANSITION',time('27','08:20'),{'current.phase':'check_dmms',status:'kttc_checked'});
 f.send('TRANSITION',time('27','08:30'),{'current.phase':'approval_dmms',status:'dmms_checked'});
 f.send('TRANSITION',time('27','08:40'),{'current.phase':'approval_kttc',status:'dmms_approved'});
 let rs=f.tracks().find(x=>x['role.code']==='RA_SOAT_2');assert.equal(rs['started.at'],iso(time('27','08:40')));
 assert.equal(f.tracks().filter(x=>!x['ended.at']).length,2);
 f.send('TRANSITION',time('27','08:50'),{'current.phase':'check_final',status:'kttc_approved'});
 f.send('TRANSITION',time('27','09:00'),{'current.phase':'approval_final',status:'checked'});
 f.send('TRANSITION',time('27','09:10'),{'current.phase':'end',status:'approved'});
 assert.equal(f.tracks().length,7);assert(f.tracks().every(x=>x['ended.at']&&x['end.reason']==='COMPLETE'));
 rs=f.tracks().find(x=>x['role.code']==='RA_SOAT_2');assert.equal(rs['elapsed.minutes'],20);
 assert.equal(f.store.list(T.segment,{}).length,7);assert(f.store.list(T.event,{}).some(x=>x['processing.status']==='APPLIED'));
});
test('KTTC-created bypasses RS1/PD DMMS and starts RS2 at entry to RS2',()=>{
 const f=fixture('DC02','kttc');f.send('CREATE',time('27','08:00'));
 f.send('TRANSITION',time('27','08:01'),{'current.phase':'initial_kttc'});
 f.send('TRANSITION',time('27','08:10'),{'current.phase':'approval_kttc',status:'kttc_checked'});
 assert(!f.tracks().some(x=>['RA_SOAT_1','PHE_DUYET_DM','RA_SOAT_2'].includes(x['role.code'])));
 f.send('TRANSITION',time('27','08:20'),{'current.phase':'check_final',status:'kttc_approved'});
 assert.equal(f.tracks().find(x=>x['role.code']==='RA_SOAT_2')['started.at'],iso(time('27','08:20')));
 f.send('TRANSITION',time('27','08:30'),{'current.phase':'approval_final',status:'checked'});
 f.send('TRANSITION',time('27','08:40'),{'current.phase':'end',status:'approved'});
 assert.equal(f.tracks().length,4);assert(f.tracks().every(x=>x['ended.at']));
});
test('Optional reviews skipped; unexpected transition rejected without SLA writes',()=>{
 const f=fixture('DC03','dmms',false,false);f.send('CREATE',time('27','08:00'));
 f.send('TRANSITION',time('27','08:01'),{'current.phase':'initial_dmms'});
 f.send('TRANSITION',time('27','08:10'),{'current.phase':'initial_kttc',status:'dmms_initiated'});
 const count=f.store.list(T.event,{}).length;
 assert.throws(()=>f.service.applyExpenseEvent({id:'BAD',kind:'TRANSITION',eventAt:time('27','08:20'),performedBy:'actor',before:f.payment,after:{...f.payment,'current.phase':'check_dmms'}}),/UNEXPECTED_NEXT/);
 assert.equal(f.store.list(T.event,{}).length,count);
 f.send('TRANSITION',time('27','08:20'),{'current.phase':'approval_dmms',status:'kttc_checked'});
 f.send('TRANSITION',time('27','08:30'),{'current.phase':'approval_kttc',status:'dmms_approved'});
 f.send('TRANSITION',time('27','08:40'),{'current.phase':'approval_final',status:'kttc_approved'});
 assert(!f.tracks().some(x=>x['role.code']==='RA_SOAT_1'||x['role.code']==='RA_SOAT_2'));
});
test('Reassignment splits segments without resetting deadline; future role has no tracking',()=>{
 const f=fixture();f.send('CREATE',time('27','08:00'));
 f.send('REASSIGN',time('27','08:01'),{'user.approver.final':'new-final'});
 assert.equal(f.tracks().length,1);
 f.send('TRANSITION',time('27','08:02'),{'current.phase':'initial_dmms'});
 f.send('TRANSITION',time('27','08:10'),{'current.phase':'initial_kttc',status:'dmms_initiated'});
 const old=f.tracks().find(x=>x['role.code']==='CB_KTTC');
 f.send('REASSIGN',time('27','08:30'),{'user.checker.kttc':'new-kttc'});
 const now=f.tracks().find(x=>x['role.code']==='CB_KTTC');
 assert.equal(now.id,old.id);assert.equal(now['due.at'],old['due.at']);assert.equal(now['elapsed.minutes'],20);
 const seg=f.store.list(T.segment,{'sla.tracking.id':now.id});assert.equal(seg.length,2);assert.equal(seg[0]['end.event'],'REASSIGN');
});
test('Return closes all concurrent clocks and creates attempt 2 including maker; cancel preserves history',()=>{
 const f=fixture();f.send('CREATE',time('27','08:00'));
 f.send('TRANSITION',time('27','08:01'),{'current.phase':'initial_dmms'});
 f.send('TRANSITION',time('27','08:10'),{'current.phase':'initial_kttc',status:'dmms_initiated'});
 f.send('TRANSITION',time('27','08:20'),{'current.phase':'check_dmms',status:'kttc_checked'});
 f.send('TRANSITION',time('27','08:30'),{'current.phase':'approval_dmms',status:'dmms_checked'});
 f.send('TRANSITION',time('27','08:40'),{'current.phase':'approval_kttc',status:'dmms_approved'});
 f.send('RETURN',time('27','08:50'),{'current.phase':'initial_dmms',status:'request_edit'});
 assert.equal(f.tracks().filter(x=>x['end.reason']==='RETURN').length,2);
 const maker=f.tracks().find(x=>x['attempt.no']===2);assert.equal(maker['role.code'],'CB_DE_NGHI');assert.equal(maker['elapsed.minutes'],0);
 f.send('CANCEL',time('27','09:00'),{status:'cancelled','current.phase':'end'});
 assert(f.tracks().every(x=>x['ended.at']));assert.equal(f.tracks().find(x=>x['attempt.no']===2)['end.reason'],'CANCEL');
 const before=f.store.list(T.alert,{}).length;f.service.refreshExpense(f.payment.id,time('27','10:00'));assert.equal(f.store.list(T.alert,{}).length,before);
});
test('Alerts 70/90/breach recorded once with actual crossing time and current recipient',()=>{
 const f=fixture('DC04','kttc');f.send('CREATE',time('27','08:00'));
 f.service.refreshExpense(f.payment.id,time('27','08:43'));
 let alerts=f.store.list(T.alert,{});assert.equal(alerts.length,1);assert.equal(alerts[0]['triggered.at'],iso(time('27','08:42')));
 f.service.refreshExpense(f.payment.id,time('27','09:10'));f.service.refreshExpense(f.payment.id,time('27','09:10'));
 alerts=f.store.list(T.alert,{});assert.equal(alerts.length,3);assert(alerts.every(x=>x['recipient.user']==='maker'));
 assert.equal(f.tracks()[0]['remaining.minutes'],-10);
});
test('Retry same event is idempotent; changed payload, stale events, missing config rejected',()=>{
 const f=fixture();const e=f.send('CREATE',time('27','08:00'));const n=f.store.list(T.segment,{}).length;
 assert.equal(f.service.applyExpenseEvent(e).duplicate,true);assert.equal(f.store.list(T.segment,{}).length,n);
 assert.throws(()=>f.service.applyExpenseEvent({...e,performedBy:'different'}),/ID_REUSED/);
 f.service.refreshExpense(f.payment.id,time('27','08:10'));
 f.service.applyExpenseEvent({id:'DELAYED',kind:'TRANSITION',eventAt:time('27','08:05'),performedBy:'actor',before:{...f.payment,'current.phase':'initial_dmms'},after:{...f.payment,'current.phase':'initial_kttc',status:'dmms_initiated'}});
 assert.equal(f.tracks().find(x=>x['role.code']==='CB_DE_NGHI')['elapsed.minutes'],5);
 assert.throws(()=>f.service.applyExpenseEvent({id:'STALE',kind:'TRANSITION',eventAt:time('27','08:04'),performedBy:'actor',before:{...f.payment,'current.phase':'initial_kttc'},after:{...f.payment,'current.phase':'check_dmms',status:'kttc_checked'}}),/OUT_OF_ORDER/);
 const bad=fixture('NO-CFG');bad.store.db[T.config]={};assert.throws(()=>bad.send('CREATE',time('27','08:00')),/EXPECT_ONE_EFFECTIVE_CONFIG/);
});
test('Interrupted multi-table writes recover from PREPARED; later operations cannot bypass it',()=>{
 const f=fixture();f.store.failAfter(3);
 assert.throws(()=>f.send('CREATE',time('27','08:00')),/INJECTED/);
 f.store.clearFailure();assert(f.store.list(T.event,{}).some(x=>x['processing.status']==='PREPARED'));
 assert.throws(()=>f.service.refreshExpense(f.payment.id,time('27','08:10')),/PENDING_EVENT/);
 f.service.applyExpenseEvent(f.events[0]);assert.equal(f.tracks().length,1);assert.equal(f.store.list(T.segment,{}).length,1);
 assert(f.store.list(T.event,{}).some(x=>x['processing.status']==='APPLIED'));
});
test('Configuration thresholds copied and decimal budgets supported',()=>{
 const f=fixture();f.store.put(T.detail,{...f.store.get(T.detail,'CB_DE_NGHI'),'sla.hours':1.125,'alert.stage1.rate':.6});
 f.send('CREATE',time('27','08:00'));assert.equal(f.tracks()[0]['sla.minutes'],67.5);
 f.store.put(T.detail,{...f.store.get(T.detail,'CB_DE_NGHI'),'sla.hours':99,'alert.stage1.rate':.1});
 f.service.refreshExpense(f.payment.id,time('27','08:41'));
 assert.equal(f.tracks()[0]['sla.minutes'],67.5);assert.equal(f.tracks()[0]['alert.stage1.rate'],.6);assert.equal(f.store.list(T.alert,{}).length,1);
});
const worker=load('ESD_HTKT_SLA_SCHEDULE',{lib:{ESD_HTKT_SLA_CALENDAR:cal}});
test('Alert worker retries failures, updates status, cancels closed SLA and deduplicates sent mail',()=>{
 const f=fixture('MAIL','kttc');f.send('CREATE',time('27','08:00'));
 f.service.refreshExpense(f.payment.id,time('27','08:45'));
 const rt={store:f.store,service:f.service};
 let outcome=worker.dispatchPendingAlerts(rt,()=>{throw Error('SMTP down');},time('27','08:46'));
 assert.equal(outcome.success,false);assert.equal(f.store.list(T.alert,{})[0]['retry.count'],1);
 let calls=0;
 outcome=worker.dispatchPendingAlerts(rt,p=>{calls++;assert(p.id);return {success:true};},time('27','08:47'));
 assert.equal(outcome.sent,1);worker.dispatchPendingAlerts(rt,()=>{calls++;return {success:true};},time('27','08:48'));assert.equal(calls,1);
 f.service.refreshExpense(f.payment.id,time('27','08:55'));
 f.send('CANCEL',time('27','08:56'),{status:'cancelled','current.phase':'end'});
 outcome=worker.dispatchPendingAlerts(rt,()=>{throw Error('must not send');},time('27','08:57'));
 assert.equal(outcome.cancelled,0);assert.equal(f.store.list(T.alert,{}).filter(x=>x['send.status']==='Đã hủy').length,1);
});
test('Pending alert follows reassigned current actor at dispatch',()=>{
 const f=fixture('MAIL-REASSIGN');f.send('CREATE',time('27','08:00'));
 f.send('TRANSITION',time('27','08:01'),{'current.phase':'initial_dmms'});
 f.send('TRANSITION',time('27','08:10'),{'current.phase':'initial_kttc',status:'dmms_initiated'});
 f.service.refreshExpense(f.payment.id,time('27','08:53'));
 f.send('REASSIGN',time('27','08:54'),{'user.checker.kttc':'replacement'});
 worker.dispatchPendingAlerts({store:f.store,service:f.service},p=>{assert.equal(p.recipientUser,'replacement');return {success:true,recipientEmail:'replacement@test.invalid'};},time('27','08:55'));
 assert.equal(f.store.list(T.alert,{})[0]['recipient.user'],'replacement');
});
test('Batch continues after one corrupt payment and pagination reaches later IDs',()=>{
 const f=fixture('A','kttc');f.send('CREATE',time('27','08:00'));
 f.store.put(T.tracking,{id:'broken','payment.id':'B','started.at':time('27','08:00'),'ended.at':null});
 f.store.put('esdHTKTpayment',{id:'B','transaction.type':'Dự chi',status:'kttc_created'});
 f.store.put(T.tracking,{id:'foreign','payment.id':'C','ended.at':null});
 f.store.put('esdHTKTpayment',{id:'C','transaction.type':'Thanh toán'});
 const rt={store:f.store,service:f.service};
 const a=worker.runExpenseBatch(rt,time('27','08:45'),{limit:1});assert.equal(a.nextCursor,'A');assert.equal(a.results.length,1);
 const b=worker.runExpenseBatch(rt,time('27','08:45'),{limit:10,afterPaymentId:a.nextCursor});assert.equal(b.errors.length,1);assert.equal(b.errors[0].paymentId,'B');assert.equal(b.nextCursor,null);
});
test('Every interrupted write in CREATE can recover without duplicate rows',()=>{
 for(let fail=2;fail<=5;fail++) {
  const f=fixture('REC'+fail);f.store.failAfter(fail);
  assert.throws(()=>f.send('CREATE',time('27','08:00')),/INJECTED/);f.store.clearFailure();
  if(f.store.list(T.event,{'processing.status':'PREPARED'}).length) f.service.retryPrepared(f.payment.id);
  else f.service.applyExpenseEvent(f.events[0]); // source retries if journal INSERT itself failed
  assert.equal(f.tracks().length,1);assert.equal(f.store.list(T.segment,{}).length,1);
  assert.equal(f.service.applyExpenseEvent(f.events[0]).duplicate,true);
 }
});
test('Wrong transaction type and duplicate config fail without SLA mutation',()=>{
 const f=fixture();const c=f.store.get(T.config,'CFG');f.store.put(T.config,{...c,id:'CFG2'});
 assert.throws(()=>f.send('CREATE',time('27','08:00')),/EXPECT_ONE_EFFECTIVE_CONFIG/);assert.equal(f.tracks().length,0);
 assert.throws(()=>rules.buildCommands({id:'X',kind:'CREATE',performedBy:'actor',after:{id:'X','transaction.type':'Thanh toán'}}),/NOT_EXPENSE/);
});
test('Late completion recalculates actual elapsed time and cancels spurious pending thresholds',()=>{
 const f=fixture('LATE','kttc');f.send('CREATE',time('27','08:00'));
 f.send('TRANSITION',time('27','08:01'),{'current.phase':'initial_kttc'});
 f.service.refreshExpense(f.payment.id,time('27','09:10'));assert.equal(f.store.list(T.alert,{}).length,3);
 f.send('TRANSITION',time('27','08:30'),{'current.phase':'approval_kttc',status:'kttc_checked'});
 assert.equal(f.tracks().find(x=>x['role.code']==='CB_KTTC')['elapsed.minutes'],30);
 assert(f.store.list(T.alert,{}).every(x=>x['send.status']==='Đã hủy'));
});
test('Bootstrap publishes config last and rejects overlap; seeds approved holiday rows',()=>{
 const boot=load('ESD_HTKT_SLA_BOOTSTRAP');const st=memoryStore();const writes=[];
 const put=st.put.bind(st);st.put=(t,row)=>{writes.push(t);put(t,row);};
 const args={calendarId:'YEAR',configId:'DC',effectiveFrom:time('01','00:00'),performedBy:'admin',holidays:['2026-10-28']};
 boot.installExpenseBaseline(st,cal,args);
 assert.equal(writes.at(-1),T.config);assert.equal(st.list(T.detail,{}).length,7);assert.equal(st.list(T.hours,{}).length,10);
 assert.equal(st.get(T.detail,'DC.RA_SOAT_2')['sla.hours'],4.5);assert.equal(st.list(T.holiday,{}).length,1);
 assert.throws(()=>boot.installExpenseBaseline(st,cal,{...args,calendarId:'YEAR2',configId:'DC2'}),/EFFECTIVE_OVERLAP/);
});
test('SCFile adapter converts timestamp writes and uses atomic exclusive lock with release on error',()=>{
 const db={};const OK=0,NONE=9,DUP=48;
 class FakeSCFile {
  constructor(table){this._table=table;this._rows=[];this._index=-1;}
  _pk(){return this._table==='esdHTKTslaLock'?'payment.id':'id';}
  _copyIn(row){for(const k of Object.keys(this))if(!k.startsWith('_'))delete this[k];if(row)Object.assign(this,row);}
  _out(){return Object.fromEntries(Object.entries(this).filter(([k])=>!k.startsWith('_')));}
  doSelect(query){
   const clauses=query==='true'?[]:query.split(' and ').map(c=>{const m=/^([^=]+)="(.*)"$/.exec(c);if(!m)throw Error('bad mock query');return[m[1],m[2]];});
   this._rows=Object.values(db[this._table]||{}).filter(r=>clauses.every(([k,v])=>String(r[k])===v));this._index=0;
   this._copyIn(this._rows[0]);return this._rows.length?OK:NONE;
  }
  getNext(){this._index++;this._copyIn(this._rows[this._index]);return this._index<this._rows.length?OK:NONE;}
  doInsert(){const rows=db[this._table]||={};const key=this[this._pk()];if(rows[key])return DUP;rows[key]=this._out();return OK;}
  doUpdate(){const rows=db[this._table]||={};rows[this[this._pk()]]=this._out();return OK;}
  doDelete(){delete db[this._table][this[this._pk()]];return OK;}
  close(){}
 }
 const adapter=load('ESD_HTKT_SLA_STORE',{SCFile:FakeSCFile,SCFILE_READONLY:1,RC_SUCCESS:OK,RC_NO_MORE:NONE});
 const st=adapter.createStore();st.put(T.event,{id:'D','created.at':time('27','08:00')});
 assert(db[T.event].D['created.at'] instanceof Date);assert.equal(st.get(T.event,'MISSING'),null);
 st.withPaymentLock('DC',()=>{assert.throws(()=>st.withPaymentLock('DC',()=>{}),/LOCK_ACQUIRE_FAILED/);});
 assert.equal(Object.keys(db.esdHTKTslaLock).length,0);
 assert.throws(()=>st.withPaymentLock('DC',()=>{throw Error('work failure');}),/work failure/);
 assert.equal(Object.keys(db.esdHTKTslaLock).length,0);
 st.withPaymentLock('DC',()=>{});
});
test('Working-time addition agrees with independently counted minutes across multiple days',()=>{
 const c={...calendar,holidays:['2026-10-28']};
 function independent(start,end){let total=0;for(let n=start;n<end;n+=60000){const d=new Date(n+7*3600000),wd=d.getUTCDay(),m=d.getUTCHours()*60+d.getUTCMinutes(),day=d.toISOString().slice(0,10);if(wd>=1&&wd<=5&&day!=='2026-10-28'&&((m>=480&&m<720)||(m>=780&&m<1020)))total++;}return total;}
 for(let i=0;i<12;i++) {const start=Date.parse(time('27','07:00'))+i*97*60000,budget=37+i*61,end=cal.addWorkingMinutes(c,start,budget).getTime();assert.equal(independent(start,end),budget);}
});
console.log(`Completed ${tests} tests`);
