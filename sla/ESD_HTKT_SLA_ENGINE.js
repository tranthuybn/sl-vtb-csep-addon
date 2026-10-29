/**
 * ScriptLibrary: ESD_HTKT_SLA_ENGINE
 * -----------------------------------------------------------------------------
 * Module      : HTKT - Engine SLA dùng chung
 * Version     : 2.0.0
 *
 * Chức năng   : Tính thời gian theo lịch làm việc và ghi toàn bộ vòng đời SLA:
 *               Tracking, Time Segment và EventLog.
 * Phạm vi     : Engine dùng chung cho các loại giao dịch và chứa trực tiếp quy tắc
 *               chuyển phase/role của luồng SLA.
 * Entry point : onWorkflowChanged(), snapshot(), createRuntime(), buildBaseline() và installBaseline().
 * Môi trường  : OpenText Service Manager (JavaScript ES5 Engine).
 * -----------------------------------------------------------------------------
 */

function slaCalendarApi() {
    return {toMillis:toMillis, compileCalendar:compileCalendar, workingMillis:workingMillis,
        addMillis:addMillis, getWorkingMinutes:getWorkingMinutes, addWorkingMinutes:addWorkingMinutes};
}
function slaCalculatorApi() {
    return {calculateTracking:calculateTracking, calculateTransactionTracking:calculateTransactionTracking};
}
function slaPolicyApi() { return {buildCommands:buildCommands}; }

/* =============================================================================
 * POLICY LUỒNG SLA DÙNG CHUNG
 * Chuyển sự kiện workflow thành START/COMPLETE/RETURN/REASSIGN/CANCEL.
 * ============================================================================= */

function sourceTableFor(record) {
    var type = String(record["transaction.type"] || "");
    var table = type === "Tạm ứng" ? "esdHTKTprepayment" : "esdHTKTpayment";
    return table;
}
function sourceTableForId(id) {
    id = String(id || "");
    if (/^TU/.test(id)) return "esdHTKTprepayment";
    if (/^(DC|TT)/.test(id)) return "esdHTKTpayment";
    throw new Error("SLA_UNKNOWN_DOCUMENT_PREFIX: " + id);
}
function isInitialStatus(status) {
    return status === "dmms_created" || status === "kttc_created" || status === "initialized";
}

var SLA_ROLES = {
    initial_dmms: "user.created.dmms", initial_kttc: "user.checker.kttc", check_dmms: "user.checker.dmms",
    approval_dmms: "user.approver.dmms", approval_kttc: "user.approver.kttc",
    check_final: "user.checker.final", approval_final: "user.approver.final"
};
var SLA_ACTORS = {
    "user.created.dmms": "created.by", "user.checker.kttc": "user.checker.kttc", "user.checker.dmms": "user.checker.dmms",
    "user.approver.dmms": "user.approver.dmms", "user.approver.kttc": "user.approver.kttc",
    "user.checker.final": "user.checker.final", "user.approver.final": "user.approver.final"
};
function isTrue(value) { return value === true || value === 1 || value === "true" || value === "1"; }
function makerRole(payment) {
    if (payment["initial.role"] === "dmms") return "user.created.dmms";
    if (payment["initial.role"] === "kttc") return "user.checker.kttc";
    throw new Error("SLA_INVALID_INITIAL_ROLE");
}
function assignee(payment, role) {
    if (role === "user.checker.kttc" && payment["initial.role"] === "kttc") return String(payment["created.by"] || "");
    return String(payment[SLA_ACTORS[role]] || "");
}
function buildWorkflowCommands(event) {
    var after = event.after, before = event.before || {}, commands = [], kind = event.kind;
    var transactionType = after ? String(after["transaction.type"] || "") : "";
    if (transactionType !== "Dự chi" && transactionType !== "Tạm ứng" && transactionType !== "Thanh toán") {
        throw new Error("SLA_UNSUPPORTED_TRANSACTION_TYPE: " + transactionType);
    }
    if (!after.id || !event.id || !event.performedBy) throw new Error("SLA_MISSING_EVENT_ID_OR_ACTOR");
    if (before.id && String(before.id) !== String(after.id)) throw new Error("SLA_PAYMENT_MISMATCH");
    var from = String(before["current.phase"] || ""), to = String(after["current.phase"] || "");
    var role, key;
    function start(r) { if (isInitialStatus(after.status)) return; commands.push({type: "START", role: r, assignee: assignee(after, r)}); }
    if (kind === "CREATE") {
        if (!isInitialStatus(after.status)) throw new Error("SLA_INVALID_CREATE_STATUS");
        start(makerRole(after));
    } else if (kind === "RETURN") {
        if (after.status !== "request_edit" || before.status === "request_edit") throw new Error("SLA_INVALID_RETURN");
        commands.push({type: "RETURN_ALL"}); start(makerRole(after));
    } else if (kind === "CANCEL") {
        if (after.status !== "cancelled") throw new Error("SLA_INVALID_CANCEL");
        commands.push({type: "CANCEL_ALL"});
    } else if (kind === "REASSIGN") {
        if (before["initial.role"] !== after["initial.role"] ||
                isTrue(before["require.check.level1"]) !== isTrue(after["require.check.level1"]) ||
                isTrue(before["require.check.level2"]) !== isTrue(after["require.check.level2"])) throw new Error("SLA_REASSIGN_MUST_NOT_CHANGE_ROUTE");
        if (before.status !== after.status || from !== to) throw new Error("SLA_REASSIGN_MUST_NOT_CHANGE_STEP");
        if (after.status === "cancelled" || after.status === "approved" || after.status === "accounted") throw new Error("SLA_REASSIGN_CLOSED_PAYMENT");
        for (role in SLA_ACTORS) if (Object.prototype.hasOwnProperty.call(SLA_ACTORS, role)) {
            key = SLA_ACTORS[role];
            if (String(before[key] || "") !== String(after[key] || "")) {
                commands.push({type: "REASSIGN", role: role, assignee: assignee(after, role), oldAssignee: assignee(before, role)});
            }
        }
        if (!commands.length) throw new Error("SLA_NO_ASSIGNEE_CHANGE");
    } else if (kind === "TRANSITION") {
        if (after.status === "request_edit" || after.status === "cancelled") throw new Error("SLA_USE_RETURN_OR_CANCEL_EVENT");
        // The workflow initially routes start -> maker; this does not finish the maker SLA.
        if (from === "start" && ((to === "initial_dmms" && makerRole(after) === "user.created.dmms") ||
                (to === "initial_kttc" && makerRole(after) === "user.checker.kttc"))) return [];
        if (from === to && (isInitialStatus(before.status)) &&
                !isInitialStatus(after.status) && (to === "initial_dmms" || to === "initial_kttc")) {
            start(SLA_ROLES[to]); return commands;
        }
        if (!SLA_ROLES[from] || from === to) throw new Error("SLA_INVALID_PHASE_TRANSITION");
        if (before.status === "approved" || before.status === "accounted" || before.status === "cancelled") throw new Error("SLA_PAYMENT_ALREADY_FINISHED");
        var expected = {
            initial_dmms: "initial_kttc",
            initial_kttc: after["initial.role"] === "kttc" ? "approval_kttc" :
                isTrue(after["require.check.level1"]) ? "check_dmms" : "approval_dmms",
            check_dmms: "approval_dmms", approval_dmms: "approval_kttc",
            approval_kttc: isTrue(after["require.check.level2"]) ? "check_final" : "approval_final",
            check_final: "approval_final", approval_final: "end"
        };
        if (to !== expected[from]) throw new Error("SLA_UNEXPECTED_NEXT_PHASE: " + from + " -> " + to);
        if (after["initial.role"] === "kttc" && (from === "initial_dmms" || from === "check_dmms" || from === "approval_dmms")) {
            throw new Error("SLA_PHASE_NOT_IN_KTTC_FLOW");
        }
        role = SLA_ROLES[from];
        if (!isInitialStatus(before.status))
            commands.push({type: "COMPLETE", role: role});
        if (to === "end") {
            if (from !== "approval_final" || after.status !== "approved") throw new Error("SLA_INVALID_FINAL_APPROVAL");
        } else {
            if (!SLA_ROLES[to]) throw new Error("SLA_UNKNOWN_TARGET_PHASE");
            start(SLA_ROLES[to]);
        }
        // Quy tắc dùng chung: nhánh ĐMMS bắt đầu RS2 sau khi PD ĐMMS hoàn thành.
        if (from === "approval_dmms" && isTrue(after["require.check.level2"])) start("user.checker.final");
        // Nhánh KTTC bắt đầu RS2 khi PD KTTC chuyển sang check_final.
    } else throw new Error("SLA_UNKNOWN_EVENT_KIND: " + kind);
    return commands;
}


