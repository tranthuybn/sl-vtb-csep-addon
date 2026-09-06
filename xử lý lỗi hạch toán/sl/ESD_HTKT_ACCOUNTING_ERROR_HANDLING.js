var logger = getLog('ESD_HTKT_ACCOUNTING_ERROR_HANDLING');

var ACCOUNTING_STATUS = {
    ERROR: "ERROR",
    IN_QUEUE: "IN_QUEUE",
    COMPLETED: "COMPLETED"
}

/**
 * Ghi nhận tổng hợp lỗi hạch toán theo mã đề nghị. Nếu request.id đã tồn tại thì
 * cập nhật lại tổng giao dịch và tổng giao dịch lỗi; nếu chưa có thì insert mới.
 */
function saveAccountingErrorHandling(itemAccounting) {
    if (!itemAccounting) return;

    var requestId = String(itemAccounting['prepayment.id'] || '').trim();
    if (!requestId) return;

    var upperRequestId = requestId.toUpperCase();
    var requestType = '';

    if (upperRequestId.indexOf('TT') === 0) {
        requestType = 'Thanh toán';
    } else if (upperRequestId.indexOf('TU') === 0) {
        requestType = 'Tạm ứng';
    }

    var contractId = String(itemAccounting['contract.id'] || '').trim();
    var totalTrans = 0;
    var totalErrorTrans = 0;
    var accountingFile = null;
    var errorFile = null;

    try {
        accountingFile = new SCFile('esdHTKTaccountingInformation', SCFILE_READONLY);
        var accountingRc = accountingFile.doSelect('prepayment.id = "' + escapeQueryValue(requestId) + '"');
        while (accountingRc == RC_SUCCESS) {
            totalTrans++;
            if (String(accountingFile.status || '').toUpperCase() === ACCOUNTING_STATUS.ERROR) {
                totalErrorTrans++;
            }
            accountingRc = accountingFile.getNext();
        }

        errorFile = new SCFile('esdHTKTaccountingErrorHandling');
        var errorRc = errorFile.doSelect('request.id = "' + escapeQueryValue(requestId) + '"');

        if (errorRc == RC_SUCCESS) {
            errorFile['total.trans'] = totalTrans;
            errorFile['total.error.trans'] = totalErrorTrans;
            errorFile.doUpdate();
            return;
        }

        if (errorRc == RC_SUCCESS) {

            if (totalErrorTrans <= 0) {
                errorFile.doDelete();
                return;
            }

            errorFile['total.trans'] = totalTrans;
            errorFile['total.error.trans'] = totalErrorTrans;
            errorFile.doUpdate();
            return;
        }

        errorFile['request.id'] = requestId;
        errorFile['request.type'] = requestType;
        errorFile['contract.id'] = contractId;
        errorFile['total.trans'] = totalTrans;
        errorFile['total.error.trans'] = totalErrorTrans;
        errorFile.status = ACCOUNTING_STATUS.ERROR;
        errorFile.doInsert();
    } catch (e) {
        logger.info('saveAccountingErrorHandling: ' + e);
    } finally {
        try { if (accountingFile) accountingFile.doClose(); } catch (e1) {}
        try { if (errorFile) errorFile.doClose(); } catch (e2) {}
    }
}

function escapeQueryValue(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}


/**
 * ========================================================================================================================
 * ============================= Vui lòng không sửa code dưới này (had) ===================================================
 * ========================================================================================================================
 */

/**
 * Render Table danh sách phiếu có lỗi hạch toán
 */
function renderAccountingErrorList() {
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/DanhSachLoiHachToan', '', {});
}


/**
 * Render Tab danh sách kết quả giao dich hạch toán
 */
function renderTabKetQuaHachToan() {
    const payload = {
        paymentId: vars['$G.payment.id']
    }
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/DanhSachLoiHachToan/KetQuaHachToan', '', payload);
}


/**
 * Đồng bộ toàn bộ dữ liệu lỗi hạch toán vào esdHTKTaccountingErrorHandling.
 *
 * Nghiệp vụ:
 * - Mỗi mã đề nghị chỉ có 1 bản ghi trong esdHTKTaccountingErrorHandling.
 * - total.trans là tổng tất cả giao dịch hạch toán của đề nghị, không phụ thuộc trạng thái.
 * - total.error.trans chỉ tính các giao dịch có status = ACCOUNTING_STATUS.ERROR.
 * - Chỉ lưu đề nghị có ít nhất 1 giao dịch lỗi.
 * - Nếu đề nghị không còn giao dịch lỗi thì xóa bản ghi ErrorHandling đã tồn tại.
 * - Hàm dùng để đồng bộ khi mở màn hình List, không phụ thuộc hoàn toàn vào Trigger.
 */
