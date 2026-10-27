/** ScriptLibrary: ESD_HTKT_SLA_RUNTIME. Workflow entry points, not HTTP/admin APIs.
 * Configure SCFile date/time conversions if SM returns SCDate/SCDatum instead of JS Date.
 */
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
function createRuntime(options) {
    options = options || {};
    var store = options.store || lib.ESD_HTKT_SLA_STORE.createStore(options);
    var calendar = lib.ESD_HTKT_SLA_CALENDAR;
    var service = lib.ESD_HTKT_SLA_SERVICE.createService(store, calendar, lib.ESD_HTKT_SLA_CALCULATOR,
        lib.ESD_HTKT_EXPENSE_SLA, {resolveEmail: options.resolveEmail || function(user) {
            var f = new SCFile("contacts", SCFILE_READONLY), rc;
            try {
                rc = f.doSelect('contact.name=' + lib.ESD_HTKT_SLA_STORE.quoteValue(user));
                if (rc === RC_NO_MORE) return null;
                if (rc !== RC_SUCCESS) throw new Error("SLA_CONTACT_LOOKUP_FAILED: " + rc);
                return String(f.email || "");
            } finally { if (typeof f.close === "function") f.close(); }
        }});
    function onBusinessCommitted(kind, before, after, context) {
        if (!after || String(after["transaction.type"]) !== "Dự chi") return {success: true, skipped: true};
        context = context || {};
        if (!context.operationId || !context.eventAt || !context.performedBy) throw new Error("SLA_REQUIRE_STABLE_OPERATION_CONTEXT");
        return service.applyExpenseEvent({id: String(context.operationId), kind: kind,
            eventAt: new Date(calendar.toMillis(store.decodeInstant(context.eventAt))).toISOString(),
            performedBy: String(context.performedBy), before: snapshot(before), after: snapshot(after)});
    }
    return {service: service, store: store, onBusinessCommitted: onBusinessCommitted};
}