function buildCommands(event) {
    return buildWorkflowCommands(event);
}

/* =============================================================================
 * LỊCH LÀM VIỆC
 * ============================================================================= */
var SLA_DAY_MS = 86400000;
var SLA_MINUTE_MS = 60000;
var SLA_OFFSET_MS = 7 * 60 * SLA_MINUTE_MS;

function toMillis(value) {
    var n;
    if (typeof value === "number") n = value;
    else if (value && typeof value.getTime === "function") n = value.getTime();
    else if (typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
        n = Date.parse(value);
    } else throw new Error("SLA_INVALID_INSTANT: use Date, epoch milliseconds or ISO with timezone");
    if (!isFinite(n) || Math.abs(n) > 8640000000000000) throw new Error("SLA_INVALID_INSTANT");
    return n;
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }
function dateKey(day) {
    var d = new Date(day * SLA_DAY_MS);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}
function clockMinutes(value) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(value));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error("SLA_INVALID_WORKING_TIME: " + value);
    return Number(m[1]) * 60 + Number(m[2]);
}
function compileCalendar(calendar) {
    if (!calendar || calendar.timezone !== "Asia/Ho_Chi_Minh") {
        throw new Error("SLA_UNSUPPORTED_TIMEZONE: expected Asia/Ho_Chi_Minh");
    }
    var compiled = { days: {}, holidays: {} }, rows = calendar.workingHours || [];
    var i, row, day, start, end, slots, j, key, parsed;
    if (!rows.length) throw new Error("SLA_EMPTY_WORKING_HOURS");
    for (i = 0; i < rows.length; i++) {
        row = rows[i]; day = Number(row.dayOfWeek);
        if (day < 1 || day > 7 || day !== Math.floor(day)) throw new Error("SLA_INVALID_WEEKDAY");
        start = clockMinutes(row.startTime); end = clockMinutes(row.endTime);
        if (end <= start) throw new Error("SLA_INVALID_WORKING_INTERVAL");
        if (!compiled.days[day]) compiled.days[day] = [];
        compiled.days[day].push([start, end]);
    }
    for (day = 1; day <= 7; day++) {
        slots = compiled.days[day] || [];
        slots.sort(function(a, b) { return a[0] - b[0]; });
        for (j = 1; j < slots.length; j++) {
            if (slots[j][0] < slots[j - 1][1]) throw new Error("SLA_OVERLAPPING_WORKING_HOURS");
        }
    }
    rows = calendar.holidays || [];
    for (i = 0; i < rows.length; i++) {
        key = String(rows[i]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("SLA_INVALID_HOLIDAY: " + key);
        parsed = Date.parse(key + "T00:00:00Z");
        if (!isFinite(parsed) || dateKey(Math.floor(parsed / SLA_DAY_MS)) !== key) {
            throw new Error("SLA_INVALID_HOLIDAY: " + key);
        }
        compiled.holidays[key] = true;
    }
    return compiled;
}
function daySlots(compiled, day) {
    if (compiled.holidays[dateKey(day)]) return [];
    var weekday = new Date(day * SLA_DAY_MS).getUTCDay();
    return compiled.days[weekday === 0 ? 7 : weekday] || [];
}
function workingMillis(compiled, start, end) {
    if (end < start) throw new Error("SLA_END_BEFORE_START");
    var first = Math.floor((start + SLA_OFFSET_MS) / SLA_DAY_MS);
    var last = Math.floor((end + SLA_OFFSET_MS) / SLA_DAY_MS);
    if (last - first > 36600) throw new Error("SLA_RANGE_TOO_LARGE");
    var day, slots, i, base, a, b, total = 0;
    for (day = first; day <= last; day++) {
        slots = daySlots(compiled, day); base = day * SLA_DAY_MS - SLA_OFFSET_MS;
        for (i = 0; i < slots.length; i++) {
            a = Math.max(start, base + slots[i][0] * SLA_MINUTE_MS);
            b = Math.min(end, base + slots[i][1] * SLA_MINUTE_MS);
            if (b > a) total += b - a;
        }
    }
    return total;
}
function addMillis(compiled, start, duration) {
    if (!isFinite(duration) || duration < 0) throw new Error("SLA_INVALID_DURATION");
    if (duration === 0) return start;
    var first = Math.floor((start + SLA_OFFSET_MS) / SLA_DAY_MS);
    var day, slots, i, base, a, b;
    for (day = first; day <= first + 36600; day++) {
        slots = daySlots(compiled, day); base = day * SLA_DAY_MS - SLA_OFFSET_MS;
        for (i = 0; i < slots.length; i++) {
            a = Math.max(start, base + slots[i][0] * SLA_MINUTE_MS);
            b = base + slots[i][1] * SLA_MINUTE_MS;
            if (b <= a) continue;
            if (duration <= b - a) return a + duration;
            duration -= b - a;
        }
    }
    throw new Error("SLA_DUE_DATE_OUT_OF_RANGE");
}
function getWorkingMinutes(calendar, start, end) {
    return workingMillis(compileCalendar(calendar), toMillis(start), toMillis(end)) / SLA_MINUTE_MS;
}
function addWorkingMinutes(calendar, start, minutes) {
    if (typeof minutes !== "number" || !isFinite(minutes) || minutes < 0) throw new Error("SLA_INVALID_DURATION");
    return new Date(addMillis(compileCalendar(calendar), toMillis(start), minutes * SLA_MINUTE_MS));
}


/* =============================================================================
 * TÍNH TOÁN SLA
 * ============================================================================= */
function calculateTracking(calendarLib, calendar, tracking, segments, asOf) {
    if (!calendarLib || !tracking || !segments || !segments.length) throw new Error("SLA_MISSING_INPUT");
    var c = calendarLib.compileCalendar(calendar);
    var now = calendarLib.toMillis(asOf);
    var start = calendarLib.toMillis(tracking.startedAt);
    var closed = tracking.endedAt !== null && typeof tracking.endedAt !== "undefined";
    var end = closed ? calendarLib.toMillis(tracking.endedAt) : now;
    var budget = tracking.slaMinutes;
    if (typeof budget !== "number" || !isFinite(budget) || budget <= 0) throw new Error("SLA_INVALID_BUDGET");
    if (end < start || end > now) throw new Error("SLA_INVALID_TRACKING_RANGE");
    var rows = [], i, segment, a, b, open, previousEnd = start;
    for (i = 0; i < segments.length; i++) {
        segment = segments[i]; a = calendarLib.toMillis(segment.startedAt);
        open = segment.endedAt === null || typeof segment.endedAt === "undefined";
        if (closed && open) throw new Error("SLA_OPEN_SEGMENT_IN_CLOSED_TRACKING");
        b = open ? end : calendarLib.toMillis(segment.endedAt);
        if (a < start || b < a || b > end) throw new Error("SLA_INVALID_SEGMENT_RANGE");
        rows.push({ start: a, end: b, open: open, index: i });
    }
    rows.sort(function(x, y) { return x.start - y.start || x.end - y.end; });
    if (rows[0].start !== start) throw new Error("SLA_FIRST_SEGMENT_MUST_START_WITH_TRACKING");
    var totalMs = 0, usedMs, pausedMs = 0, results = [], running = false;
    for (i = 0; i < rows.length; i++) {
        segment = rows[i];
        if (segment.start < previousEnd) throw new Error("SLA_OVERLAPPING_SEGMENTS");
        if (segment.open && i !== rows.length - 1) throw new Error("SLA_OPEN_SEGMENT_NOT_LAST");
        pausedMs += calendarLib.workingMillis(c, previousEnd, segment.start);
        usedMs = calendarLib.workingMillis(c, segment.start, segment.end);
        totalMs += usedMs;
        results.push({ inputIndex: segment.index, workingMinutes: usedMs / 60000 });
        previousEnd = segment.end; running = segment.open;
    }
    pausedMs += calendarLib.workingMillis(c, previousEnd, end);
    var budgetMs = budget * 60000, remainingMs = budgetMs - totalMs;
    // An actual deadline can be recovered from segments once the budget is consumed.
    // Before consumption: initial budget plus excluded working time in gaps (pauses).
    // While paused the future resume instant is unknown, so no reliable dueAt exists.
    var due = null, consumed = 0;
    if (totalMs >= budgetMs) {
        for (i = 0; i < rows.length; i++) {
            usedMs = calendarLib.workingMillis(c, rows[i].start, rows[i].end);
            if (consumed + usedMs >= budgetMs) {
                due = new Date(calendarLib.addMillis(c, rows[i].start, budgetMs - consumed)); break;
            }
            consumed += usedMs;
        }
    } else if (closed || running) {
        due = new Date(calendarLib.addMillis(c, start, budgetMs + pausedMs));
    }
    return {
        slaMinutes: budget, elapsedMinutes: totalMs / 60000,
        remainingMinutes: remainingMs / 60000, dueAt: due,
        status: closed ? "Đã kết thúc" : remainingMs <= 0 ? "Vi phạm" : "Trong thời gian",
        isRunning: !closed && running, isBreached: remainingMs <= 0,
        segments: results, calculatedAt: new Date(end)
    };
}

// Entry point dùng chung; mỗi Tracking được tính độc lập.
function calculateTransactionTracking(calendarLib, calendar, payment, tracking, segments, asOf) {
    if (!payment || !payment["transaction.type"]) throw new Error("SLA_MISSING_TRANSACTION_TYPE");
    if (!payment.id || tracking.paymentId !== String(payment.id)) throw new Error("SLA_PAYMENT_MISMATCH");
    return calculateTracking(calendarLib, calendar, tracking, segments, asOf);
}


/* =============================================================================
 * LƯU TRỮ SCFILE VÀ KHÓA
 * ============================================================================= */
var SLA_FIELDS = {
    esdHTKTprepayment: "id,transaction.type,initial.role,current.phase,status,created.by,current.executor,require.check.level1,require.check.level2,user.checker.kttc,user.checker.dmms,user.approver.dmms,user.approver.kttc,user.checker.final,user.approver.final",
    esdHTKTpayment: "id,transaction.type,initial.role,current.phase,status,created.by,current.executor,require.check.level1,require.check.level2,user.checker.kttc,user.checker.dmms,user.approver.dmms,user.approver.kttc,user.checker.final,user.approver.final",
    esdHTKTslaWorkingHour: "id,day.of.week,start.time,end.time",
    esdHTKTslaHoliday: "id,holiday.date,holiday.name,holiday.type,note,created.by,created.at",
    esdHTKTslaConfig: "id,transaction.type,product.type,effective.from,effective.to,status",
    esdHTKTslaConfigDetail: "id,sla.config.id,role.code,role.name,sla.hours,is.active",
    esdHTKTslaTracking: "id,payment.id,sla.config.detail.id,role.code,attempt.no,started.at,ended.at,due.at,sla.minutes,current.assignee,status,created.at,end.reason,result",
    esdHTKTslaTimeSegment: "id,sla.tracking.id,segment.no,started.at,ended.at,working.minutes,start.event,end.event,assignee,created.at",
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
                    f[names[i]] = value;
                }
            }
            rc = exists ? f.doUpdate() : f.doInsert();
            if (rc !== RC_SUCCESS) throw new Error("SLA_WRITE_FAILED: " + table + " id=" + row.id + " rc=" + rc);
        } finally { if (typeof f.close === "function") f.close(); }
    }
    return { get: get, list: list, put: put,
        decodeInstant: options.decodeInstant || function(value) { return value; },
        decodeDate: options.decodeDate || function(value) { return String(value); }
    };
}


