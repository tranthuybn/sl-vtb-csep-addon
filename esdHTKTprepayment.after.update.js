/**
 * 1. HÀM MAPPER: Convert SCFile Record sang Object Payload chuẩn
 */
function mapPrepaymentToPayload(rec, extraData) {
    if (!rec) return null;

    var payload = {
        "id": rec["id"] || "",
        "transaction.type": rec["transaction.type"] || "",
        "created.at": rec["created.at"],
        "completed.date": rec["completed.date"],

        "amount": rec["amount"],
        "total.amount.paid": rec["total.amount.paid"],
        "total.refund.amount": rec["total.refund.amount"],

        "unit.lv1": rec["unit.lv1"] || "",
        "unit.lv2": rec["unit.lv2"] || "",

        "created.by": rec["created.by"] || "",
        "description": rec["description"] || "",
        "status": rec["status"] || ""
    };

    if (extraData && extraData.totalVendorAmount !== undefined) {
        payload["approved.invoice.amount"] = extraData.totalVendorAmount;
    }

    return payload;
}

/**
 * 2. HÀM TÍNH TOÁN: Query bảng esdHTKTprepaymentVendor
 */

function calculateTotalVendorAmount(prepaymentId) {

    var totalAmount = "0"; 
    if (!prepaymentId) return totalAmount;

    var safeId = String(prepaymentId).replace(/"/g, '\\"');
    var sql = 'prepayment.id="' + safeId + '"';

    var invoice = new SCFile("esdHTKTprepaymentInvoice");
    invoice.setFields(["prepayment.id"]);
    
    if (invoice.doSelect(sql) !== RC_SUCCESS) {
        return "0";
    }

    // 2. Nếu có, tiến hành lấy tổng amount từ bảng esdHTKTprepaymentVendor
    var vendor = new SCFile("esdHTKTprepaymentVendor");
    vendor.setFields(["amount"]);

    if (vendor.doSelect(sql) === RC_SUCCESS) {
        do {
            var amt = vendor["amount"] ? String(vendor["amount"]).trim() : "0";
            totalAmount = lib.ESD_HTKT_Utils.addStringsManual(totalAmount, amt);
        } while (vendor.getNext() === RC_SUCCESS);
    }

    return totalAmount; 
}

/**
 * 3. HÀM ĐIỀU PHỐI: Cập nhật Contract Payment
 */
function handlePhaseChangeUpdate(rec, oldRec) {
    if (!rec) return;

    var phase = rec["current.phase"] || "";
    var old = (oldRec && oldRec["current.phase"]) ? oldRec["current.phase"] : "";
    var status = rec["status"] || "";

    // 1. Chuẩn bị payload ở đầu hàm để dùng chung bên dưới
    var totalVendorAmt = calculateTotalVendorAmount(rec["id"]);
    var payload = mapPrepaymentToPayload(rec, {
        totalVendorAmount: totalVendorAmt
    });
    
    // 2. Kịch bản Phase = "end"
    if (phase === "end" && status === "cancelled") {
        try {
            lib.ESD_HD_Integration.deleteContractPayment(rec);
        } catch (ex) {
            print("[ERROR] deleteContractPayment failed for ID: " + rec["id"] + " | Exception: " + ex);
        }
        return;
    }

    // 3. Kịch bản Update
    if (phase !== old || status === "accounted") {
        try {
            lib.ESD_HD_Integration.updateContractPayment(payload);
        } catch (ex) {
            print("[ERROR] updateContractPayment failed for ID: " + rec["id"] + " | Exception: " + ex);
        }
    }
}


// =========================================================================
// 1. Cập nhật Contract Payment khi có sự thay đổi Phase
handlePhaseChangeUpdate(record, oldrecord);

// 2. 
system.library.ESD_HTKT_PREPAYMENT_ENTRY
    .syncPrepaymentEntryBySourceChange(
        "esdHTKTprepayment",
        record
    );
// 3. Sinh accountingInformation
if (
record["status"] != "cancelled" &&
    record["current.phase"] == "end" &&
    oldrecord["current.phase"] != "end"
) {
    var accountingResult =
        system.library.ESD_HTKT_ACCOUNTING_INFORMATION
            .generateAccountingInformationByPrepaymentId(record["id"]);

    print("=== ACCOUNTING RESULT === " + JSON.stringify(accountingResult));
// 4. goi hach toan 
    system.library.ESD_HTKT_ACCOUNTING_UTILS.processAccounting(record);
}
////5 lưu phieu vao attachment
//var printResult =
//    system.library.ESD_HTKT_PREPAYMENT_WF
//        .syncPrintAttachmentAfterPrepaymentUpdate(
//            record,
//            oldrecord
//        );
//
//print(
//    "=== PRINT ATTACHMENT RESULT === " +
//    JSON.stringify(printResult)
//);
