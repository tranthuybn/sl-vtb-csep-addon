/** ScriptLibrary: ESD_HTKT_SLA_STORE. SCFile adapter; no automatic invocation.
 * All read/write failures are raised; never treat an unavailable table as empty.
 * Date/time adapter options must match deployed SM field representations.
 */
var SLA_FIELDS = {
    esdHTKTslaLock: "payment.id,owner,acquired.at",
    esdHTKTpayment: "id,transaction.type,initial.role,current.phase,status,created.by,current.executor,require.check.level1,require.check.level2,user.checker.kttc,user.checker.dmms,user.approver.dmms,user.approver.kttc,user.checker.final,user.approver.final",
    esdHTKTslaCalendar: "id,name,timezone,created.by,created.at,updated.by,updated.at",
    esdHTKTslaWorkingHour: "id,calendar.id,day.of.week,start.time,end.time",
    esdHTKTslaHoliday: "id,calendar.id,holiday.date,holiday.name,holiday.type,note,created.by,created.at",
    esdHTKTslaConfig: "id,transaction.type,product.type,calendar.id,effective.from,effective.to,status",
    esdHTKTslaConfigDetail: "id,sla.config.id,role.code,role.name,step.order,sla.hours,alert.stage1.rate,alert.stage2.rate,is.active",
    esdHTKTslaTracking: "id,payment.id,sla.config.id,sla.config.detail.id,calendar.id,role.code,attempt.no,started.at,ended.at,due.at,sla.minutes,elapsed.minutes,remaining.minutes,current.assignee,status,alert.status,last.calculated.at,created.at,updated.at,alert.stage1.rate,alert.stage2.rate,end.reason,result",
    esdHTKTslaTimeSegment: "id,sla.tracking.id,segment.no,started.at,ended.at,working.minutes,start.event,end.event,assignee,created.at",
    esdHTKTslaAlertHistory: "id,sla.tracking.id,alert.stage,threshold.rate,recipient.user,recipient.email,triggered.at,sent.at,send.status,retry.count,error.message,created.at,updated.at",
    esdHTKTslaEventLog: "id,sla.tracking.id,payment.id,event.type,event.at,from.status,to.status,from.phase,to.phase,role.code,performed.by,assignee,data,created.at,processing.status,event.key"
};
function quoteValue(value) {
    return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function createStore(options) {
    options = options || {};
    function fields(table) {
        if (!SLA_FIELDS[table]) throw new Error("SLA_UNKNOWN_TABLE: " + table);
        return SLA_FIELDS[table].split(",");
    }
    function copy(file, table) {
        var result = {}, names = fields(table), i, value;
        for (i = 0; i < names.length; i++) {
            value = file[names[i]];
            result[names[i]] = typeof value === "undefined" ? null : value;
        }
        return result;
    }
    function list(table, filter) {
        var f = new SCFile(table, SCFILE_READONLY), query = [], key, rows = [], rc;
        fields(table);
        for (key in filter) if (Object.prototype.hasOwnProperty.call(filter, key)) {
            query.push(key + "=" + quoteValue(filter[key]));
        }
        try {
            rc = f.doSelect(query.length ? query.join(" and ") : "true");
            while (rc === RC_SUCCESS) { rows.push(copy(f, table)); rc = f.getNext(); }
            if (rc !== RC_NO_MORE) throw new Error("SLA_SELECT_FAILED: " + table + " rc=" + rc);
            return rows;
        } finally { if (typeof f.close === "function") f.close(); }
    }
    function get(table, id) {
        var rows = list(table, {id: id});
        if (rows.length > 1) throw new Error("SLA_DUPLICATE_ID: " + table);
        return rows.length ? rows[0] : null;
    }
    function put(table, row) {
        var f = new SCFile(table), rc, exists, names = fields(table), i;
        if (!row.id) throw new Error("SLA_MISSING_ROW_ID");
        try {
            rc = f.doSelect("id=" + quoteValue(row.id));
            if (rc !== RC_SUCCESS && rc !== RC_NO_MORE) throw new Error("SLA_WRITE_SELECT_FAILED: " + table + " rc=" + rc);
            exists = rc === RC_SUCCESS;
            for (i = 0; i < names.length; i++) {
                if (Object.prototype.hasOwnProperty.call(row, names[i])) {
                    var value = row[names[i]];
                    if (value !== null && typeof value !== "undefined" && /\.(at|from|to)$/.test(names[i])) {
                        value = options.encodeInstant ? options.encodeInstant(value) : new Date(value);
                        if (!options.encodeInstant && !isFinite(value.getTime())) throw new Error("SLA_INVALID_WRITE_TIMESTAMP");
                    }
                    if (value !== null && names[i] === "holiday.date" && options.encodeDate) value = options.encodeDate(value);
                    if (value !== null && (names[i] === "start.time" || names[i] === "end.time") && options.encodeTime) value = options.encodeTime(value);
                    f[names[i]] = value;
                }
            }
            rc = exists ? f.doUpdate() : f.doInsert();
            if (rc !== RC_SUCCESS) throw new Error("SLA_WRITE_FAILED: " + table + " id=" + row.id + " rc=" + rc);
        } finally { if (typeof f.close === "function") f.close(); }
    }
    function withPaymentLock(paymentId, task) {
        // Atomic PK insert is the mutex. Never steal a lock based on elapsed time.
        var f = new SCFile("esdHTKTslaLock"), owner = String(new Date().getTime()) + "-" + String(Math.random()) + "-" + String(Math.random());
        var rc, answer, failure = null;
        f["payment.id"] = paymentId; f.owner = owner; f["acquired.at"] = new Date();
        rc = f.doInsert();
        if (typeof f.close === "function") f.close();
        if (rc !== RC_SUCCESS) throw new Error("SLA_LOCK_ACQUIRE_FAILED_RETRY: " + paymentId + " rc=" + rc);
        try { answer = task(); } catch (error) { failure = error; }
        f = new SCFile("esdHTKTslaLock");
        try {
            rc = f.doSelect('payment.id=' + quoteValue(paymentId));
            if (rc !== RC_SUCCESS || String(f.owner) !== owner) throw new Error("SLA_LOCK_OWNERSHIP_LOST");
            rc = f.doDelete();
            if (rc !== RC_SUCCESS) throw new Error("SLA_LOCK_RELEASE_FAILED: " + paymentId + " rc=" + rc);
        } finally { if (typeof f.close === "function") f.close(); }
        if (failure) throw failure;
        return answer;
    }
    return { get: get, list: list, put: put, withPaymentLock: withPaymentLock,
        decodeInstant: options.decodeInstant || function(value) { return value; },
        decodeDate: options.decodeDate || function(value) { return String(value); },
        decodeTime: options.decodeTime || function(value) { return String(value); }
    };
}
