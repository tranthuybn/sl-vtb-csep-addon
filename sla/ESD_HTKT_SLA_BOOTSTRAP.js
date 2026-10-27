/** ScriptLibrary: ESD_HTKT_SLA_BOOTSTRAP. Explicit one-time setup, not an admin API.
 * Does not run automatically. Never edits an existing published configuration/calendar.
 * Caller provides approved holiday dates, version IDs and effective dates.
 */
function buildExpenseBaseline(calendarLib, args) {
    if (!args || !args.calendarId || !args.configId || !args.effectiveFrom || !args.performedBy ||
            Object.prototype.toString.call(args.holidays) !== "[object Array]") throw new Error("SLA_MISSING_BASELINE_INPUT");
    var start = calendarLib.toMillis(args.effectiveFrom);
    var end = args.effectiveTo ? calendarLib.toMillis(args.effectiveTo) : null;
    if (end !== null && end <= start) throw new Error("SLA_INVALID_EFFECTIVE_RANGE");
    var c = {timezone: "Asia/Ho_Chi_Minh", workingHours: [], holidays: args.holidays}, writes = [], d, i;
    writes.push({table: "esdHTKTslaCalendar", row: {id: args.calendarId, name: args.calendarId, timezone: c.timezone}});
    for (d = 1; d <= 5; d++) {
        var slots = [["08:00", "12:00"], ["13:00", "17:00"]];
        for (i = 0; i < slots.length; i++) {
            c.workingHours.push({dayOfWeek:d,startTime:slots[i][0],endTime:slots[i][1]});
            writes.push({table:"esdHTKTslaWorkingHour",row:{id:args.calendarId+".H."+d+"."+i,
                "calendar.id":args.calendarId,"day.of.week":d,"start.time":slots[i][0],"end.time":slots[i][1]}});
        }
    }
    calendarLib.compileCalendar(c);
    var seen = {};
    for (i = 0; i < args.holidays.length; i++) {
        if (seen[args.holidays[i]]) throw new Error("SLA_DUPLICATE_HOLIDAY");
        seen[args.holidays[i]] = true;
        writes.push({table:"esdHTKTslaHoliday",row:{id:args.calendarId+".OFF."+args.holidays[i],
            "calendar.id":args.calendarId,"holiday.date":args.holidays[i],"holiday.name":"Ngày nghỉ được phê duyệt",
            "holiday.type":"OTHER","created.by":args.performedBy,"created.at":new Date().toISOString()}});
    }
    writes.push({table:"esdHTKTslaConfig",row:{id:args.configId,"transaction.type":"Dự chi","product.type":"Tất cả",
        "calendar.id":args.calendarId,"effective.from":new Date(start).toISOString(),
        "effective.to":end === null ? null : new Date(end).toISOString(),status:"Đang hoạt động"}});
    // Source: Thông tin SLA.xlsx, Danh mục SLA, row 19. Order follows actual workflow.
    var roles = [["CB_DE_NGHI",2],["CB_KTTC",3],["RA_SOAT_1",3],["PHE_DUYET_DM",6],
        ["PHE_DUYET_KTTC",6],["RA_SOAT_2",4.5],["PHE_DUYET_TQ",9]];
    for (i = 0; i < roles.length; i++) writes.push({table:"esdHTKTslaConfigDetail",row:{
        id:args.configId+"."+roles[i][0],"sla.config.id":args.configId,"role.code":roles[i][0],
        "role.name":roles[i][0],"step.order":i+1,"sla.hours":roles[i][1],
        "alert.stage1.rate":0.7,"alert.stage2.rate":0.9,"is.active":true}});
    return writes;
}
function installExpenseBaseline(store, calendarLib, args) {
    var writes = buildExpenseBaseline(calendarLib,args), i;
    // Use on an unpublished new version only; interrupted setup requires a new version ID.
    for (i = 0; i < writes.length; i++) if (store.get(writes[i].table,writes[i].row.id)) throw new Error("SLA_BASELINE_ID_ALREADY_EXISTS: "+writes[i].row.id);
    var configs=store.list("esdHTKTslaConfig",{"transaction.type":"Dự chi","product.type":"Tất cả"});
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
