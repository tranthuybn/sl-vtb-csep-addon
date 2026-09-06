const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'ESD_HTKT_ACCOUNTING_ERROR_HANDLING.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, 'ESD_HTKT_ACCOUNTING_UTILS.js'), 'utf8');

function setup(type = 'AP', status = 'ERROR', code = '1001') {
    const rows = [{ id: '1', 'request.id': 'old', 'prepayment.id': 'TU.1', type,
        'sub.type': type === 'CORE' ? 'INHOUSE' : 'TAM_UNG', status, amount: 500,
        data: JSON.stringify({ requestId: 'old', amount: 500, data: { trnRefNum: 'old' } }),
        response: JSON.stringify({ status: { code } }) }];
    const calls = [];
    let failSave = false;
    class SCFile {
        doSelect(query) {
            this.matches = rows.filter(r => [...query.matchAll(/(request.id|prepayment.id)="([^"]*)"/g)]
                .every(m => r[m[1]] === m[2]));
            this.index = 0;
            return this.load();
        }
        load() {
            this.record = this.matches[this.index];
            if (!this.record) return 1;
            Object.assign(this, structuredClone(this.record));
            return 0;
        }
        getNext() { this.index++; return this.load(); }
        doUpdate() {
            if (failSave) return 9;
            for (const key of Object.keys(this)) {
                if (!['matches', 'index', 'record'].includes(key)) this.record[key] = this[key];
            }
            return 0;
        }
        doClose() {}
    }
    const ctx = { SCFile, SCFILE_READONLY: 1, RC_SUCCESS: 0, RC_NO_MORE: 1,
        getLog: () => ({ info() {} }), print() {}, rteJSONStringify: JSON.stringify, rteJSONParse: JSON.parse,
        funcs: { tod: () => new Date() }, system: { functions: { tod: () => new Date(), operator: () => 'tester' } },
        lib: { UUID: { generateUUID: () => 'new-id' }, ESD_HTKT_Utils: { createSchedule() {} },
            ESD_HTKT_INVOICE_OGL_INTEGRATION: {}, ESD_HTKT_FUND_TRANSFER_INTEGRATION: {} } };
    const api = payload => {
        calls.push(structuredClone(payload));
        return type === 'CORE' ? { status: { code: '0', detail: 'OK' } } :
            { success: true, data: { transactionId: 'tx-new' } };
    };
    Object.assign(ctx.lib.ESD_HTKT_INVOICE_OGL_INTEGRATION, { createApInvoice: api, createApPayment: api, createBatchGL: api });
    Object.assign(ctx.lib.ESD_HTKT_FUND_TRANSFER_INTEGRATION, { fundTranfer: api, fundTranferOut: api });
    const utils = vm.createContext({ ...ctx });
    vm.runInContext(utilsSource, utils);
    ctx.lib.ESD_HTKT_ACCOUNTING_UTILS = { callApiAp: utils.callApiAp, callApiGl: utils.callApiGl,
        callApiCore: utils.callApiCore, checkCompleteAccounting() {} };
    vm.createContext(ctx);
    vm.runInContext(source, ctx);
    return { rows, calls, ctx, failSave: () => { failSave = true; },
        run: (extra = {}) => ctx.retryAccountingErrorsResult({ queryString: JSON.stringify({ rows: [{ requestId: 'old' }], confirmed: true, ...extra }) }) };
}

let s = setup();
assert.equal(s.run({ confirmed: false }).requiresConfirmation, true);
assert.equal(s.calls.length, 0);
for (const status of ['COMPLETED', 'NEW', 'PROCESSING', 'IN_QUEUE']) {
    s = setup('AP', status); assert.equal(s.run().failed, 1); assert.equal(s.calls.length, 0);
}
for (const type of ['AP', 'GL', 'CORE']) {
    s = setup(type);
    const result = s.run();
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].requestId, 'new-id');
    assert.equal(s.calls[0].amount, 500);
    if (type === 'CORE') assert.equal(s.calls[0].data.trnRefNum, 'new-id');
    assert.equal(JSON.parse(s.rows[0].response).retryHistory[0].requestId, 'old');
}
s = setup('CORE', 'ERROR', '98'); assert.equal(s.run().failed, 1); assert.equal(s.calls.length, 0);
s = setup(); s.rows[0]['ap.code'] = 'invoice-old';
assert.equal(s.run().requiresConfirmation, true); assert.equal(s.calls.length, 0);
assert.equal(s.run({ invoiceCancellationConfirmed: true }).success, true);
s = setup(); s.failSave(); assert.equal(s.run().failed, 1); assert.equal(s.calls.length, 0);
s = setup(); s.rows[0].data = 'invalid'; assert.equal(s.run().failed, 1); assert.equal(s.calls.length, 0);
s = setup(); assert.equal(s.run({ rows: [{ requestId: 'old' }, { requestId: 'old' }] }).updated, 1);
assert.equal(s.calls.length, 1);
s = setup(); s.ctx.lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.createApInvoice = () => { throw Error('timeout'); };
assert.equal(s.run().errors[0].requiresReconciliation, true); assert.equal(s.rows[0].status, 'PROCESSING');
console.log('Passed retry scenarios using actual ACCOUNTING_UTILS API helpers.');