/* =============================================================================
 * DỊCH VỤ VÒNG ĐỜI SLA
 * ============================================================================= */
var SLA_T = { config: "esdHTKTslaConfig", detail: "esdHTKTslaConfigDetail",
    hours: "esdHTKTslaWorkingHour", holiday: "esdHTKTslaHoliday",
    tracking: "esdHTKTslaTracking", segment: "esdHTKTslaTimeSegment",
    event: "esdHTKTslaEventLog" };
function createService(store, calendarLib, calculator, policyRules, options) {
    options = options || {};
    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    function instant(x) { return calendarLib.toMillis(store.decodeInstant(x)); }
    function iso(x) { return new Date(x).toISOString(); }
    function key(parts) {
        var out = [], i;
        for (i = 0; i < parts.length; i++) out.push(encodeURIComponent(String(parts[i])));
        return out.join("|");
    }
    function rows(table, filter) { return store.list(table, filter || {}); }
    function blank(x) { return x === null || typeof x === "undefined" || x === ""; }
    function truth(x) { return x === true || x === 1 || x === "true" || x === "1"; }
    function loadCalendar() {
        var result = {timezone: "Asia/Ho_Chi_Minh", workingHours: [], holidays: []};
        var list = rows(SLA_T.hours, {}), i;
        for (i = 0; i < list.length; i++) result.workingHours.push({
            dayOfWeek: Number(list[i]["day.of.week"]),
            startTime: String(list[i]["start.time"]), endTime: String(list[i]["end.time"])
        });
        list = rows(SLA_T.holiday, {});
        for (i = 0; i < list.length; i++) result.holidays.push(store.decodeDate(list[i]["holiday.date"]));
        calendarLib.compileCalendar(result); return result;
    }
    function resolveProductType(payment) {
        // Tạm thời chưa có nguồn/trường product.type chính thức trên phiếu.
        // Dùng cấu hình chung để chạy luồng; chỉ sửa hàm này khi nghiệp vụ chốt nguồn.
        return "Tất cả";
    }
    function selectDetail(role, at, payment) {
        var transactionType = String(payment["transaction.type"] || "");
        var productType = resolveProductType(payment);
        var configs = rows(SLA_T.config, {"transaction.type": transactionType});
        var matches = [], i, config, details;
        for (i = 0; i < configs.length; i++) {
            config = configs[i];
            if (instant(config["effective.from"]) <= at &&
                    (blank(config["effective.to"]) || at < instant(config["effective.to"])) &&
                    String(config["product.type"]) === productType) matches.push(config);
        }
        if (matches.length !== 1) throw new Error("SLA_EXPECT_ONE_EFFECTIVE_CONFIG: " + matches.length);
        config = matches[0];
        details = rows(SLA_T.detail, {"sla.config.id": config.id, "role.code": role});
        if (details.length !== 1) throw new Error("SLA_EXPECT_ONE_ROLE_DETAIL: " + role);
        if (!truth(details[0]["is.active"])) return null;
        return { config: config, detail: details[0], calendar: loadCalendar() };
    }
    function hydrateTracking(row) {
        var out = clone(row), names = ["started.at", "ended.at", "due.at", "created.at"], i;
        for (i = 0; i < names.length; i++) if (!blank(row[names[i]])) out[names[i]] = iso(instant(row[names[i]]));
        return out;
    }
    function loadSegments(id) {
        var list = rows(SLA_T.segment, {"sla.tracking.id": id}), i;
        for (i = 0; i < list.length; i++) {
            list[i]["started.at"] = iso(instant(list[i]["started.at"]));
            list[i]["ended.at"] = blank(list[i]["ended.at"]) ? null : iso(instant(list[i]["ended.at"]));
        }
        list.sort(function(a,b) { return Number(a["segment.no"]) - Number(b["segment.no"]); });
        return list;
    }
    function calculate(row, segments, at) {
        var data = [], i;
        for (i = 0; i < segments.length; i++) data.push({startedAt: segments[i]["started.at"], endedAt: segments[i]["ended.at"]});
        var result = calculator.calculateTracking(calendarLib, loadCalendar(), {
            startedAt: row["started.at"], endedAt: row["ended.at"], slaMinutes: Number(row["sla.minutes"])
        }, data, at);
        row["due.at"] = result.dueAt ? result.dueAt.toISOString() : null;
        row.status = result.status;
        for (i = 0; i < result.segments.length; i++) {
            segments[result.segments[i].inputIndex]["working.minutes"] = result.segments[i].workingMinutes;
        }
        return result;
    }
    function journalId(paymentId, eventId, sourceTable) { return key(["EVENT", paymentId, eventId]); }
    function assertNoPending(paymentId, except, sourceTable) {
        var list = rows(SLA_T.event, {"payment.id": paymentId}), i;
        for (i = 0; i < list.length; i++) {
            if (list[i]["processing.status"] === "PREPARED" && list[i].id !== except) {
                throw new Error("SLA_PENDING_EVENT_RETRY_FIRST: " + list[i].id);
            }
        }
    }
    function addWrite(plan, table, row) { plan.push({table: table, row: clone(row)}); }
    function commit(journal) {
        var payload = JSON.parse(journal.data), i;
        // Replaying these deterministic upserts repairs partially applied writes.
        for (i = 0; i < payload.writes.length; i++) store.put(payload.writes[i].table, payload.writes[i].row);
        journal["processing.status"] = "APPLIED"; store.put(SLA_T.event, journal);
        return { success: true, eventId: journal["event.key"], writes: payload.writes.length };
    }
    function applyEvent(event) {
        var commands = policyRules.buildCommands(event);
        var sourceTable = sourceTableFor(event.after);
        if (event.before && sourceTableFor(event.before) !== sourceTable) throw new Error("SLA_SOURCE_TABLE_CHANGED");
        var paymentId = String(event.after.id), rootId = journalId(paymentId, event.id, sourceTable);
        var existing = store.get(SLA_T.event, rootId);
        // Stable JSON payload protects an operation ID from being reused for another business action.
        var input = clone(event), fingerprint = JSON.stringify(input);
        if (existing) {
            if (JSON.parse(existing.data).fingerprint !== fingerprint) throw new Error("SLA_EVENT_ID_REUSED_WITH_DIFFERENT_INPUT");
            if (existing["processing.status"] === "APPLIED") return {success: true, duplicate: true, eventId: event.id};
            assertNoPending(paymentId, rootId, sourceTable); return commit(existing);
        }
        assertNoPending(paymentId, null, sourceTable);
        var atMs = instant(event.eventAt), at = iso(atMs), journalAttempt = 1;
        var journals = rows(SLA_T.event, {"payment.id": paymentId}), i, j;
        for (i = 0; i < journals.length; i++) {
            if (journals[i]["processing.status"] === "APPLIED") journalAttempt = Math.max(journalAttempt, Number(JSON.parse(journals[i].data).attempt || 1));
            if (journals[i]["processing.status"] === "APPLIED" && instant(journals[i]["event.at"]) > atMs) {
                throw new Error("SLA_OUT_OF_ORDER_EVENT");
            }
        }
        var all = rows(SLA_T.tracking, {"payment.id": paymentId}), attempt = journalAttempt, active = {}, plan = [], command, row, segments;
        for (i = 0; i < all.length; i++) {
            attempt = Math.max(attempt, Number(all[i]["attempt.no"]));
            if (blank(all[i]["ended.at"])) {
                if (active[all[i]["role.code"]]) throw new Error("SLA_MULTIPLE_ACTIVE_TRACKINGS_FOR_ROLE");
                row = hydrateTracking(all[i]);
                // A tick may have run after the business event's timestamp but before delivery.
                // Recalculate open intervals at the authoritative event time. Business events
                // themselves remain ordered by the APPLIED journal check above.
                active[row["role.code"]] = {row: row, segments: loadSegments(row.id)};
            }
        }
        if (event.kind === "CREATE" && (all.length || journals.length)) throw new Error("SLA_PAYMENT_ALREADY_INITIALIZED");
        function log(type, role, trackingId, actor, data, suffix) {
            addWrite(plan, SLA_T.event, {id: key([rootId, type, role || "ALL", suffix || ""]),
                "sla.tracking.id": trackingId || null, "payment.id": paymentId,
                "event.type": type, "event.at": at, "from.status": event.before ? event.before.status : null,
                "to.status": event.after.status, "from.phase": event.before ? event.before["current.phase"] : null,
                "to.phase": event.after["current.phase"], "role.code": role || null,
                "performed.by": event.performedBy, assignee: actor || null, data: JSON.stringify(data || {}),
                "created.at": at, "processing.status": null, "event.key": null });
        }
        function persist(state) {
            var calculation = calculate(state.row, state.segments, at);
            for (var n = 0; n < state.segments.length; n++) addWrite(plan, SLA_T.segment, state.segments[n]);
            addWrite(plan, SLA_T.tracking, state.row);
            return calculation;
        }
        function close(role, reason) {
            var state = active[role], n, calculation;
            if (!state) throw new Error("SLA_ACTIVE_TRACKING_NOT_FOUND: " + role);
            for (n = 0; n < state.segments.length; n++) if (blank(state.segments[n]["ended.at"])) {
                state.segments[n]["ended.at"] = at; state.segments[n]["end.event"] = reason;
            }
            state.row["ended.at"] = at; state.row["end.reason"] = reason;
            calculation = persist(state);
            state.row.result = reason === "COMPLETE" ? (calculation.isBreached ? "BREACHED" : "MET") : "NOT_EVALUATED";
            addWrite(plan, SLA_T.tracking, state.row);
            log(reason, role, state.row.id, state.row["current.assignee"]);
            delete active[role];
        }
        for (i = 0; i < commands.length; i++) {
            command = commands[i];
            if (command.type === "RETURN_ALL" || command.type === "CANCEL_ALL") {
                var roleNames = [], r;
                for (r in active) if (Object.prototype.hasOwnProperty.call(active, r)) roleNames.push(r);
                roleNames.sort();
                for (j = 0; j < roleNames.length; j++) close(roleNames[j], command.type === "RETURN_ALL" ? "RETURN" : "CANCEL");
                if (command.type === "RETURN_ALL") attempt++;
                if (!roleNames.length) log(command.type === "RETURN_ALL" ? "RETURN" : "CANCEL", null, null, null);
            } else if (command.type === "COMPLETE") {
                if (active[command.role]) close(command.role, "COMPLETE");
                else {
                    // Inactive configured roles have no tracking; missing active ones are a data error.
                    var disabled = selectDetail(command.role, atMs, event.after);
                    if (disabled !== null) throw new Error("SLA_ACTIVE_TRACKING_NOT_FOUND: " + command.role);
                }
            } else if (command.type === "START") {
                // RS2 started early at ĐMMS approval keeps its original clock on entry to check_final.
                if (active[command.role]) {
                    if (command.role !== "user.checker.final" || String(event.after["current.phase"]) !== "check_final") {
                        throw new Error("SLA_ROLE_ALREADY_RUNNING: " + command.role);
                    }
                    continue;
                }
                var selected = selectDetail(command.role, atMs, event.after);
                if (selected === null) continue;
                if (!command.assignee) throw new Error("SLA_MISSING_ASSIGNEE: " + command.role);
                var detail = selected.detail;
                var hours = Number(detail["sla.hours"]);
                if (!isFinite(hours) || hours <= 0) throw new Error("SLA_INVALID_HOURS");
                var tid = key([paymentId, attempt, command.role]);
                if (store.get(SLA_T.tracking, tid)) throw new Error("SLA_TRACKING_ALREADY_EXISTS: " + tid);
                row = {id: tid, "payment.id": paymentId,
                    "sla.config.detail.id": detail.id,
                    "role.code": command.role, "attempt.no": attempt, "started.at": at, "ended.at": null,
                    "sla.minutes": hours * 60, "current.assignee": command.assignee,
                    "end.reason": null, result: null, "created.at": at};
                segments = [{id: key([tid, "SEG", 1]), "sla.tracking.id": tid, "segment.no": 1,
                    "started.at": at, "ended.at": null, "working.minutes": 0,
                    "start.event": event.kind === "RETURN" ? "RESET" : "START", "end.event": null,
                    assignee: command.assignee, "created.at": at}];
                active[command.role] = {row: row, segments: segments}; persist(active[command.role]);
                log(event.kind === "RETURN" ? "RESET" : "START", command.role, tid, command.assignee);
            } else if (command.type === "REASSIGN") {
                var state = active[command.role];
                if (!command.assignee) throw new Error("SLA_MISSING_NEW_ASSIGNEE");
                if (!state) {
                    // A future step has no clock to start/reset.
                    for (j = 0; j < all.length; j++) {
                        if (Number(all[j]["attempt.no"]) === attempt && all[j]["role.code"] === command.role) {
                            throw new Error("SLA_CANNOT_REASSIGN_COMPLETED_STEP");
                        }
                    }
                    log("REASSIGN", command.role, null, command.assignee, {from: command.oldAssignee, to: command.assignee});
                    continue;
                }
                if (state.row["current.assignee"] !== command.oldAssignee) throw new Error("SLA_STALE_ASSIGNEE");
                var found = 0, seq = 0;
                for (j = 0; j < state.segments.length; j++) {
                    seq = Math.max(seq, Number(state.segments[j]["segment.no"]));
                    if (blank(state.segments[j]["ended.at"])) {
                        state.segments[j]["ended.at"] = at; state.segments[j]["end.event"] = "REASSIGN"; found++;
                    }
                }
                if (found !== 1) throw new Error("SLA_EXPECT_ONE_OPEN_SEGMENT");
                seq++;
                state.segments.push({id: key([state.row.id, "SEG", seq]), "sla.tracking.id": state.row.id,
                    "segment.no": seq, "started.at": at, "ended.at": null, "working.minutes": 0,
                    "start.event": "REASSIGN", "end.event": null, assignee: command.assignee, "created.at": at});
                state.row["current.assignee"] = command.assignee; persist(state);
                log("REASSIGN", command.role, state.row.id, command.assignee, {from: command.oldAssignee, to: command.assignee});
            }
        }
        var journal = {id: rootId, "payment.id": paymentId, "event.type": "WORKFLOW",
            "event.at": at, "event.key": String(event.id), "performed.by": event.performedBy,
            "from.status": event.before ? event.before.status : null, "to.status": event.after.status,
            "from.phase": event.before ? event.before["current.phase"] : null, "to.phase": event.after["current.phase"],
            "created.at": at, "processing.status": "PREPARED", data: JSON.stringify({fingerprint: fingerprint, attempt: attempt, writes: plan})};
        store.put(SLA_T.event, journal); return commit(journal);
    }
    function refresh(paymentId, asOf, sourceTable) {
        sourceTable = sourceTable || sourceTableForId(paymentId);
        if (sourceTable !== "esdHTKTpayment" && sourceTable !== "esdHTKTprepayment") throw new Error("SLA_INVALID_SOURCE_TABLE");
        var payment = store.get(sourceTable, paymentId);
        if (payment) sourceTableFor(payment);
        if (!payment) throw new Error("SLA_PAYMENT_NOT_FOUND");
        assertNoPending(paymentId, null, sourceTable);
        if (payment.status === "cancelled" || payment.status === "approved" || payment.status === "accounted") {
            var dangling = rows(SLA_T.tracking, {"payment.id": paymentId}), d;
            for (d = 0; d < dangling.length; d++) if (blank(dangling[d]["ended.at"])) throw new Error("SLA_MISSING_TERMINAL_WORKFLOW_EVENT");
            return {success: true, paymentId: paymentId, calculated: 0};
        }
        var atMs = instant(asOf), at = iso(atMs), list = rows(SLA_T.tracking, {"payment.id": paymentId});
        var count = 0, i, j, row, segments, result;
        // Validate every active tracking before writing any result for this payment.
        var prepared = [];
        for (i = 0; i < list.length; i++) {
            if (!blank(list[i]["ended.at"])) continue;
            row = hydrateTracking(list[i]);
            segments = loadSegments(row.id); result = calculate(row, segments, at);
            prepared.push({row: row, segments: segments, result: result});
        }
        for (i = 0; i < prepared.length; i++) {
            row = prepared[i].row; segments = prepared[i].segments; result = prepared[i].result;
            for (j = 0; j < segments.length; j++) store.put(SLA_T.segment, segments[j]);
            store.put(SLA_T.tracking, row); count++;
        }
        return {success: true, paymentId: paymentId, calculated: count};
    }
    function retryPrepared(paymentId, sourceTable) {
        var list = rows(SLA_T.event, {"payment.id": paymentId, "processing.status": "PREPARED"});
        if (list.length > 1) throw new Error("SLA_MULTIPLE_PENDING_EVENTS_REQUIRE_RECONCILIATION");
        return list.length ? commit(list[0]) : {success: true, writes: 0};
    }
    return {
        applyEvent: function(event) {
            if (!event || !event.after || !event.after.id) throw new Error("SLA_MISSING_PAYMENT");
            return applyEvent(event);
        },
        refresh: function(paymentId, asOf, sourceTable) {
            return refresh(paymentId, asOf, sourceTable);
        },
        retryPrepared: function(paymentId, sourceTable) {
            return retryPrepared(paymentId, sourceTable);
        }
    };
}


