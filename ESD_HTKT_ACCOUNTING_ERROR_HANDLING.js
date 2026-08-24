var logger = getLog('ESD_HTKT_ACCOUNTING_ERROR_HANDLING');

var ACCOUNTING_ERROR_STATUS = 'ERROR';

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
            if (String(accountingFile.status || '').toUpperCase() === ACCOUNTING_ERROR_STATUS) {
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

        errorFile['request.id'] = requestId;
        errorFile['request.type'] = requestType;
        errorFile['contract.id'] = contractId;
        errorFile.status = ACCOUNTING_ERROR_STATUS;
        errorFile['total.trans'] = totalTrans;
        errorFile['total.error.trans'] = totalErrorTrans;
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
 * Hàm test thủ công: truyền request.id của esdHTKTaccountingInformation,
 * đọc record tương ứng rồi gọi luồng lưu tổng hợp lỗi.
 */
function testSaveAccountingErrorHandling(accountingRequestId) {
    var requestId = String(accountingRequestId || '').trim();
    if (!requestId) {
        return { success: false, error: 'Thiếu request.id của accounting information.' };
    }

    var itemAccounting = null;
    try {
        itemAccounting = new SCFile('esdHTKTaccountingInformation', SCFILE_READONLY);
        var rc = itemAccounting.doSelect('request.id = "' + escapeQueryValue(requestId) + '"');
        if (rc != RC_SUCCESS) {
            return {
                success: false,
                error: 'Không tìm thấy esdHTKTaccountingInformation với request.id = ' + requestId + '.'
            };
        }

        saveAccountingErrorHandling(itemAccounting);
        return {
            success: true,
            requestId: requestId,
            prepaymentId: String(itemAccounting['prepayment.id'] || '').trim()
        };
    } catch (e) {
        logger.info('testSaveAccountingErrorHandling: ' + e);
        return { success: false, error: String(e) };
    } finally {
        try { if (itemAccounting) itemAccounting.doClose(); } catch (closeError) {}
    }
}

// Test thủ công:
// lib.ESD_HTKT_ACCOUNTING_ERROR_HANDLING.testSaveAccountingErrorHandling('ACCOUNTING_REQUEST_ID');
