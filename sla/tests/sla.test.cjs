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
const engine = load('ESD_HTKT_SLA_ENGINE');
const cal = engine;
const calc = engine;
const rules = engine;
const T = engine.SLA_T;
const calendar = {timezone:'Asia/Ho_Chi_Minh',workingHours:[],holidays:[]};
for (let d=1;d<=5;d++) for (const [a,b] of [['08:00','12:00'],['13:00','17:00']]) calendar.workingHours.push({dayOfWeek:d,startTime:a,endTime:b});
const time = (d,h) => `2026-10-${d}T${h}:00+07:00`;
const iso = t => new Date(t).toISOString();
let tests=0;
function test(name,fn) {fn(); tests++; console.log('PASS',name);}
const clone = x => JSON.parse(JSON.stringify(x));
function memoryStore() {
  const db = {}; let writes=0, failAt=null, sequence=0;
  function rowKey(t,row){
    if(t===T.hours)return `${row['day.of.week']}|${row['start.time']}`;
    if(t===T.holiday)return String(row['holiday.date']);
    return row.id;
  }
  return {db,
    get(t,id){return clone(db[t]?.[id] || null);},
    list(t,filter){return Object.values(db[t]||{}).filter(x=>Object.entries(filter).every(([k,v])=>String(x[k])===String(v))).map(clone);},
    put(t,row){writes++;if(writes===failAt)throw Error('INJECTED_WRITE_FAILURE');(db[t] ||= {})[rowKey(t,row)] = clone(row);},
    nextNumber(numberClass){assert.equal(numberClass,'esdHTKTslaTimeSegment');return String(++sequence);},
    decodeInstant:x=>x,decodeDate:x=>x,
    failAfter(n){failAt=writes+n;}, clearFailure(){failAt=null;}
  };
}
function fixture(id='DC01',initial='dmms',rs1=true,rs2=true) {
  if (!/^(DC|TT|TU)/.test(id)) id='DC'+id;
  const store=memoryStore();
  calendar.workingHours.forEach(x=>store.put(T.hours,{'day.of.week':x.dayOfWeek,'start.time':x.startTime,'end.time':x.endTime}));
  store.put(T.config,{id:'CFG','transaction.type':'Dự chi','product.type':'Tất cả','effective.from':time('01','00:00'),'effective.to':null,status:'Đang hoạt động'});
  const roles=['user.created.dmms','user.checker.kttc','user.checker.dmms','user.approver.dmms','user.approver.kttc','user.checker.final','user.approver.final'];
  roles.forEach(role=>store.put(T.detail,{id:role,'sla.config.id':'CFG','role.code':role,'sla.minutes':60,'is.active':true}));
  let payment={id,'transaction.type':'Dự chi','initial.role':initial,'current.phase':'start',status:initial+'_created','created.by':'maker','require.check.level1':rs1,'require.check.level2':rs2,'user.checker.kttc':'kttc','user.checker.dmms':'rs1','user.approver.dmms':'pd_dmms','user.approver.kttc':'pd_kttc','user.checker.final':'rs2','user.approver.final':'pd_final'};
  store.put(payment['transaction.type']==='Tạm ứng'?'esdHTKTprepayment':'esdHTKTpayment',payment);
  const service=engine.createService(store,cal,calc,rules,{});
  let seq=0;
  const events=[];
  function send(kind,at,patch={},extra={}) {
    const before=kind==='CREATE'?null:clone(payment);payment={...payment,...patch};store.put('esdHTKTpayment',payment);
    const e={id:'OP'+(++seq),kind,eventAt:at,performedBy:'actor',before,after:clone(payment),...extra};events.push(e);
    service.applyEvent(e);return e;
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
 assert.doesNotThrow(()=>cal.compileCalendar({...calendar,workingHours:[{dayOfWeek:1,startTime:'08:00:00',endTime:'12:00:00'}]}));
 assert.throws(()=>cal.compileCalendar({...calendar,workingHours:[{dayOfWeek:1,startTime:'08:00:60',endTime:'12:00:00'}]}),/WORKING_TIME/);
});
test('Fractional minutes are preserved; exact deadline is breach; closed breach remains visible',()=>{
 const start=time('27','08:00'),end='2026-10-27T08:00:30+07:00';
 let x=calc.calculateTracking(cal,calendar,{startedAt:start,slaMinutes:60},[{startedAt:start}],end);
 assert.equal(x.elapsedMinutes,.5);
 x=calc.calculateTracking(cal,calendar,{startedAt:start,endedAt:time('27','09:00'),slaMinutes:60},[{startedAt:start,endedAt:time('27','09:00')}],time('27','09:10'));
 assert.equal(x.isBreached,true);assert.equal(x.status,'Đã kết thúc');
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
 let rs=f.tracks().find(x=>x['role.code']==='user.checker.final');assert.equal(rs['started.at'],iso(time('27','08:40')));
 assert.equal(f.tracks().filter(x=>!x['ended.at']).length,2);
 f.send('TRANSITION',time('27','08:50'),{'current.phase':'check_final',status:'kttc_approved'});
 f.send('TRANSITION',time('27','09:00'),{'current.phase':'approval_final',status:'checked'});
 f.send('TRANSITION',time('27','09:10'),{'current.phase':'end',status:'approved'});
 assert.equal(f.tracks().length,6);assert(f.tracks().every(x=>x['ended.at']&&x['end.reason']==='COMPLETE'));
 rs=f.tracks().find(x=>x['role.code']==='user.checker.final');
 assert.equal(f.store.list(T.segment,{'sla.tracking.id':rs.id})[0]['working.minutes'],20);
 assert.equal(f.store.list(T.segment,{}).length,6);
});
test('KTTC-created bypasses RS1/PD DMMS and starts RS2 at entry to RS2',()=>{
 const f=fixture('DC02','kttc');f.send('CREATE',time('27','08:00'));
 f.send('TRANSITION',time('27','08:01'),{'current.phase':'initial_kttc'});
 f.send('TRANSITION',time('27','08:10'),{'current.phase':'approval_kttc',status:'kttc_checked'});
 assert(!f.tracks().some(x=>['user.checker.dmms','user.approver.dmms','user.checker.final'].includes(x['role.code'])));
 f.send('TRANSITION',time('27','08:20'),{'current.phase':'check_final',status:'kttc_approved'});
 assert.equal(f.tracks().find(x=>x['role.code']==='user.checker.final')['started.at'],iso(time('27','08:20')));
 f.send('TRANSITION',time('27','08:30'),{'current.phase':'approval_final',status:'checked'});
 f.send('TRANSITION',time('27','08:40'),{'current.phase':'end',status:'approved'});
 assert.equal(f.tracks().length,3);assert(f.tracks().every(x=>x['ended.at']));
});
test('Optional reviews skipped; unexpected transition rejected without SLA writes',()=>{
 const f=fixture('DC03','dmms',false,false);f.send('CREATE',time('27','08:00'));
 f.send('TRANSITION',time('27','08:01'),{'current.phase':'initial_dmms'});
 f.send('TRANSITION',time('27','08:10'),{'current.phase':'initial_kttc',status:'dmms_initiated'});
 const trackCount=f.tracks().length, segmentCount=f.store.list(T.segment,{}).length;
 assert.throws(()=>f.service.applyEvent({id:'BAD',kind:'TRANSITION',eventAt:time('27','08:20'),performedBy:'actor',before:f.payment,after:{...f.payment,'current.phase':'check_dmms'}}),/UNEXPECTED_NEXT/);
 assert.equal(f.tracks().length,trackCount);assert.equal(f.store.list(T.segment,{}).length,segmentCount);
 f.send('TRANSITION',time('27','08:20'),{'current.phase':'approval_dmms',status:'kttc_checked'});
 f.send('TRANSITION',time('27','08:30'),{'current.phase':'approval_kttc',status:'dmms_approved'});
 f.send('TRANSITION',time('27','08:40'),{'current.phase':'approval_final',status:'kttc_approved'});
 assert(!f.tracks().some(x=>x['role.code']==='user.checker.dmms'||x['role.code']==='user.checker.final'));
});
test('Reassignment splits segments without resetting deadline; future role has no tracking',()=>{
 const f=fixture();f.send('CREATE',time('27','08:00'));
 f.send('REASSIGN',time('27','08:01'),{'user.approver.final':'new-final'});
 assert.equal(f.tracks().length,0);
 f.send('TRANSITION',time('27','08:02'),{'current.phase':'initial_dmms'});
 f.send('TRANSITION',time('27','08:10'),{'current.phase':'initial_kttc',status:'dmms_initiated'});
 const old=f.tracks().find(x=>x['role.code']==='user.checker.kttc');
 f.send('REASSIGN',time('27','08:30'),{'user.checker.kttc':'new-kttc'});
 const now=f.tracks().find(x=>x['role.code']==='user.checker.kttc');
 assert.equal(now.id,old.id);assert.equal(now['due.at'],old['due.at']);
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
 const maker=f.tracks().find(x=>x['attempt.no']===2);assert.equal(maker['role.code'],'user.created.dmms');
 f.send('CANCEL',time('27','09:00'),{status:'cancelled','current.phase':'end'});
 assert(f.tracks().every(x=>x['ended.at']));assert.equal(f.tracks().find(x=>x['attempt.no']===2)['end.reason'],'CANCEL');
 f.service.refresh(f.payment.id,time('27','10:00'));
});
test('Delayed transition recalculates from event time; missing config is rejected',()=>{
 const f=fixture();f.send('CREATE',time('27','08:00'));
 f.service.refresh(f.payment.id,time('27','08:10'));
 f.service.applyEvent({id:'DELAYED',kind:'TRANSITION',eventAt:time('27','08:05'),performedBy:'actor',before:{...f.payment,'current.phase':'initial_dmms'},after:{...f.payment,'current.phase':'initial_kttc',status:'dmms_initiated'}});
 assert(!f.tracks().some(x=>x['role.code']==='user.created.dmms'));
 assert.equal(f.tracks()[0]['started.at'],iso(time('27','08:05')));
 const bad=fixture('NO-CFG');bad.store.db[T.config]={};assert.throws(()=>bad.send('TRANSITION',time('27','08:00'),{'current.phase':'initial_kttc',status:'dmms_initiated'},{before:{...bad.payment,'current.phase':'initial_dmms'}}),/EXPECT_ONE_EFFECTIVE_CONFIG/);
});
test('Minute budgets are fixed on tracking creation',()=>{
 const f=fixture();f.store.put(T.detail,{...f.store.get(T.detail,'user.created.dmms'),'sla.minutes':67.5});
 f.send('RETURN',time('27','08:00'),{'current.phase':'initial_dmms',status:'request_edit'});assert.equal(f.tracks()[0]['sla.minutes'],67.5);
 f.store.put(T.detail,{...f.store.get(T.detail,'user.created.dmms'),'sla.minutes':99});
 f.service.refresh(f.payment.id,time('27','08:48'));
 assert.equal(f.tracks()[0]['sla.minutes'],67.5);
});
const worker=load('ESD_HTKT_SLA_JOB',{lib:{ESD_HTKT_SLA_ENGINE:engine}});
test('Batch continues after one corrupt payment and pagination reaches later IDs',()=>{
 const f=fixture('A','kttc');f.send('RETURN',time('27','08:00'),{'current.phase':'initial_kttc',status:'request_edit'});
 f.store.put(T.tracking,{id:'broken','payment.id':'DCB','started.at':time('27','08:00'),'ended.at':null});
 f.store.put('esdHTKTpayment',{id:'DCB','transaction.type':'Dự chi',status:'kttc_created'});
 f.store.put(T.tracking,{id:'foreign','payment.id':'DCC','ended.at':null});
 f.store.put('esdHTKTpayment',{id:'DCC','transaction.type':'Không áp dụng SLA'});
 const rt={store:f.store,service:f.service};
 const a=worker.runBatch(rt,time('27','08:45'),{limit:1});assert.equal(a.nextCursor,'DCA');assert.equal(a.results.length,1);
 const b=worker.runBatch(rt,time('27','08:45'),{limit:10,afterPaymentId:a.nextCursor});assert.equal(b.errors.length,1);assert.equal(b.errors[0].paymentId,'DCB');assert.equal(b.nextCursor,null);
});
test('Unsupported transaction type and duplicate config fail without SLA mutation',()=>{
 const f=fixture();const c=f.store.get(T.config,'CFG');f.store.put(T.config,{...c,id:'CFG2'});
 assert.throws(()=>f.send('RETURN',time('27','08:00'),{'current.phase':'initial_dmms',status:'request_edit'}),/EXPECT_ONE_EFFECTIVE_CONFIG/);assert.equal(f.tracks().length,0);
 assert.throws(()=>rules.buildCommands({id:'X',kind:'CREATE',performedBy:'actor',after:{id:'X','transaction.type':'Không hỗ trợ'}}),/UNSUPPORTED_TRANSACTION_TYPE/);
});
test('Dự chi, Tạm ứng and Thanh toán share one workflow policy',()=>{
 for (const transactionType of ['Dự chi','Tạm ứng','Thanh toán']) {
  const commands=rules.buildCommands({id:'CREATE-'+transactionType,kind:'CREATE',performedBy:'actor',
   after:{id:'X','transaction.type':transactionType,'initial.role':'kttc',status:'kttc_created','created.by':'maker'}});
  assert.equal(commands.length,0);
 }
});
test('Engine temporarily uses Tất cả config without requiring payment product.type',()=>{
 for (const item of [{type:'Tạm ứng'}, {type:'Thanh toán'}]) {
  const f=fixture('CFG-'+item.type,'kttc');f.send('CREATE',time('27','07:00'),{'transaction.type':item.type});const config=f.store.get(T.config,'CFG');
  config['transaction.type']=item.type;config['product.type']='Tất cả';f.store.put(T.config,config);
  f.send('RETURN',time('27','08:00'),{'transaction.type':item.type,'product.type':'','current.phase':'initial_kttc',status:'request_edit'});
  assert.equal(f.tracks().length,1);assert.equal(f.store.get(T.detail,f.tracks()[0]['sla.config.detail.id'])['sla.config.id'],'CFG');assert(!Object.hasOwn(f.tracks()[0],'sla.config.id'));
 }
});
test('Late completion recalculates segments at actual business time',()=>{
 const f=fixture('LATE','kttc');f.send('RETURN',time('27','08:00'),{'current.phase':'initial_kttc',status:'request_edit'});
 f.service.refresh(f.payment.id,time('27','09:10'));
 f.send('TRANSITION',time('27','08:30'),{'current.phase':'approval_kttc',status:'kttc_checked'});
 const tracking=f.tracks().find(x=>x['role.code']==='user.checker.kttc');
 assert.equal(f.store.list(T.segment,{'sla.tracking.id':tracking.id})[0]['working.minutes'],30);
 assert.equal(tracking.result,'MET');
});
test('Bootstrap publishes config last and rejects overlap; seeds approved holiday rows',()=>{
 const boot=engine;const st=memoryStore();const writes=[];
 const put=st.put.bind(st);st.put=(t,row)=>{writes.push(t);put(t,row);};
 const args={configId:'DC',effectiveFrom:time('01','00:00'),performedBy:'admin',holidays:['2026-10-28']};
 boot.installBaseline(st,cal,args);
 assert.equal(writes.at(-1),T.config);assert.equal(st.list(T.detail,{}).length,7);assert.equal(st.list(T.hours,{}).length,10);
 assert.equal(st.get(T.detail,'DC.user.checker.final')['sla.minutes'],270);assert.equal(st.list(T.holiday,{}).length,1);
 boot.installBaseline(st,cal,{...args,configId:'TA',transactionType:'Tạm ứng'});
 assert.equal(st.list(T.hours,{}).length,10);assert.equal(st.list(T.holiday,{}).length,1);
 assert.throws(()=>boot.installBaseline(st,cal,{...args,configId:'DC2'}),/EFFECTIVE_OVERLAP/);
});
test('SCFile adapter converts timestamp writes',()=>{
 const db={};const OK=0,NONE=9,DUP=48;
 class FakeSCFile {
  constructor(table){this._table=table;this._rows=[];this._index=-1;}
  _pk(){return 'id';}
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
 const adapter=load('ESD_HTKT_SLA_ENGINE',{SCFile:FakeSCFile,SCFILE_READONLY:1,RC_SUCCESS:OK,RC_NO_MORE:NONE});
 const st=adapter.createStore();st.put(T.tracking,{id:'D','started.at':time('27','08:00')});
 assert(db[T.tracking].D['started.at'] instanceof Date);assert.equal(st.get(T.tracking,'MISSING'),null);
});
test('Working-time addition agrees with independently counted minutes across multiple days',()=>{
 const c={...calendar,holidays:['2026-10-28']};
 function independent(start,end){let total=0;for(let n=start;n<end;n+=60000){const d=new Date(n+7*3600000),wd=d.getUTCDay(),m=d.getUTCHours()*60+d.getUTCMinutes(),day=d.toISOString().slice(0,10);if(wd>=1&&wd<=5&&day!=='2026-10-28'&&((m>=480&&m<720)||(m>=780&&m<1020)))total++;}return total;}
 for(let i=0;i<12;i++) {const start=Date.parse(time('27','07:00'))+i*97*60000,budget=37+i*61,end=cal.addWorkingMinutes(c,start,budget).getTime();assert.equal(independent(start,end),budget);}
});


test('Creation statuses never start clocks; first submitted step starts at committed time',()=>{
 for(const initial of ['dmms','kttc']) {
  const f=fixture('NEW-'+initial,initial);
  f.send('CREATE',time('27','08:00'));
  f.send('TRANSITION',time('27','08:01'),{'current.phase':'initial_'+initial});
  assert.equal(f.tracks().length,0);assert.equal(f.store.list(T.segment,{}).length,0);
  f.send('TRANSITION',time('27','08:10'),{'current.phase':initial==='dmms'?'initial_kttc':'approval_kttc',status:initial==='dmms'?'dmms_initiated':'kttc_checked'});
  assert.equal(f.tracks().length,1);assert.equal(f.tracks()[0]['started.at'],iso(time('27','08:10')));
  assert.equal(f.tracks()[0]['role.code'],initial==='dmms'?'user.checker.kttc':'user.approver.kttc');
 }
});
test('Leaving creation status in same initial phase starts clock; return still measures maker',()=>{
 const f=fixture('SAME');f.send('CREATE',time('27','08:00'));
 f.send('TRANSITION',time('27','08:01'),{'current.phase':'initial_dmms'});
 f.send('TRANSITION',time('27','08:10'),{status:'dmms_initiated'});
 assert.equal(f.tracks()[0]['role.code'],'user.created.dmms');
 assert.equal(f.tracks()[0]['started.at'],iso(time('27','08:10')));
 f.send('RETURN',time('27','08:20'),{status:'request_edit'});
 assert.equal(f.tracks().find(x=>!x['ended.at'])['attempt.no'],2);
});



test('Document prefixes select the right table without a source field',()=>{
 assert.equal(engine.sourceTableForId('TU001'),'esdHTKTprepayment');
 assert.equal(engine.sourceTableForId('DC001'),'esdHTKTpayment');
 assert.equal(engine.sourceTableForId('TT001'),'esdHTKTpayment');
 assert.throws(()=>engine.sourceTableForId('UNKNOWN'),/UNKNOWN_DOCUMENT_PREFIX/);
 const f=fixture('TU001');const c=f.store.get(T.config,'CFG');f.store.put(T.config,{...c,'transaction.type':'Tạm ứng'});
 const after={...f.payment,'transaction.type':'Tạm ứng','current.phase':'initial_kttc',status:'dmms_initiated'};
 const before={...after,'current.phase':'initial_dmms',status:'initialized'};
 f.store.put('esdHTKTprepayment',after);
 const rt=engine.createRuntime({store:f.store});rt.onWorkflowChanged(before,{...after,sysmodcount:1,sysmodtime:time('27','08:10'),sysmoduser:'actor'});
 assert.equal(worker.runBatch(rt,time('27','08:40'),{}).results.length,1);
 for(const row of f.store.list(T.tracking,{}))assert(!Object.hasOwn(row,'source.table'));
});


test('Two-record workflow API detects events and skips unrelated changes',()=>{
 const f=fixture('TWO');const rt=engine.createRuntime({store:f.store});
 let rec={...f.payment,sysmodcount:1,sysmodtime:time('27','08:00'),sysmoduser:'actor'};
 rt.onWorkflowChanged(null,rec);assert.equal(f.tracks().length,0);
 let old=rec;rec={...rec,'current.phase':'initial_dmms',sysmodcount:2,sysmodtime:time('27','08:01')};rt.onWorkflowChanged(old,rec);
 old=rec;rec={...rec,'current.phase':'initial_kttc',status:'dmms_initiated',sysmodcount:3,sysmodtime:time('27','08:10')};
 rt.onWorkflowChanged(old,rec);assert.equal(f.tracks()[0]['started.at'],iso(time('27','08:10')));
 assert.equal(rt.onWorkflowChanged(rec,{...rec,description:'edit'}).skipped,true);
 old=rec;rec={...rec,'user.checker.kttc':'new',sysmodcount:4,sysmodtime:time('27','08:20')};rt.onWorkflowChanged(old,rec);
 assert.equal(f.store.list(T.segment,{}).length,2);
 old=rec;rec={...rec,status:'request_edit','current.phase':'initial_dmms',sysmodcount:5,sysmodtime:time('27','08:30')};rt.onWorkflowChanged(old,rec);
 assert.equal(f.tracks().find(x=>!x['ended.at'])['attempt.no'],2);
 old=rec;rec={...rec,status:'cancelled','current.phase':'end',sysmodcount:6,sysmodtime:time('27','08:40')};rt.onWorkflowChanged(old,rec);
 assert(f.tracks().every(x=>x['ended.at']));
 assert.equal(rt.onWorkflowChanged(rec,{...rec,status:'accounted'}).skipped,true);
});
test('Two-record API rejects absent old record and accepts missing sysmod metadata',()=>{
 const f=fixture('META'),rt=engine.createRuntime({store:f.store});
 const old={...f.payment,'current.phase':'initial_dmms'};
 const after={...old,'current.phase':'initial_kttc',status:'dmms_initiated',sysmodcount:2,sysmodtime:time('27','08:10'),sysmoduser:'actor'};
 assert.throws(()=>rt.onWorkflowChanged(null,after),/REQUIRE_OLD_RECORD/);
 const withoutMetadata={...after};delete withoutMetadata.sysmodcount;delete withoutMetadata.sysmodtime;delete withoutMetadata.sysmoduser;
 assert.equal(rt.onWorkflowChanged(old,withoutMetadata).success,true);assert.equal(f.tracks().length,1);
});
test('Two-record API distinguishes prepayment',()=>{
 const f=fixture('PRE-TWO'),rt=engine.createRuntime({store:f.store});
 const c=f.store.get(T.config,'CFG');f.store.put(T.config,{...c,'transaction.type':'Tạm ứng'});
 const old={...f.payment,'transaction.type':'Tạm ứng','current.phase':'initial_dmms',status:'initialized'};
 const after={...old,'current.phase':'initial_kttc',status:'dmms_initiated',sysmodcount:2,sysmodtime:time('27','08:10'),sysmoduser:'actor'};
 rt.onWorkflowChanged(old,after);assert.equal(f.tracks().length,1);assert.equal(f.tracks()[0]['payment.id'],f.payment.id);
});
console.log('Completed',tests,'tests');
