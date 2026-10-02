var logger = getLog("ESD_HTKT_INVOICE_OGL_INTEGRATION");
/**
 * Hàm tao activity
 */

/**
 * Kiểm tra hóa đơn (Check Invoice)
 * @param {Object} invoiceData - Object chứa thông tin hóa đơn truyền vào từ SM
 * @returns {Object|null} Trả về data kết quả từ API hoặc null
 */
function checkInvoice(invoiceData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/invoice/check-invoice";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(invoiceData), headers);
    //    logger.info('ESD_HTKT_INVOICE_OGL_INTEGRATION::checkInvoice::response: ' + responseStr);
    if (responseStr) {
        try {
            return rteJSONParse(responseStr);
        } catch (e) {
            logger.info('checkInvoice::error: API return invalid JSON');
            return {
                success: false,
                message: "Fail: " + responseStr
            };
        }
    }

    return null;
}

//function checkInvoice(invoiceData) {
//    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('vatin');
//    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
//    if (!token || !config) {
//        logger.error('checkInvoice::error: Missing token or system config');
//        return { success: false, message: "Missing authorization token or system configuration" };
//    }
//
//    var url = config.vatinBaseUrl + "/tax/check-all-api";
//    var headers = [
//        new Header("Content-Type", "application/json"),
//        new Header("Authorization", "Bearer " + token)
//    ];
//    
//    var payload = rteJSONStringify(invoiceData);
//    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, payload, headers);
//    
//    if (responseStr) {
//        if (typeof responseStr === 'string' && responseStr.trim() === '') {
//            return { success: false, message: "API returned empty response" };
//        }
//
//        try {
//            return rteJSONParse(responseStr);
//        } catch (e) {
//            logger.error('checkInvoice::error: API return invalid JSON. Raw response: ' + responseStr);
//            return {
//                success: false,
//                message: "API returned non-JSON content",
//                rawResponse: responseStr
//            };
//        }
//    }
//
//    logger.error('checkInvoice::error: No response received from API endpoint');
//    return { success: false, message: "No response from API server" };
//}

/**
 * 2. Kiểm tra số tiền hóa đơn (Check Amount)
 * @param {Array} checkAmountList - Mảng danh sách các object chứa thông tin số tiền cần kiểm tra
 */
function checkAmount(checkAmountList) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/invoice/check-amount";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(checkAmountList), headers);
    logger.info('ESD_HTKT_INVOICE_OGL_INTEGRATION::checkAmountList::response: ' + responseStr);
    if (responseStr) {
        try {
            return rteJSONParse(responseStr);
        } catch (e) {
            logger.info('checkAmount::error: API return invalid JSON');
            return {
                success: false,
                message: "Fail: " + responseStr
            };
        }
    }
    return null;
}


// Van tin site NCC
function getVendorSiteInfo(vendorData) {
    if (!vendorData || !vendorData.vendorNumber) {
        logger.info('ESD_HTKT_INVOICE_OGL_INTEGRATION::getVendorSiteInfo: Du lieu truy van khong hop le');
        return null;
    }
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;
    var queryParams = [];
    ['entity', 'vendorName', 'vendorNumber', 'vendorSiteCode'].forEach(name => {
        if (vendorData[name]) {
            queryParams.push(`${name}=${encodeURIComponent(vendorData[name])}`);
        }
    });
    var url = `${config.oglBaseUrl}/vendors/site-info?${queryParams.join('&')}`;
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.get(url, headers);
    logger.info('ESD_HTKT_INVOICE_OGL_INTEGRATION::getVendorSiteInfo::response: ' + responseStr);
    if (responseStr) {
        try {
            return rteJSONParse(responseStr);
        } catch (e) {
            logger.info('getVendorSiteInfo::error: API return invalid JSON');
            return {
                success: false,
                message: "Fail: " + responseStr
            };
        }
    }

    return null;
}