function syncAccountingErrorHandling() {
    var accountingFile = null;
    var errorFile = null;
    var requestMap = {};
    print('Sync all');
    try {
        // 1. QUERY TOÀN BỘ GIAO DỊCH HẠCH TOÁN
        accountingFile = new SCFile('esdHTKTaccountingInformation', SCFILE_READONLY);
        var accountingRc = accountingFile.doSelect('true');

        while (accountingRc == RC_SUCCESS) {
            var requestId = String(accountingFile['prepayment.id'] || '').trim();

            if (requestId) {
                if (!requestMap[requestId]) {
                    var upperRequestId = requestId.toUpperCase();
                    var requestType = '';

                    if (upperRequestId.indexOf('TT') === 0) {
                        requestType = 'THANH_TOAN';
                    } else if (upperRequestId.indexOf('TU') === 0) {
                        requestType = 'TAM_UNG';
                    }

                    requestMap[requestId] = {
                        requestId: requestId,
                        requestType: requestType,
                        contractId: String(accountingFile['contract.id'] || '').trim(),
                        totalTrans: 0,
                        totalErrorTrans: 0
                    };
                }

                var summary = requestMap[requestId];

                // Tổng số giao dịch của phiếu, không phụ thuộc trạng thái.
                summary.totalTrans++;

                // Chỉ status ERROR mới được tính vào tổng giao dịch lỗi.
                if (String(accountingFile['status'] || '').toUpperCase() === String(ACCOUNTING_STATUS.ERROR || '').toUpperCase()) {
                    summary.totalErrorTrans++;
                }

                // Nếu chưa có contract.id thì lấy từ giao dịch khác của cùng phiếu.
                if (!summary.contractId) {
                    summary.contractId = String(accountingFile['contract.id'] || '').trim();
                }
            }

            accountingRc = accountingFile.getNext();
        }

        // 2. INSERT HOẶC UPDATE CÁC PHIẾU ĐANG CÓ GIAO DỊCH LỖI
        for (var requestId in requestMap) {
            if (!requestMap.hasOwnProperty(requestId)) continue;

            var item = requestMap[requestId];

            // Không có giao dịch lỗi thì chưa xử lý tại bước này.
            if (item.totalErrorTrans <= 0) continue;

            errorFile = new SCFile('esdHTKTaccountingErrorHandling');
            var errorQuery = 'request.id = "' + escapeQueryValue(requestId) + '"';
            var errorRc = errorFile.doSelect(errorQuery);

            if (errorRc == RC_SUCCESS) {
                // Đã có bản ghi ErrorHandling -> cập nhật lại toàn bộ số liệu.
                errorFile['request.type'] = item.requestType;
                errorFile['contract.id'] = item.contractId;
                errorFile['status'] = ACCOUNTING_STATUS.ERROR;
                errorFile['total.trans'] = item.totalTrans;
                errorFile['total.error.trans'] = item.totalErrorTrans;
                errorFile.doUpdate();
            } else {
                // Chưa có ErrorHandling -> insert mới.
                var rc = 0;
                var newId = new SCDatum();
                rc = system.functions.rtecall("getnumber", rc, newId, "esdHTKTaccountingErrorHandling");
                var generatedId = newId ? String(newId.getText() || "") : "";

                errorFile['id'] = generatedId;
                errorFile['request.id'] = item.requestId;
                errorFile['request.type'] = item.requestType;
                errorFile['contract.id'] = item.contractId;
                errorFile['status'] = ACCOUNTING_STATUS.ERROR;
                errorFile['total.trans'] = item.totalTrans;
                errorFile['total.error.trans'] = item.totalErrorTrans;
                errorFile.doInsert();
            }

            try {
                errorFile.doClose();
            } catch (eCloseItem) {}

            errorFile = null;
        }

        // 3. XÓA CÁC BẢN GHI ERROR HANDLING KHÔNG CÒN GIAO DỊCH LỖI
        errorFile = new SCFile('esdHTKTaccountingErrorHandling');
        var existingRc = errorFile.doSelect('true');

        while (existingRc == RC_SUCCESS) {
            var existingRequestId = String(errorFile['request.id'] || '').trim();
            var existingSummary = requestMap[existingRequestId];

            // Xóa nếu phiếu không còn tồn tại hoặc không còn giao dịch ERROR.
            if (!existingSummary || existingSummary.totalErrorTrans <= 0) {
                errorFile.doDelete();
            }

            existingRc = errorFile.getNext();
        }

        return {
            success: true,
            totalRequests: Object.keys(requestMap).length
        };
    } catch (e) {
        logger.info('syncAccountingErrorHandling: ' + e);

        return {
            success: false,
            message: String(e)
        };
    } finally {
        try {
            if (accountingFile) accountingFile.doClose();
        } catch (e1) {}

        try {
            if (errorFile) errorFile.doClose();
        } catch (e2) {}
    }
}


/**
 * Hàm JOIN lấy thêm thông tin Số tiền, Phương thức thanh toán
 * và Contract từ Payment/Prepayment + PaymentVendor
 */
