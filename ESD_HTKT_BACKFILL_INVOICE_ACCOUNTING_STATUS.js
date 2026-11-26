/**
 * Backfill esdHTKTinvoice.accounting.status:
 * - Chỉ xét hóa đơn có request.id và accounting.status = "PENDING".
 * - request.id bắt đầu bằng DC hoặc TT: kiểm tra esdHTKTpayment.
 * - Các request.id còn lại: kiểm tra esdHTKTprepayment.
 * - Nếu phiếu nguồn có status = "accounted" thì cập nhật accounting.status = "1".
 *
 * Backfill esdHTKTinvoice.request.id:
 * - Chỉ xét hóa đơn có accounting.status = "1" và request.id trống.
 * - Tìm payment.id qua esdHTKTpaymentInvoice.invoice.id.
 * - Ưu tiên kiểm tra esdHTKTpayment; chỉ khi không tìm thấy mới kiểm tra
 *   esdHTKTprepayment với cùng ID.
 * - Nếu xác định duy nhất một phiếu nguồn status = "accounted" thì gán request.id.
 *
 * Input tùy chọn qua vars['$L.file']:
 * - previewOnly: true  -> chỉ thống kê, không update.
 * - previewOnly: false -> update dữ liệu (mặc định).
 */

function run() {
    var input = vars['$L.file'] || {};
    var previewOnly = false;
    var result;

    try {
        result = {
            success: true,
            previewOnly: previewOnly,
            accountingStatus: backfillInvoiceAccountingStatus(previewOnly),
            requestId: backfillInvoiceRequestId(previewOnly)
        };
        result.success = result.accountingStatus.success === true &&
                result.requestId.success === true;
    } catch (e) {
        result = {
            success: false,
            previewOnly: previewOnly,
            error: String(e && e.message || e)
        };
        print("backfillInvoiceAccountingStatus::error: " + result.error);
    }

    print("backfillInvoiceAccountingStatus::result: " + rteJSONStringify(result));
    if (vars['$L.file']) {
        vars['$L.file'].queryReturn = rteJSONStringify(result);
    }
    return result;
}

function backfillInvoiceAccountingStatus(previewOnly) {
    var result = {
        success: true,
        previewOnly: previewOnly === true,
        scanned: 0,
        paymentRequests: 0,
        prepaymentRequests: 0,
        sourceAccounted: 0,
        sourceNotAccounted: 0,
        sourceNotFound: 0,
        updated: 0,
        failed: 0,
        errors: []
    };
    var sourceStatusCache = {};
    var invoiceFile = null;

    try {
        invoiceFile = new SCFile("esdHTKTinvoice");
        var rc = invoiceFile.doSelect(
                'request.id <> NULL and request.id <> "" and accounting.status="PENDING"'
        );

        while (rc === RC_SUCCESS) {
            result.scanned++;

            var invoiceId = cleanInvoiceText(invoiceFile["id"]);
            var requestId = cleanInvoiceText(invoiceFile["request.id"]);
            var prefix = requestId.substring(0, 2).toUpperCase();
            var sourceTable = prefix === "DC" || prefix === "TT"
                    ? "esdHTKTpayment"
                    : "esdHTKTprepayment";

            if (sourceTable === "esdHTKTpayment") result.paymentRequests++;
            else result.prepaymentRequests++;

            var sourceResult = getInvoiceSourceStatus(sourceTable, requestId, sourceStatusCache);
            if (!sourceResult.found) {
                result.sourceNotFound++;
                rc = invoiceFile.getNext();
                continue;
            }
            if (sourceResult.status.toLowerCase() !== "accounted") {
                result.sourceNotAccounted++;
                rc = invoiceFile.getNext();
                continue;
            }

            result.sourceAccounted++;
            if (!result.previewOnly) {
                invoiceFile["accounting.status"] = "1";
                var updateRc = invoiceFile.doUpdate();
                if (updateRc === RC_SUCCESS) {
                    result.updated++;
                } else {
                    result.failed++;
                    result.errors.push({
                        invoiceId: invoiceId,
                        requestId: requestId,
                        sourceTable: sourceTable,
                        returnCode: updateRc
                    });
                }
            }

            rc = invoiceFile.getNext();
        }
    } finally {
        closeInvoiceFileSafely(invoiceFile);
    }

    result.success = result.failed === 0;
    return result;
}

