/**
 * 1. HÀM MAPPER: Convert SCFile Record sang Object Payload chuẩn
 */
function mapPaymentToPayload(rec, extraData) {
    if (!rec) return null;

    var payload = {
        "id": rec["id"] || "",
        "transaction.type": rec["transaction.type"] || "",
        "created.at": rec["created.at"],
        "completed.date": rec["completed.date"],
        "unit.lv1": rec["unit.lv1"] || "",
        "unit.lv2": rec["unit.lv2"] || "",

        "created.by": rec["created.by"] || "",
        "description": rec["description"] || "",
        "status": rec["status"] || ""
    };

    if (extraData) {
        payload["total.amount.paid"] = extraData.paidAmount;
        payload["approved.invoice.amount"] = extraData.approvedInvoiceAmount;
        payload["total.refund.amount"] = extraData.refundAmount;
    }

    return payload;
}


/**
 * 3. HÀM ĐIỀU PHỐI: Cập nhật Contract Payment
 */
function handlePhaseChangeUpdate(rec, oldRec) {
    if (!rec) return;
    
    var phase = rec["current.phase"] || "";
    var old = (oldRec && oldRec["current.phase"]) ? oldRec["current.phase"] : "";
    var status = rec["status"] || "";
    
    var totals = lib.ESD_HTKT_PAYMENT_VENDOR.getPaymentVendorList(rec["id"]);
        
    var payload = mapPaymentToPayload(rec, {
            approvedInvoiceAmount: totals.approvedInvoiceAmount,
            paidAmount: totals.paidAmount,
            refundAmount: totals.refundAmount,
        });
                
    if (phase === "end" && status === "cancelled") {
        lib.ESD_HD_Integration.deleteContractPayment(rec);
        return; 
    }
    
    if (phase !== old) {
       lib.ESD_HD_Integration.updateContractPayment(payload);
    }
    if (phase !== "end" && status === "accounted") {
        lib.ESD_HD_Integration.updateContractPayment(payload);
    } 
}


// =========================================================================
if (record && record["transaction.type"] == "Thanh toán") {
    // 1. Cập nhật Contract Payment khi có sự thay đổi Phase
    handlePhaseChangeUpdate(record, oldrecord);

    // 2. Sinh accountingInformation
    if (
        record["status"] == "approved" &&
        record["current.phase"] == "end" &&
        (!oldrecord || oldrecord["current.phase"] != "end")
    ) {
        var accountingResult =
            system.library.ESD_HTKT_PAYMENT_ACCOUNTING_INFORMATION
                .generatePaymentAccountingInformation(record["id"], false);

        // print("=== ACCOUNTING RESULT PAYMENT === " + JSON.stringify(accountingResult));
        // 3. Gọi hạch toán
        system.library.ESD_HTKT_ACCOUNTING_UTILS.processAccounting(record);
    }

    // 4. Đồng bộ báo cáo công nợ NCC khi Payment chuyển sang đã hạch toán (accounted)
    if (
        record["status"] == "accounted" &&
        (!oldrecord || oldrecord["status"] != "accounted")
    ) {
        try {
            lib.ESD_HTKT_REPORT_VENDOR_DEBT.syncVendorDebtReportForHTKT(record["id"], "PAYMENT");
        } catch (eDebt) {
            print("[ERROR] syncVendorDebtReportForHTKT failed for Payment ID: " + record["id"] + " | Exception: " + eDebt);
        }
    }
} else if (record && record["transaction.type"] == "Dự chi") {
    // TODO: Bổ sung logic xử lý Dự chi.
}