function getPaymentDetailInfo(requestId, subType) {
    var result = {
        amount: 0,
        paymentMethod: "",
        contractId: ""
    };

    if (!requestId) return result;

    var type = String(subType || "").toUpperCase();

    // ==========================
    // TẠM ỨNG
    // ==========================
    if (type === "TAM_UNG" || requestId.indexOf("TU") === 0) {

        var prepayRec = new SCFile("esdHTKTprepayment");
        var prepayQuery = 'id="' + requestId + '"';

        if (prepayRec.doSelect(prepayQuery) === RC_SUCCESS) {
            result['amount'] = prepayRec['amount'] || 0;
            result['contractId'] = prepayRec['contract_id'] || "";
        }

        // ==========================
        // THANH TOÁN
        // ==========================
    } else if (type === "THANH_TOAN" || requestId.indexOf("TT") === 0) {

        var payRec = new SCFile("esdHTKTpayment");
        var payQuery = 'id="' + requestId + '"';

        if (payRec.doSelect(payQuery) === RC_SUCCESS) {
            result['amount'] = payRec['total_amount_paid'] || 0;
            result['contractId'] = payRec['contract_id'] || "";
        }
    }

    // ==========================
    // PAYMENT METHOD
    // ==========================
    var vendorRec = null;
    var vendorQuery = "";

    if (type === "TAM_UNG" || requestId.indexOf("TU") === 0) {

        vendorRec = new SCFile("esdHTKTprepaymentVendor");
        vendorQuery = 'prepayment.id="' + requestId + '"';

    } else if (type === "THANH_TOAN" || requestId.indexOf("TT") === 0) {

        vendorRec = new SCFile("esdHTKTpaymentVendor");
        vendorQuery = 'payment.id="' + requestId + '"';
    }

    if (vendorRec && vendorRec.doSelect(vendorQuery) === RC_SUCCESS) {

        var hasTransfer = false;
        var hasCash = false;

        do {
            var paymentMethod = String(
                vendorRec['payment.method'] || ""
            ).toUpperCase();

            if (paymentMethod === "CHUYENKHOAN") {
                hasTransfer = true;
            } else if (paymentMethod === "TIENMAT") {
                hasCash = true;
            }

        } while (vendorRec.getNext() === RC_SUCCESS);

        if (hasTransfer && hasCash) {
            result['paymentMethod'] = "Hỗn hợp";
        } else if (hasTransfer) {
            result['paymentMethod'] = "Chuyển khoản";
        } else if (hasCash) {
            result['paymentMethod'] = "Tiền mặt";
        }
    }

    return result;
}

//getPaymentDetailInfo('TU.106.26.0000001', 'TAM_UNG');


/**
 * Lấy checked.time mới nhất trong toàn bộ giao dịch hạch toán của một phiếu.
 */
function getLatestAccountingCheckedTime(requestId) {
    if (!requestId) return "";

    var accountingRec = null;
    var latestCheckedTime = "";
    var latestTimestamp = 0;

    try {
        accountingRec = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
        var query = 'prepayment.id="' + escapeQueryValue(requestId) + '"';
        var rc = accountingRec.doSelect(query);

        while (rc === RC_SUCCESS) {
            var checkedTime = accountingRec['checked.time'];

            if (checkedTime) {
                var timestamp = new Date(String(checkedTime)).getTime();

                if (!isNaN(timestamp) && timestamp > latestTimestamp) {
                    latestTimestamp = timestamp;
                    latestCheckedTime = checkedTime;
                }
            }
            rc = accountingRec.getNext();
        }
    } catch (e) {
        logger.info('getLatestAccountingCheckedTime: ' + e);
    } finally {
        try {
            if (accountingRec) accountingRec.doClose();
        } catch (e1) {}
    }
    return latestCheckedTime;
}

/**
 * Retry gửi hạch toán lỗi
 */