/* =============================================================================
 * RUNTIME VÀ ENTRY POINT WORKFLOW
 * ============================================================================= */
function snapshot(record) {
    if (!record) return null;
    var names = ["id", "transaction.type", "initial.role", "current.phase", "status", "created.by", "current.executor",
        "user.checker.kttc", "user.checker.dmms", "user.approver.dmms", "user.approver.kttc", "user.checker.final", "user.approver.final"];
    var out = {}, i;
    for (i = 0; i < names.length; i++) out[names[i]] = String(record[names[i]] || "");
    names = ["require.check.level1", "require.check.level2"];
    for (i = 0; i < names.length; i++) {
        var value = record[names[i]];
        out[names[i]] = value === true || value === 1 || String(value) === "true" || String(value) === "1";
    }
    return out;
}
/** Workflow entry point: both records must belong to the same committed operation. */
function workflowChangeKind(before, after) {
    if (!after || !after.id) throw new Error("SLA_MISSING_PAYMENT");
    var type = String(after["transaction.type"] || "");
    if (type !== "Dự chi" && type !== "Tạm ứng" && type !== "Thanh toán")
        throw new Error("SLA_UNSUPPORTED_TRANSACTION_TYPE: " + type);
    if (!before || !before.id) {
        if (!isInitialStatus(after.status)) throw new Error("SLA_REQUIRE_OLD_RECORD");
        return "CREATE";
    }
    if (before.id !== after.id) throw new Error("SLA_PAYMENT_MISMATCH");
    if (sourceTableFor(before) !== sourceTableFor(after) || before["transaction.type"] !== after["transaction.type"])
        throw new Error("SLA_SOURCE_TABLE_CHANGED");
    var phaseChanged = before["current.phase"] !== after["current.phase"];
    var statusChanged = before.status !== after.status;
    if (after.status === "cancelled" && before.status !== "cancelled") return "CANCEL";
    if (after.status === "request_edit" && before.status !== "request_edit") return "RETURN";
    // Approval ends SLA; subsequent accounting updates do not restart it.
    if (before.status === "approved" || before.status === "accounted" || before.status === "cancelled") return null;
    if (phaseChanged || (statusChanged && isInitialStatus(before.status) && !isInitialStatus(after.status)))
        return "TRANSITION";
    if (statusChanged) throw new Error("SLA_STATUS_CHANGE_WITHOUT_SUPPORTED_PHASE_TRANSITION");
    var role, field;
    for (role in SLA_ACTORS) if (Object.prototype.hasOwnProperty.call(SLA_ACTORS, role)) {
        field = SLA_ACTORS[role];
        if (String(before[field] || "") !== String(after[field] || "")) return "REASSIGN";
    }
    return null;
}
function onWorkflowChanged(oldRecord, record) {
    return createRuntime().onWorkflowChanged(oldRecord, record);
}

