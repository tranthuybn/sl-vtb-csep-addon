/**
 * ScriptLibrary: ESD_HTKT_SLA_POLICY
 * -----------------------------------------------------------------------------
 * Module      : HTKT - Policy luồng SLA
 * Version     : 2.0.0
 *
 * Chức năng   : Ánh xạ sự kiện nghiệp vụ dùng chung thành các lệnh vận hành SLA
 *               (bắt đầu, hoàn thành, trả sửa, tái phân công và hủy).
 * Đầu vào     : Snapshot before/after bất biến của một thao tác nghiệp vụ đã thành
 *               công; event.kind gồm CREATE, TRANSITION, RETURN, REASSIGN, CANCEL.
 * Đầu ra      : Danh sách command để ESD_HTKT_SLA_ENGINE áp dụng và lưu dữ liệu.
 * Lưu ý       : event.id phải là mã thao tác ổn định và được giữ nguyên khi retry.
 *               Áp dụng chung cho Dự chi, Tạm ứng và Thanh toán.
 * Môi trường  : OpenText Service Manager (JavaScript ES5 Engine).
 * -----------------------------------------------------------------------------
 */
var SLA_ROLES = {
    initial_dmms: "CB_DE_NGHI", initial_kttc: "CB_KTTC", check_dmms: "RA_SOAT_1",
    approval_dmms: "PHE_DUYET_DM", approval_kttc: "PHE_DUYET_KTTC",
    check_final: "RA_SOAT_2", approval_final: "PHE_DUYET_TQ"
};
var SLA_ACTORS = {
    CB_DE_NGHI: "created.by", CB_KTTC: "user.checker.kttc", RA_SOAT_1: "user.checker.dmms",
    PHE_DUYET_DM: "user.approver.dmms", PHE_DUYET_KTTC: "user.approver.kttc",
    RA_SOAT_2: "user.checker.final", PHE_DUYET_TQ: "user.approver.final"
};
function isTrue(value) { return value === true || value === 1 || value === "true" || value === "1"; }
function makerRole(payment) {
    if (payment["initial.role"] === "dmms") return "CB_DE_NGHI";
    if (payment["initial.role"] === "kttc") return "CB_KTTC";
    throw new Error("SLA_INVALID_INITIAL_ROLE");
}
function assignee(payment, role) {
    if (role === "CB_KTTC" && payment["initial.role"] === "kttc") return String(payment["created.by"] || "");
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
    function start(r) { commands.push({type: "START", role: r, assignee: assignee(after, r)}); }
    if (kind === "CREATE") {
        if (after.status !== "dmms_created" && after.status !== "kttc_created") throw new Error("SLA_INVALID_CREATE_STATUS");
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
        if (from === "start" && ((to === "initial_dmms" && makerRole(after) === "CB_DE_NGHI") ||
                (to === "initial_kttc" && makerRole(after) === "CB_KTTC"))) return [];
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
        commands.push({type: "COMPLETE", role: role});
        if (to === "end") {
            if (from !== "approval_final" || after.status !== "approved") throw new Error("SLA_INVALID_FINAL_APPROVAL");
        } else {
            if (!SLA_ROLES[to]) throw new Error("SLA_UNKNOWN_TARGET_PHASE");
            start(SLA_ROLES[to]);
        }
        // Quy tắc dùng chung: nhánh ĐMMS bắt đầu RS2 sau khi PD ĐMMS hoàn thành.
        if (from === "approval_dmms" && isTrue(after["require.check.level2"])) start("RA_SOAT_2");
        // Nhánh KTTC bắt đầu RS2 khi PD KTTC chuyển sang check_final.
    } else throw new Error("SLA_UNKNOWN_EVENT_KIND: " + kind);
    return commands;
}


function buildCommands(event) {
    return buildWorkflowCommands(event);
}