function retryAccountingErrorsResult(input) {
    var result = { success: false, updated: 0, failed: 0, errors: [], rows: [] };
    var data;
    try {
        data = JSON.parse(input.queryString);
        if (!data || !Array.isArray(data.rows) || !data.rows.length) {
            throw new Error('Vui lòng chọn ít nhất một giao dịch.');
        }
    } catch (e) {
        result.message = 'Dữ liệu thử lại không hợp lệ: ' + String(e.message || e);
        return result;
    }

    // Chỉ đọc dữ liệu gốc trong SM; không dùng payload/trạng thái do UI gửi lên.
    var seen = {};
    var selected = [];
    var paymentId = '';
    var channel = '';
    var totalAmount = 0;
    var invoices = [];
    for (var i = 0; i < data.rows.length; i++) {
        var rec = null;
        var row = data.rows[i] || {};
        var requestId = String(row.requestId || '').trim();
        try {
            if (!requestId) throw new Error('Thiếu requestId giao dịch.');
            if (seen['$' + requestId]) continue;
            seen['$' + requestId] = true;
            rec = new SCFile('esdHTKTaccountingInformation');
            if (rec.doSelect('request.id="' + escapeQueryValue(requestId) + '"') !== RC_SUCCESS) {
                throw new Error('Không tìm thấy hoặc không có quyền truy cập giao dịch.');
            }
            var item = validateAccountingRetry(rec);
            if (paymentId && paymentId !== item.prepaymentId) throw new Error('Chỉ chọn giao dịch cùng một phiếu.');
            if (channel && channel !== item.channel) throw new Error('Chỉ chọn giao dịch trong cùng một bảng OGL hoặc Core Banking.');
            paymentId = item.prepaymentId;
            channel = item.channel;
            totalAmount += Number(rec.amount || 0);
            if (item.invoiceNumber) invoices.push({ requestId: requestId, invoiceNumber: item.invoiceNumber });
            selected.push(requestId);
        } catch (eRow) {
            result.failed++;
            result.errors.push({ requestId: requestId, message: String(eRow.message || eRow) });
        } finally {
            try { if (rec) rec.doClose(); } catch (eClose) {}
        }
    }
    // Kiểm tra toàn bộ lựa chọn trước khi có bất kỳ thay đổi/gọi API nào.
    if (result.failed) return result;
    result.confirmation = { count: selected.length, totalAmount: totalAmount, channel: channel, invoices: invoices };
    if (data.confirmed !== true || (invoices.length && data.invoiceCancellationConfirmed !== true)) {
        result.requiresConfirmation = true;
        result.message = invoices.length ?
            'Phải hủy các Invoice đã tạo trên OGL và xác nhận trước khi gửi lại toàn bộ yêu cầu.' :
            'Xác nhận số giao dịch, tổng số tiền và hệ thống đích trước khi thử lại.';
        return result;
    }

    for (var j = 0; j < selected.length; j++) {
        var retryRec = null;
        var claimed = false;
        var responseSaved = false;
        var history = [];
        var newRequestId = '';
        try {
            retryRec = new SCFile('esdHTKTaccountingInformation');
            if (retryRec.doSelect('request.id="' + escapeQueryValue(selected[j]) + '"') !== RC_SUCCESS) {
                throw new Error('Giao dịch đã thay đổi; vui lòng tải lại danh sách.');
            }
            // Kiểm tra lại sau pop-up: bản ghi có thể đã được xử lý ở phiên khác.
            var retry = validateAccountingRetry(retryRec);
            if (retry.invoiceNumber && data.invoiceCancellationConfirmed !== true) throw new Error('Chưa xác nhận hủy Invoice.');
            newRequestId = String(lib.UUID.generateUUID() || '').trim().toLowerCase();
            if (!newRequestId || newRequestId === selected[j]) throw new Error('Không sinh được định danh mới.');
            var payload = retry.payload;
            if (retryRec.type === 'GL' && Object.prototype.hasOwnProperty.call(payload, 'RequestId')) {
                payload.RequestId = newRequestId;
            } else {
                payload.requestId = newRequestId;
            }
            if (retry.channel === 'CORE') {
                payload.requestId = newRequestId;
                payload.data[retryRec['sub.type'] === 'INHOUSE' ? 'trnRefNum' : 'chanRefNum'] = newRequestId;
            }
            history = retry.previous.retryHistory || [];
            if (!Array.isArray(history)) throw new Error('Lịch sử thử lại không hợp lệ.');
            // Bỏ metadata khỏi snapshot để lịch sử không lồng nhau tăng theo cấp số nhân.
            delete retry.previous.retryHistory;
            delete retry.previous.retryCount;
            history.push({ requestId: selected[j], transactionId: String(retryRec['transaction.id'] || ''),
                data: String(retryRec.data || ''), response: retry.previous,
                invoiceNumber: String(retryRec['ap.code'] || ''), paymentNumber: String(retryRec['payment.number'] || ''),
                batchName: String(retryRec['batch.name'] || ''),
                retriedAt: String(system.functions.tod()), retriedBy: String(system.functions.operator()),
                invoiceCancellationConfirmed: data.invoiceCancellationConfirmed === true });

            // Lưu định danh trước khi gửi. PROCESSING không bị job IN_QUEUE tự động gửi lại.
            retryRec['request.id'] = newRequestId;
            retryRec.data = rteJSONStringify(payload);
            retryRec.status = 'PROCESSING';
            retryRec['transaction.id'] = '';
            retryRec['ap.code'] = '';
            retryRec['payment.number'] = '';
            retryRec['batch.name'] = '';
            retryRec.message = 'Đang gửi lại giao dịch.';
            retryRec.response = rteJSONStringify({ retryCount: history.length, retryHistory: history });
            if (retryRec.doUpdate() !== RC_SUCCESS) throw new Error('Không lưu được giao dịch; chưa gửi API.');
            claimed = true;

            sendAccountingRetry(retryRec);
            // ACCOUNTING_UTILS gửi API và cập nhật bằng SCFile riêng; đọc lại để không
            // ghi đè kết quả bằng bản ghi cũ. callApiAp/Gl đã tạo job kiểm tra OGL.
            if (retryRec.doSelect('request.id="' + escapeQueryValue(newRequestId) + '"') !== RC_SUCCESS) {
                throw new Error('Không đọc được kết quả sau khi gửi lại.');
            }
            if (String(retryRec.status) === 'PROCESSING') {
                throw new Error('Hàm tích hợp chưa ghi nhận phản hồi; cần đối soát.');
            }
            var response = JSON.parse(String(retryRec.response || ''));
            if (!response || typeof response !== 'object') throw new Error('Không nhận được phản hồi hợp lệ từ hệ thống đích.');
            response.retryCount = history.length;
            response.retryHistory = history;
            var accepted;
            if (retry.channel === 'CORE') {
                if (!response.status || response.status.code == null) throw new Error('Core Banking không trả mã trạng thái.');
                accepted = String(response.status.code) === '0';
                retryRec.status = accepted ? ACCOUNTING_STATUS.COMPLETED : ACCOUNTING_STATUS.ERROR;
                retryRec.message = String(response.status.detail || '');
                if (response.data && response.data.hostRefNum) retryRec['ref.id'] = response.data.hostRefNum;
            } else {
                if (typeof response.success !== 'boolean') throw new Error('OGL không trả kết quả hợp lệ.');
                accepted = response.success;
                retryRec.status = accepted ? 'NEW' : ACCOUNTING_STATUS.ERROR;
                retryRec.message = String(response.message || '');
                if (response.data && response.data.transactionId) retryRec['transaction.id'] = response.data.transactionId;
            }
            retryRec.response = rteJSONStringify(response);
            retryRec['checked.time'] = system.functions.tod();
            if (retryRec.doUpdate() !== RC_SUCCESS) throw new Error('Đã gọi API nhưng không lưu được kết quả; cần đối soát định danh mới.');
            responseSaved = true;
            result.rows.push({ oldRequestId: selected[j], requestId: newRequestId, status: retryRec.status,
                retryCount: history.length, success: accepted, message: retryRec.message });
            if (accepted) {
                result.updated++;
                if (retry.channel === 'CORE') {
                    lib.ESD_HTKT_ACCOUNTING_UTILS.checkCompleteAccounting(retry.prepaymentId);
                }
            } else {
                result.failed++;
                result.errors.push({ requestId: newRequestId, message: String(retryRec.message || 'Gửi lại thất bại.') });
            }
        } catch (eRetry) {
            var message = String(eRetry.message || eRetry);
            // Mất phản hồi sau gửi không chứng minh giao dịch chưa thực hiện.
            // Giữ PROCESSING + định danh mới để đối soát, không mở lại nút gửi tiền.
            if (claimed && !responseSaved) {
                retryRec.status = 'PROCESSING';
                retryRec.message = 'Chưa xác định kết quả, cần đối soát: ' + message;
                try { retryRec.doUpdate(); } catch (eSave) {}
            }
            result.failed++;
            result.errors.push({ requestId: newRequestId || selected[j], message: message,
                requiresReconciliation: claimed && !responseSaved });
        } finally {
            try { if (retryRec) retryRec.doClose(); } catch (eCloseRetry) {}
        }
    }
    result.success = result.failed === 0;
    return result;
}

