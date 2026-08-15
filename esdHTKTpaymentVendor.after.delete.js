/**
 * Hàm xử lý dọn dẹp/xóa các bản ghi liên quan khi Record ở Phase 'initial_kttc'
 */
function handleRemoveVendorPaymentData(rec) {
    if (!rec || rec["current.phase"] !== "initial_kttc") {
        return;
    }

    var paymentId = rec["id"] || rec["payment.id"] || "";
    var vendorNumber = rec["vendor.number"] || (rec["vendor"] ? rec["vendor"]["number"] : "");
    var vendorId = rec["vendor.id"] || (rec["vendor"] ? rec["vendor"]["id"] : "");

    lib.ESD_Utils.printMsg("[TRIGGER REMOVE] Running for Phase: initial_kttc | Payment ID: " + paymentId);

    if (paymentId && vendorNumber) {
        var querySQL = 'SELECT i.id, i.request.id FROM esdHTKTinvoice i ' +
                       'WHERE i.request.id = "' + paymentId + '" ' +
                       'AND i.seller.tax.code = "' + vendorNumber + '"';

        var invoiceFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
        var invoiceRc = invoiceFile.doSelect(querySQL);
        var deletedPaymentInvoiceCount = 0;

        while (invoiceRc === RC_SUCCESS) {
            var invoiceId = invoiceFile["id"];
            var requestId = invoiceFile["request.id"];

            var paymentInvoice = new SCFile("paymentInvoice");
            var paymentRc = paymentInvoice.doSelect(
                'payment.id="' + requestId + '" and invoice.id="' + invoiceId + '"'
            );

            while (paymentRc === RC_SUCCESS) {
                var deleteRc = paymentInvoice.doDelete();
                if (deleteRc === RC_SUCCESS) {
                    deletedPaymentInvoiceCount++;
                }
                paymentRc = paymentInvoice.getNext();
            }
            invoiceRc = invoiceFile.getNext();
        }

        print("[INFO] Deleted " + deletedPaymentInvoiceCount + " paymentInvoice record(s).");
    }

    if (paymentId && vendorId) {
        var costDiv = new SCFile("esdHTKTpaymentCostDivision");
        var costQuery = 'payment.id="' + paymentId + '" and vendor.id="' + vendorId + '"';
        var costRc = costDiv.doSelect(costQuery);

        while (costRc === RC_SUCCESS) {
            var delRc = costDiv.doDelete();
            if (delRc === RC_SUCCESS) {
                print("[INFO] Deleted record in esdHTKTpaymentCostDivision for Payment ID: " + paymentId);
            }
            costRc = costDiv.getNext();
        }
    }
}

handleRemoveVendorPaymentData(record);