function backfillInvoiceRequestId(previewOnly) {
    var result = {
        success: true,
        previewOnly: previewOnly === true,
        scanned: 0,
        noRelation: 0,
        sourceNotFound: 0,
        sourceNotAccounted: 0,
        ambiguous: 0,
        matched: 0,
        updated: 0,
        failed: 0,
        errors: []
    };
    var sourceStatusCache = {};
    var invoiceFile = null;

    try {
        invoiceFile = new SCFile("esdHTKTinvoice");
        var rc = invoiceFile.doSelect(
                'accounting.status="1" and (request.id=NULL or request.id="")'
        );

        while (rc === RC_SUCCESS) {
            result.scanned++;

            var invoiceId = cleanInvoiceText(invoiceFile["id"]);
            var relationIds = getInvoiceRelationPaymentIds(invoiceId);
            if (relationIds.length === 0) {
                result.noRelation++;
                rc = invoiceFile.getNext();
                continue;
            }

            var accountedSourceIds = [];
            var foundAnySource = false;
            var foundNotAccounted = false;

            for (var i = 0; i < relationIds.length; i++) {
                var relationPaymentId = relationIds[i];
                var sourceResult = getInvoiceSourceStatus(
                        "esdHTKTpayment", relationPaymentId, sourceStatusCache
                );

                // Chỉ fallback sang Tạm ứng khi không tìm thấy ID trong Payment.
                if (!sourceResult.found) {
                    sourceResult = getInvoiceSourceStatus(
                            "esdHTKTprepayment", relationPaymentId, sourceStatusCache
                    );
                }

                if (!sourceResult.found) continue;
                foundAnySource = true;

                if (sourceResult.status.toLowerCase() === "accounted") {
                    accountedSourceIds.push(relationPaymentId);
                } else {
                    foundNotAccounted = true;
                }
            }

            if (accountedSourceIds.length === 0) {
                if (foundAnySource || foundNotAccounted) result.sourceNotAccounted++;
                else result.sourceNotFound++;
                rc = invoiceFile.getNext();
                continue;
            }

            if (accountedSourceIds.length > 1) {
                result.ambiguous++;
                result.errors.push({
                    invoiceId: invoiceId,
                    reason: "MULTIPLE_ACCOUNTED_SOURCES",
                    sourceIds: accountedSourceIds
                });
                rc = invoiceFile.getNext();
                continue;
            }

            var requestId = accountedSourceIds[0];
            result.matched++;
            if (!result.previewOnly) {
                invoiceFile["request.id"] = requestId;
                var updateRc = invoiceFile.doUpdate();
                if (updateRc === RC_SUCCESS) {
                    result.updated++;
                } else {
                    result.failed++;
                    result.errors.push({
                        invoiceId: invoiceId,
                        requestId: requestId,
                        returnCode: updateRc
                    });
                }
            }

            rc = invoiceFile.getNext();
        }
    } finally {
        closeInvoiceFileSafely(invoiceFile);
    }

    result.success = result.failed === 0;
    return result;
}

function getInvoiceRelationPaymentIds(invoiceId) {
    var result = [];
    var seen = {};
    var relationFile = null;

    try {
        relationFile = new SCFile("esdHTKTpaymentInvoice", SCFILE_READONLY);
        var rc = relationFile.doSelect(
                'invoice.id="' + escapeInvoiceQueryValue(invoiceId) + '"'
        );

        while (rc === RC_SUCCESS) {
            var paymentId = cleanInvoiceText(relationFile["payment.id"]);
            var key = "$" + paymentId;
            if (paymentId && !seen[key]) {
                seen[key] = true;
                result.push(paymentId);
            }
            rc = relationFile.getNext();
        }
    } finally {
        closeInvoiceFileSafely(relationFile);
    }

    return result;
}

function getInvoiceSourceStatus(tableName, requestId, cache) {
    var cacheKey = tableName + "|" + requestId;
    if (Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
        return cache[cacheKey];
    }

    var sourceFile = null;
    var result = { found: false, status: "" };
    try {
        sourceFile = new SCFile(tableName, SCFILE_READONLY);
        var rc = sourceFile.doSelect(
                'id="' + escapeInvoiceQueryValue(requestId) + '"'
        );
        if (rc === RC_SUCCESS) {
            result.found = true;
            result.status = cleanInvoiceText(sourceFile["status"]);
        }
    } finally {
        closeInvoiceFileSafely(sourceFile);
    }

    cache[cacheKey] = result;
    return result;
}

function escapeInvoiceQueryValue(value) {
    return String(value || "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
}

function cleanInvoiceText(value) {
    return value === null || value === undefined ? "" : String(value).trim();
}

function closeInvoiceFileSafely(file) {
    if (!file) return;
    try {
        file.doClose();
    } catch (e) {
        // Không che lỗi migration chính nếu đóng SCFile thất bại.
    }
}

// Chạy trực tiếp khi cần:
run() 
// print(rteJSONStringify(backfillInvoiceAccountingStatus(true))); // preview status
// print(rteJSONStringify(backfillInvoiceRequestId(true)));        // preview request.id