function validateAccountingRetry(rec) {
    if (String(rec.status) !== ACCOUNTING_STATUS.ERROR) throw new Error('Chỉ được thử lại giao dịch ERROR.');
    var type = String(rec.type || '');
    var subType = String(rec['sub.type'] || '');
    if (type !== 'AP' && type !== 'GL' && type !== 'CORE') throw new Error('Loại hạch toán không được hỗ trợ.');
    if (type === 'AP' && ['TAM_UNG', 'THANH_TOAN', 'THUE', 'TAT_TOAN'].indexOf(subType) < 0) throw new Error('Loại nghiệp vụ AP không hợp lệ.');
    if (type === 'CORE' && subType !== 'INHOUSE' && subType !== 'CITAD') throw new Error('Loại chuyển tiền không hợp lệ.');
    var payload = JSON.parse(String(rec.data || ''));
    var previous = rec.response ? JSON.parse(String(rec.response)) : {};
    if (!payload || Array.isArray(payload) || typeof payload !== 'object' || !previous || typeof previous !== 'object') {
        throw new Error('Dữ liệu gốc hoặc phản hồi đã lưu không hợp lệ.');
    }
    var prepaymentId = String(rec['prepayment.id'] || '').trim();
    if (!prepaymentId) throw new Error('Giao dịch không có mã phiếu.');
    var invoice = String(rec['ap.code'] || (previous.data && previous.data.invoiceNumber) || '');
    var payment = String(rec['payment.number'] || (previous.data && previous.data.paymentNumber) || '');
    if (type === 'AP' && payment) throw new Error('Bút toán đã có số Payment; cần đối soát kết quả trước khi thử lại.');
    if (type === 'CORE') {
        var code = previous.status && previous.status.code != null ? String(previous.status.code) : '';
        if (!code || code === '0' || code === '98') throw new Error('Core chưa xác định thất bại hoặc đã timeout/thành công; cần đối soát và khai báo kết quả.');
        // Chỉ mã lỗi đã được ánh xạ ERROR trong ACCOUNTING_UTILS; không suy đoán mã lạ.
        if (code !== '1001') throw new Error('Mã lỗi Core chưa có quy tắc thử lại; cần đối soát.');
        if (!payload.data || typeof payload.data !== 'object') throw new Error('Thiếu dữ liệu lệnh chuyển tiền gốc.');
        var errors = previous.errorInfo || [];
        for (var k = 0; k < errors.length; k++) {
            if (String(errors[k].code) === '98') throw new Error('Core timeout; không được thử lại.');
        }
        var ogl = null;
        try {
            ogl = new SCFile('esdHTKTaccountingInformation', SCFILE_READONLY);
            var rc = ogl.doSelect('prepayment.id="' + escapeQueryValue(prepaymentId) + '"');
            if (rc !== RC_SUCCESS) throw new Error('Không kiểm tra được kết quả OGL của phiếu.');
            while (rc === RC_SUCCESS) {
                if ((ogl.type === 'AP' || ogl.type === 'GL') && ogl.status !== ACCOUNTING_STATUS.COMPLETED) {
                    throw new Error('Phải hoàn tất toàn bộ OGL trước khi chuyển tiền.');
                }
                rc = ogl.getNext();
            }
            if (rc !== RC_NO_MORE) throw new Error('Không đọc đầy đủ kết quả OGL.');
        } finally {
            try { if (ogl) ogl.doClose(); } catch (eCloseOgl) {}
        }
    }
    return { payload: payload, previous: previous, prepaymentId: prepaymentId,
        channel: type === 'CORE' ? 'CORE' : 'OGL', invoiceNumber: type === 'AP' ? invoice : '' };
}