// Tao site/Ncc 
function createVendorSiteInfo(vendorData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/vendors/site";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    // tam thoi trong luc cho confirm
    //    vendorData.username = "VTB.HTKT.110";

    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(vendorData), headers);
    logger.info('ESD_HTKT_INVOICE_OGL_INTEGRATION::createVendorSiteInfo::response: ' + responseStr);
    if (responseStr) {
        try {
            return rteJSONParse(responseStr);
        } catch (e) {
            logger.info('createVendorSiteInfo::error: API return invalid JSON');
            return {
                success: false,
                message: "Fail: " + responseStr
            };
        }
    }

    return null;
}

// Kiem tra cong no
function checkVendorDebtReport(vendorData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/vendor-debts/report";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(vendorData), headers);
    logger.info('ESD_HTKT_INVOICE_OGL_INTEGRATION::checkVendorDebtReport::response: ' + responseStr);
    if (responseStr) {
        try {
            return rteJSONParse(responseStr);
        } catch (e) {
            logger.info('checkVendorDebtReport::error: API return invalid JSON');
            return {
                success: false,
                message: "Fail: " + responseStr
            };
        }
    }

    return null;
}

// Thanh toan hoa don
function createApInvoice(invoiceData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/ap/create-invoice";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    // tam thoi trong luc cho confirm
    //    invoiceData.checker = "VTB.HTKT.110";
    //    invoiceData.maker = "VTB.HTKT.113";

    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(invoiceData), headers);
    logger.info('ESD_HTKT_INVOICE_OGL_INTEGRATION::createApInvoice::response: ' + responseStr);
    if (responseStr) {
        try {
            return rteJSONParse(responseStr);
        } catch (e) {
            logger.info('createApInvoice::error: API return invalid JSON');
            return {
                success: false,
                message: "Fail: " + responseStr
            };
        }
    }

    return null;
}

// Kiem tra trang thai giao dich AP
function checkAP(apData) {
    if (!apData || !apData.transactionId || apData.transactionId.trim().length === 0 || !apData.requestId || apData.requestId.trim().length === 0) return null;
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;
    const { transactionId, requestId } = apData;
    var url = `${config.oglBaseUrl}/ap/check?transactionId=${encodeURIComponent(transactionId)}&requestId=${encodeURIComponent(requestId)}`;
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.get(url, headers);
    logger.info('checkAP::response: ' + responseStr);
    if (responseStr) {
        try {
            return rteJSONParse(responseStr);
        } catch (e) {
            logger.info('checkAP::error: API return invalid JSON');
            return {
                success: false,
                message: "Fail: " + responseStr
            };
        }
    }

    return null;
}

// Hach toan batch phan he OGL
function createBatchGL(glData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/general-ledger/interface";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(glData), headers);
    logger.info('createBatchGL::response: ' + responseStr);
    if (responseStr) {
        try {
            return rteJSONParse(responseStr);
        } catch (e) {
            logger.info('createBatchGL::error: API return invalid JSON');
            return {
                success: false,
                message: "Fail: " + responseStr
            };
        }
    }

    return null;
}

// Kiem tra trang thai batch
function checkBatchGl(transactionId) {
    if (!transactionId || transactionId.trim().length === 0) return null;
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var checkData = { "transactionId": transactionId };

    var url = config.oglBaseUrl + "/batch/status";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(checkData), headers);
    logger.info('checkBatchGl::response: ' + responseStr);
    if (responseStr) {
        try {
            return rteJSONParse(responseStr);
        } catch (e) {
            logger.info('checkBatchGl::error: API return invalid JSON');
            return {
                success: false,
                message: "Fail: " + responseStr
            };
        }
    }

    return null;
}

// Thanh toan yeu cau thanh toan da co tu truoc
function createApPayment(invoiceData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/ap/create-payment";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    rteJSONStringify("token " + token)

    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(invoiceData), headers);
    logger.info('createApPayment::response: ' + responseStr);
    if (responseStr) {
        try {
            return rteJSONParse(responseStr);
        } catch (e) {
            logger.info('createApPayment::error: API return invalid JSON');
            return {
                success: false,
                message: "Fail: " + responseStr
            };
        }
    }

    return null;
}