function createRuntime(options) {
    options = options || {};
    var store = options.store || createStore(options);
    var calendar = slaCalendarApi();
    var service = createService(store, calendar, slaCalculatorApi(), slaPolicyApi(), {});
    function onBusinessCommitted(kind, before, after, context) {
        if (!after) throw new Error("SLA_MISSING_PAYMENT");
        context = context || {};
        if (!context.operationId || !context.eventAt || !context.performedBy) throw new Error("SLA_REQUIRE_STABLE_OPERATION_CONTEXT");
        return service.applyEvent({id: String(context.operationId), kind: kind,
            eventAt: new Date(calendar.toMillis(store.decodeInstant(context.eventAt))).toISOString(),
            performedBy: String(context.performedBy), before: snapshot(before), after: snapshot(after)});
    }
    function onChanged(oldRecord, record) {
        var before = snapshot(oldRecord), after = snapshot(record);
        var kind = workflowChangeKind(before, after);
        if (!kind) return {success:true, skipped:true, reason:"NO_SLA_CHANGE"};
        // Read metadata from the saved record, never generate a new clock/ID during retry.
        var revision = record["sysmodcount"], actor = String(record["sysmoduser"] || "");
        if (revision === null || typeof revision === "undefined" || !/^\d+$/.test(String(revision)))
            throw new Error("SLA_REQUIRE_COMMITTED_SYSMODCOUNT");
        if (!record["sysmodtime"]) throw new Error("SLA_REQUIRE_COMMITTED_SYSMODTIME");
        if (!actor) throw new Error("SLA_REQUIRE_COMMITTED_SYSMODUSER");
        var at = new Date(calendar.toMillis(store.decodeInstant(record["sysmodtime"]))).toISOString();
        return onBusinessCommitted(kind, before, after, {
            operationId:"WF:" + String(revision) + ":" + at,
            eventAt:at, performedBy:actor
        });
    }
    return {service: service, store: store, onBusinessCommitted: onBusinessCommitted,
        onWorkflowChanged:onChanged};
}