function sendAccountingRetry(rec) {
    var item = { 'request.id': String(rec['request.id']),
        'prepayment.id': String(rec['prepayment.id']), type: String(rec.type),
        'sub.type': String(rec['sub.type']), data: String(rec.data) };
    if (rec.type === 'AP') {
        return lib.ESD_HTKT_ACCOUNTING_UTILS.callApiAp(item);
    }
    if (rec.type === 'GL') return lib.ESD_HTKT_ACCOUNTING_UTILS.callApiGl(item);
    return lib.ESD_HTKT_ACCOUNTING_UTILS.callApiCore(item);
}

/**
 * Lưu khai báo kết quả hạch toán
 */
function saveAccountingErrorsResult(input) {
    var data = JSON.parse(input.queryString);
    var rows = data.rows || data;

    //    var currentUser = vars.$G_user || "";       // Thông tin user đang thực hiện
    var currentTime = system.functions.tod(); // Thời gian hiện tại
    var accountingCurrentUser = vars.$lo_operator ?
        String(vars.$lo_operator["contact.name"] || "").trim().toLowerCase() :
        "";
    // Dùng system.functions.operator() thay vì vars.$lo_operator
    var currentUserName = system.functions.operator();
    var currentOpName = system.functions.operator(); // "csep.admin.01"
    var loginAccount = "";
    var operatorObj = {};
    var currentOpName = system.functions.operator();

    print("currentOpName = " + currentOpName);

    var op = new SCFile("operator", SCFILE_READONLY);

    if (op.doSelect('name="' + currentOpName + '"') === RC_SUCCESS) {


        for (var field in op) {
            try {
                operatorObj[field] = String(op[field]);
            } catch (e) {
                operatorObj[field] = "[Cannot read]";
            }
        }

        print(
            "OPERATOR OBJECT = " +
            JSON.stringify(operatorObj)
        );

    } else {
        print("Không tìm thấy operator: " + currentOpName);
    }
    // Lấy Tên đầy đủ (Full Name)
    var currentUserFullName = vars.$lo_ufname;
    var result = {
        success: true,
        updated: 0,
        failed: 0,
        errors: []
    };

    for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        if (!row.requestId) {
            result.failed++;
            result.errors.push({
                index: i,
                message: "Thiếu requestId"
            });
            continue;
        }

        try {
            var rec = new SCFile("esdHTKTaccountingInformation");
            var query = 'request.id="' + row.requestId + '"';

            if (rec.doSelect(query) === RC_SUCCESS) {
                rec["batch.name"] = row.batchName || "";
                rec["ap.code"] = row.invoiceNumber || "";
                rec["payment.number"] = row.paymentNumber || "";
                rec["message"] = row.note || "";
                rec["status"] = ACCOUNTING_STATUS.COMPLETED

                // Thời gian cập nhật
                rec["checked.time"] = currentTime;

                var rc = rec.doUpdate();

                if (rc === RC_SUCCESS) {
                    result.updated++;
                } else {
                    result.failed++;
                    result.errors.push({
                        requestId: row.requestId,
                        message: "Update thất bại"
                    });
                }
            } else {
                result.failed++;
                result.errors.push({
                    requestId: row.requestId,
                    message: "Không tìm thấy bản ghi"
                });
            }
        } catch (e) {
            result.failed++;
            result.errors.push({
                requestId: row.requestId,
                message: String(
                    e.message || e
                )
            });
        }
    }
    result.currentUserName = currentUserName;
    result.currentUserFullName = currentUserFullName;
    result.accountingCurrentUser = accountingCurrentUser;
    result.operatorObj = operatorObj;
    result.success = result.failed === 0;
    return result;
}


/**
 * Danh sách phiếu có lỗi hạch toán
 */
function getPaymentRequestErrors() {
    //    syncAccountingErrorHandling();
    print('error payment');
    var errorRec = new SCFile("esdHTKTaccountingErrorHandling");
    var errorQuery = "true";
    var listData = [];

    if (errorRec.doSelect(errorQuery) === RC_SUCCESS) {
        do {
            var requestId = errorRec['request_id'] || "";
            var requestType = errorRec['request_type'] || "";
            print('requestType = ', requestType)
            if (!requestId) continue;

            // Lấy thông tin tổng hợp của phiếu
            var extraInforError = getPaymentDetailInfo(requestId, requestType);

            // Lấy checked.time mới nhất trong các giao dịch hạch toán của phiếu
            var latestCheckedTime = getLatestAccountingCheckedTime(requestId);

            listData.push({
                id: errorRec['id'],
                totalTrans: errorRec['total_trans'] || 0,
                totalErrorTrans: errorRec['total_error_trans'] || 0,
                requestId: requestId,
                prepaymentId: requestId,
                requestType: requestType,
                contractId: errorRec['contract_id'] || extraInforError['contractId'],
                status: errorRec['status'] || "",
                amount: extraInforError['amount'],
                paymentMethod: extraInforError['paymentMethod'],
                checkedTime: latestCheckedTime || "",
            });
        } while (errorRec.getNext() === RC_SUCCESS);
    }
    return rteJSONStringify(listData);
}

/**
 * Danh sách lỗi giao dịch hạch toán
 */
function getAccountingErrors(input) {
    var paymentId = JSON.parse(input.queryString).paymentId;

    print('[SL - input] ', input);

    print('[SL] = ', vars['$G.payment.id']);
    var requestId = paymentId.trim();

    //    if (!requestId) {
    //        return rteJSONStringify([]);
    //    }

    var errorRec = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
    var errorQuery = 'prepayment.id="' + escapeQueryValue(requestId) + '"';
    //    var errorQuery = "true";

    // Nếu chỉ muốn lấy các giao dịch lỗi của phiếu đó thì đổi query thành =>
    //    var errorQuery = 'prepayment.id="' + escapeQueryValue(requestId) + ' " and status="' + ACCOUNTING_STATUS.ERROR + '"';
    var listData = [];
    print('1');
    try {
        var rc = errorRec.doSelect(errorQuery);

        while (rc === RC_SUCCESS) {
            var parseData = {};
            var parseResponse = {};
            var rawData = errorRec['data'];
            var rawResponse = errorRec['response'];

            if (rawData) {
                print('2');
                try {
                    parseData = typeof rawData === "string" ?
                        JSON.parse(rawData) :
                        rawData;
                } catch (eData) {
                    parseData = {
                        raw: String(rawData),
                        parseError: String(eData)
                    };
                }
            }

            if (rawResponse) {
                try {
                    parseResponse = typeof rawResponse === "string" ?
                        JSON.parse(rawResponse) :
                        rawResponse;
                } catch (eResponse) {
                    parseResponse = {
                        raw: String(rawResponse),
                        parseError: String(eResponse)
                    };
                }
            }

            listData.push({
                id: errorRec['id'] || "",
                requestId: errorRec['request.id'] || "",
                prepaymentId: errorRec['prepayment.id'] || "",
                vendorId: errorRec['vendor.id'] || "",
                contractId: errorRec['contract.id'] || "",
                status: errorRec['status'] || "",
                type: errorRec['type'] || "",
                subType: errorRec['sub.type'] || "",
                message: errorRec['message'] || "",
                apCode: errorRec['ap.code'] || "",
                batchName: errorRec['batch.name'] || "",
                paymentNumber: errorRec['payment.number'] || "",
                transactionId: errorRec['transaction.id'] || "",
                amount: errorRec['amount'] || 0,
                checkedTime: errorRec['checked.time'] || null,
                data: parseData,
                response: parseResponse
            });

            rc = errorRec.getNext();
        }
    } catch (e) {
        logger.info(
            "getAccountingErrors ERROR prepaymentId=" +
            requestId +
            ", error=" +
            String(e)
        );
    } finally {
        try {
            if (errorRec) errorRec.doClose();
        } catch (eClose) {}
    }
    //    print('listData = ', JSON.stringify(listData));
    //    return rteJSONStringify(listData);
    return listData;
}


/** 
 * Hàm này sẽ được gọi từ SM Trigger mỗi khi có Insert/Update/Delete vào esdHTKTaccountingInformation 
 */