/* =============================================================================
 * KHỞI TẠO CẤU HÌNH
 * ============================================================================= */
function buildBaseline(calendarLib, args) {
    if (!args || !args.configId || !args.effectiveFrom || !args.performedBy ||
            Object.prototype.toString.call(args.holidays) !== "[object Array]") throw new Error("SLA_MISSING_BASELINE_INPUT");
    var start = calendarLib.toMillis(args.effectiveFrom);
    var end = args.effectiveTo ? calendarLib.toMillis(args.effectiveTo) : null;
    if (end !== null && end <= start) throw new Error("SLA_INVALID_EFFECTIVE_RANGE");
    var c = {timezone: "Asia/Ho_Chi_Minh", workingHours: [], holidays: args.holidays}, writes = [], d, i;
    for (d = 1; d <= 5; d++) {
        var slots = [["08:00", "12:00"], ["13:00", "17:00"]];
        for (i = 0; i < slots.length; i++) {
            c.workingHours.push({dayOfWeek:d,startTime:slots[i][0],endTime:slots[i][1]});
            writes.push({table:"esdHTKTslaWorkingHour",row:{id:"WH."+d+"."+i,
                "day.of.week":d,"start.time":slots[i][0],"end.time":slots[i][1]}});
        }
    }
    calendarLib.compileCalendar(c);
    var seen = {};
    for (i = 0; i < args.holidays.length; i++) {
        if (seen[args.holidays[i]]) throw new Error("SLA_DUPLICATE_HOLIDAY");
        seen[args.holidays[i]] = true;
        writes.push({table:"esdHTKTslaHoliday",row:{id:"OFF."+args.holidays[i],
            "holiday.date":args.holidays[i],"holiday.name":"Ngày nghỉ được phê duyệt",
            "holiday.type":"OTHER","created.by":args.performedBy,"created.at":new Date().toISOString()}});
    }
    var transactionType = String(args.transactionType || "Dự chi");
    var productType = "Tất cả";
    writes.push({table:"esdHTKTslaConfig",row:{id:args.configId,"transaction.type":transactionType,"product.type":productType,
        "effective.from":new Date(start).toISOString(),
        "effective.to":end === null ? null : new Date(end).toISOString(),status:"Đang hoạt động"}});
    // Source: Thông tin SLA.xlsx, Danh mục SLA, row 19. Order follows actual workflow.
    var roles = [["user.created.dmms",2],["user.checker.kttc",3],["user.checker.dmms",3],["user.approver.dmms",6],
        ["user.approver.kttc",6],["user.checker.final",4.5],["user.approver.final",9]];
    for (i = 0; i < roles.length; i++) writes.push({table:"esdHTKTslaConfigDetail",row:{
        id:args.configId+"."+roles[i][0],"sla.config.id":args.configId,"role.code":roles[i][0],
        "role.name":roles[i][0],"sla.hours":roles[i][1],"is.active":true}});
    return writes;
}
function installBaseline(store, calendarLib, args) {
    var writes = buildBaseline(calendarLib,args), i;
    // Use on an unpublished new version only; interrupted setup requires a new version ID.
    // Giờ làm việc/ngày nghỉ là cấu hình toàn hệ thống và được phép ghi đè.
    // Config/ConfigDetail vẫn dùng ID riêng để bảo vệ lịch sử cấu hình SLA.
    for (i = 0; i < writes.length; i++) {
        if ((writes[i].table === "esdHTKTslaConfig" || writes[i].table === "esdHTKTslaConfigDetail") &&
                store.get(writes[i].table,writes[i].row.id)) {
            throw new Error("SLA_BASELINE_ID_ALREADY_EXISTS: "+writes[i].row.id);
        }
    }
    var configs=store.list("esdHTKTslaConfig",{"transaction.type":String(args.transactionType || "Dự chi"),"product.type":"Tất cả"});
    var start=calendarLib.toMillis(args.effectiveFrom),end=args.effectiveTo?calendarLib.toMillis(args.effectiveTo):Infinity;
    for(i=0;i<configs.length;i++) {
        var a=calendarLib.toMillis(store.decodeInstant(configs[i]["effective.from"]));
        var b=configs[i]["effective.to"]?calendarLib.toMillis(store.decodeInstant(configs[i]["effective.to"])):Infinity;
        if(start<b && a<end)throw new Error("SLA_BASELINE_EFFECTIVE_OVERLAP");
    }
    // Publish Config last so an interrupted setup cannot expose an incomplete role set.
    for (i = 0; i < writes.length; i++) if (writes[i].table !== "esdHTKTslaConfig") store.put(writes[i].table,writes[i].row);
    for (i = 0; i < writes.length; i++) if (writes[i].table === "esdHTKTslaConfig") store.put(writes[i].table,writes[i].row);
    return {success:true,created:writes.length};
}