function onAccountingInfoSavedTrigger(oldRec, newRec, eventType) {
    var prepaymentId = "";

    // 1. LẤY REQUEST ID 
    // DELETE: lấy từ oldRec vì newRec có thể không tồn tại 
    // ADD / UPDATE: lấy từ newRec 
    if (eventType === "DELETE") {
        if (!oldRec) return;
        prepaymentId = oldRec['prepayment_id'];
    } else {
        if (!newRec) return;
        prepaymentId = newRec['prepayment_id'];
    }

    if (!prepaymentId) return;

    // 2. XỬ LÝ DELETE 
    // Sau khi xóa 1 giao dịch, query lại các giao dịch 
    // ERROR / IN_QUEUE còn lại của cùng một Đề nghị. 
    if (eventType === "DELETE") {
        var deleteTargetRec = new SCFile("esdHTKTaccountingErrorHandling");
        var deleteQuery = 'request.id="' + prepaymentId + '"';

        if (deleteTargetRec.doSelect(deleteQuery) === RC_SUCCESS) {
            var remainRec = new SCFile("esdHTKTaccountingInformation");
            var remainQuery = 'prepayment.id="' + prepaymentId + '" and (status="ERROR" or status="IN_QUEUE")';
            var totalTrans = 0;
            var totalErrorTrans = 0;

            // Đếm lại tổng giao dịch và tổng giao dịch lỗi 
            if (remainRec.doSelect(remainQuery) === RC_SUCCESS) {
                do {
                    totalTrans += 1;
                    var remainStatus = String(remainRec['status'] || "").toUpperCase();
                    if (remainStatus === "ERROR") {
                        totalErrorTrans += 1;
                    }
                } while (remainRec.getNext() === RC_SUCCESS);
            }

            // Không còn ERROR / IN_QUEUE -> xóa bản ghi ErrorHandling 
            if (totalTrans <= 0) {
                deleteTargetRec.doDelete();
            } else {
                // Vẫn còn giao dịch -> cập nhật lại số lượng 
                deleteTargetRec['total_trans'] = totalTrans;
                deleteTargetRec['total_error_trans'] = totalErrorTrans;

                // Nếu còn ít nhất 1 ERROR thì trạng thái chung là ERROR 
                // Nếu chỉ còn IN_QUEUE thì trạng thái chung là IN_QUEUE 
                deleteTargetRec['status'] = totalErrorTrans > 0 ? "ERROR" : "IN_QUEUE";
                deleteTargetRec.doUpdate();
            }
        }
        return;
    }

    // 3. XÁC ĐỊNH TRẠNG THÁI GIAO DỊCH 
    // ERROR và IN_QUEUE đều được xem là giao dịch cần xử lý. 
    // total_error_trans CHỈ tính ERROR. 
    function isErrorStatus(statusStr) {
        var st = String(statusStr || "").toUpperCase();
        return st === "ERROR" || st === "IN_QUEUE";
    }

    var newIsError = isErrorStatus(newRec['status']);
    var oldIsError = oldRec ? isErrorStatus(oldRec['status']) : false;

    if (eventType === "ADD" && !newIsError) return;
    // 4. ĐẾM LẠI TOÀN BỘ GIAO DỊCH CỦA PHIẾU
    // totalTrans tính tất cả trạng thái.
    // totalErrorTrans chỉ tính status ERROR.
    var accountingRec = new SCFile("esdHTKTaccountingInformation");
    var accountingQuery = 'prepayment.id="' + prepaymentId + '"';
    var totalTrans = 0;
    var totalErrorTrans = 0;
    var upperPrepaymentId = prepaymentId.toUpperCase();
    var requestType = "";

    if (accountingRec.doSelect(accountingQuery) === RC_SUCCESS) {
        do {
            totalTrans++;

            // Chỉ giao dịch có status ERROR mới được tính vào tổng giao dịch lỗi
            if (String(accountingRec['status'] || "").toUpperCase() === "ERROR") {
                totalErrorTrans++;
            }
        } while (accountingRec.getNext() === RC_SUCCESS);
    }

    // 5. TÌM BẢN GHI ERROR HANDLING THEO REQUEST ID
    var targetRec = new SCFile("esdHTKTaccountingErrorHandling");
    var targetQuery = 'request.id="' + prepaymentId + '"';

    if (upperPrepaymentId.indexOf('TT') === 0) {
        requestType = "THANH_TOAN";
    } else if (upperPrepaymentId.indexOf('TU') === 0) {
        requestType = "TAM_UNG";
    }

    if (targetRec.doSelect(targetQuery) === RC_SUCCESS) {
        // 6. ĐÃ CÓ BẢN GHI ERROR HANDLING
        // Cập nhật lại số liệu theo dữ liệu thực tế trong bảng accounting.
        targetRec['request_type'] = requestType;
        targetRec['contract_id'] = newRec['contract_id'] || targetRec['contract_id'] || "";
        targetRec['total_trans'] = totalTrans;
        targetRec['total_error_trans'] = totalErrorTrans;

        // Không còn giao dịch ERROR thì xóa khỏi bảng ErrorHandling.
        if (totalErrorTrans <= 0) {
            targetRec.doDelete();
            print('[Trigger] Đã xóa phiếu ko có giao dịch lỗi khỏi danh sách [request.id] = ' + prepaymentId);
        } else {
            targetRec['status'] = ACCOUNTING_STATUS.ERROR;
            targetRec.doUpdate();
            print('[Trigger] Phiếu vẫn còn giao dịch lỗi, update lại thông tin bản ghi [totalTrans] = ' + totalTrans + ', [totalErrorTrans] = ' + totalErrorTrans);
        }
    } else {
        // 7. CHƯA CÓ ERROR HANDLING
        // Chỉ tạo mới khi phiếu có ít nhất 1 giao dịch ERROR
        if (totalErrorTrans > 0) {
            print('[Trigger - CREATE]');
            // Gọi Sequential Number của SM để sinh ID tự động.
            var rc = 0;
            var newId = new SCDatum();
            rc = system.functions.rtecall("getnumber", rc, newId, "esdHTKTaccountingErrorHandling");
            var generatedId = newId ? String(newId.getText() || "") : "";

            if (!generatedId) {
                print('[Trigger - CREATE] Không sinh được ID, RC = ' + String(rc));
                return;
            }

            targetRec['id'] = generatedId;
            targetRec['request_id'] = prepaymentId;
            targetRec['request_type'] = requestType;
            targetRec['contract_id'] = newRec['contract_id'] || "";
            targetRec['status'] = ACCOUNTING_STATUS.ERROR;
            targetRec['total_trans'] = totalTrans;
            targetRec['total_error_trans'] = totalErrorTrans;
            var insertRc = targetRec.doInsert();
        }
    }
}
