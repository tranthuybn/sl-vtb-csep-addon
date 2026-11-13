// Log bằng print để hiển thị trực tiếp trong Messages của Service Manager.

//Van tin tai khoan trong he thong
function checkNameAccount(acctId) {
    var requestId = lib.UUID.generateUUID().toLowerCase();
    if (!acctId) {
        print('ESD_HTKT_FUND_TRANSFER_INTEGRATION::checkNameAccount: Du lieu dau vao chua hop le');
        return;
    }
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('core');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    //    ["coreClientId","coreChannel","corePassword","coreUsername"].forEach(k=> {
    //        print(`${k} : ${config[k]}`);
    //    })
    if (!token || !config) return null;

    var url = config.coreBaseUrl + "/msa/prf-dep-inq/v1/acct-inq";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token),
        new Header("RequestId", requestId),
        new Header("username", config['coreUsername']),
        new Header("password", config['corePassword']),
        new Header("ClientID", config['coreClientId']),
        new Header("RequestTime", lib.ESD_HTKT_Utils.formatDateToISOWithOffset2())
    ];
    var data = {
        "data": {
            "acctId": acctId
        }
    };
//    print('checkNameAccount::request: ' + rteJSONStringify(data));
    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(data), headers);
//    print('checkNameAccount::httpStatus: ' + (response ? response.statusCode : null));
    print('checkNameAccount::response: ' + (response ? response.body : null));
    if (response && response.body) {
        try {
            var responseObj = rteJSONParse(response.body);
            if (responseObj) {
                return responseObj;
            }
        } catch (e) {
            print('checkNameAccount::error: API return invalid JSON');
            return {
                status: {
                    code: "400",
                    detail: "Fail: " + response.body
                }
            };
        }
    }

    return null;
}

//print(rteJSONStringify(checkNameAccount('1111')));

//Van tin tai khoan ngoai he thong
function checkNameAccountNapas(acctId, napasCode) {
    var requestId = lib.UUID.generateUUID().toLowerCase();
    if (!acctId || !napasCode) {
        print('HTKT::checkNameAccount: Du lieu dau vao chua hop le');
        return;
    }
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('core');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    // 1. URL & Headers theo đúng thông tin bạn cung cấp
    var url = config.coreBaseUrl + "/payment-hub/pmh-rtgs-out/v1/acctinq";
    var headers = [
        new Header("content-type", "application/json"),
        new Header("accept", "application/json"),
        new Header("Authorization", "Bearer " + token),
        new Header("RequestId", requestId),
        new Header("RequestTime", lib.ESD_HTKT_Utils.formatDateToISOWithOffset()),
        new Header("ClientId", config['coreClientId']),
        new Header("userAD", config['coreClientId']) // userAD là ClientID trước đó
    ];

    // 2. Request body đúng theo ảnh
    var checkData = {
        "channelName": config['coreClientId'],
        "rcvrType": "ACC",
        "receiveCode": napasCode,
        "accountNo": acctId
    };

    // print('checkNameAccount::request: ' + rteJSONStringify(checkData));
    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(checkData), headers);
    print('checkNameAccount::response: ' + (response ? rteJSONStringify(response) : null));

    // 3. Xử lý Response theo cấu trúc trả về trong ảnh
    if (response) {
        try {
            // response.body có thể là string JSON hoặc đã parse thành Object
            var responseObj = null;
            if (response.body) {
                responseObj = (typeof response.body === 'string') ? rteJSONParse(response.body) : response.body;
            } else if (response.rawBody) {
                responseObj = rteJSONParse(response.rawBody);
            }

            if (responseObj) {
                return responseObj;
            }
        } catch (e) {
            print('checkNameAccountNapas::error: API return invalid JSON');
            return {
                status: {
                    code: "400",
                    detail: "Fail: " + (response.body || response.rawBody || e)
                }
            };
        }
    }

    return null;
}

//Chuyen tien trong he thong

function fundTranfer(transferData) {
    if (!transferData || !transferData["requestId"] || !transferData['data']) {
        print('HTKT::fundTranfer: Du lieu dau vao chua hop le');
        return null;
    }
    var requestId = transferData["requestId"];
    var dateString = lib.ESD_HTKT_Utils.formatDateToISOWithOffset();
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('core');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.coreBaseUrl + "/msa/api/transfer-in/fundstransferadd";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token),
        new Header("requestId", requestId),
        new Header("username", config['coreUsername']),
        new Header("password", config['corePassword']),
        new Header("ClientID", config['coreClientId']),
        new Header("RequestTime", dateString),
    ];

    transferData['clientDt'] = dateString;
    transferData['channel'] = config['coreChannel'];
    transferData['trnRefNum'] = requestId;
    try {
        transferData.data.depAcctIdFrom.acctId = '224420600';
    } catch (e) {
        print('cannot set transfer account');
    }

    print('fundTranfer::request: ' + rteJSONStringify(transferData));
    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(transferData), headers);
    print('fundTranfer::httpStatus: ' + (response ? response.statusCode : null));
    print('fundTranfer::response: ' + (response ? response.body : null));
    var result = {
        body: null,
        rawBody: response ? response.body : null,
        httpStatus: response ? response.statusCode : null,
        error: response ? response.error : "No response from CORE"
    };

    if (response && response.body) {
        try {
            result.body = rteJSONParse(response.body);
        } catch (e) {
            result.error = "CORE return invalid JSON";
            print('fundTranfer::error: ' + result.error);
        }
    }

    return result;
}

//Chuyen tien ngoai he thong
function fundTranferOut(transferData) {
    if (!transferData || !transferData["requestId"] || !transferData['data']) {
        print('HTKT::fundTranfer: Du lieu dau vao chua hop le');
        return null;
    }

    //    var requestId = lib.UUID.generateUUID().toLowerCase();
    var dateString = lib.ESD_HTKT_Utils.formatDateToISOWithOffset();
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('core');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.coreBaseUrl + "/msa/api/transfer-out/pmtadd";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token),
        new Header("requestId", transferData["requestId"]),
        new Header("username", config['coreUsername']),
        new Header("password", config['corePassword']),
        new Header("channel", config['coreChannel']),
        new Header("ClientID", config['coreClientId']),
        new Header("RequestTime", lib.ESD_HTKT_BASE_API_INTEGRATION.getUnixTimestamp())
    ];
    transferData['clientDt'] = dateString;
    transferData['channel'] = config['coreChannel'];
    transferData['reftype'] = config['coreUsername'];
    try {
        transferData['data']['chanRefNum'] = String(
            transferData["requestId"]
        ).substring(0, 16); // truong them 
        transferData['data']['fromAcctId'] = '224420600';
        transferData['data']['pmtMethod'] = 'GL Account';
    } catch (e) {
        print('cannot set transfer account');
    }
    
    print('fundTranferOut::request: ' + rteJSONStringify(transferData));
    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(transferData), headers);
    print('fundTranferOut::httpStatus: ' + (response ? response.statusCode : null));
    print('fundTranferOut::response: ' + (response ? response.body : null));
    var result = {
        body: null,
        rawBody: response ? response.body : null,
        httpStatus: response ? response.statusCode : null,
        error: response ? response.error : "No response from CORE"
    };

    if (response && response.body) {
        try {
            result.body = rteJSONParse(response.body);
        } catch (e) {
            result.error = "CORE return invalid JSON";
            print('fundTranferOut::error: ' + result.error);
        }
    }

    return result;
}

/**
 * Van tin trang thai giao dich chuyen tien theo ma tham chieu kenh.
 *
 * Dau vao ho tro:
 * - inquireTransactionStatus("ma-tham-chieu")
 * - inquireTransactionStatus({ chanRefno: "ma-tham-chieu" })
 * - inquireTransactionStatus({
 *       chanRefno: "ma-tham-chieu",
 *       requestId: "request-id-cua-lan-van-tin"
 *   })
 *
 * requestId la ma duy nhat cua lan goi API van tin. Neu khong truyen,
 * he thong tu sinh UUID. chanRefno la ma tham chieu cua giao dich can tim.
 */
function inquireTransactionStatus(input) {
    var options = typeof input === "string"
            ? { chanRefno: input }
            : (input || {});
    var chanRefno = String(options.chanRefno || "").trim();
    var inquiryRequestId = String(options.requestId || "").trim();

    var result = {
        success: false,
        callSucceeded: false,
        requestId: inquiryRequestId,
        chanRefno: chanRefno,
        provider: "CORE",
        endpoint: "",
        body: null,
        rawBody: null,
        httpStatus: null,
        statusCode: "",
        statusDetail: "",
        error: null
    };

    if (!inquiryRequestId) {
        inquiryRequestId = String(
                lib.UUID.generateUUID() || ""
        ).toLowerCase();
        result.requestId = inquiryRequestId;
    }

    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('core');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();

    if (!token || !config || !String(config.coreBaseUrl || "").trim()) {
        result.error = "CORE inquiry configuration or access token is missing";
        return result;
    }


    var requestTime = lib.ESD_HTKT_Utils.formatDateToISOWithOffset2();
    var url = config.coreBaseUrl + "/msa/prf-account-trans/v1/payment-inq";
    result.endpoint = url;
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token),
        new Header("RequestId", inquiryRequestId),
        new Header("username", config['coreUsername']),
        new Header("password", config['corePassword']),
        new Header("ClientID", config['coreClientId']),
        new Header("RequestTime", requestTime)
    ];
    var payload = {
        data: {
            chanRefno: chanRefno
        }
    };

    var response = null;
    try {
        response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(
                url,
                rteJSONStringify(payload),
                headers
        );
    } catch (eCall) {
        result.error = "CORE inquiry call failed: " +
                String(eCall && eCall.message || eCall);
        print('inquireTransactionStatus::error: ' + result.error);
        return result;
    }

    result.httpStatus = response && response.statusCode !== undefined
            ? response.statusCode
            : (response && response.httpStatus !== undefined
                    ? response.httpStatus
                    : null);
    result.rawBody = response && response.body !== undefined
            ? response.body
            : response;
    result.error = response ? (response.error || null) : "No response from CORE";

    if (result.rawBody && typeof result.rawBody === "object") {
        result.body = result.rawBody;
    } else if (result.rawBody) {
        try {
            result.body = rteJSONParse(String(result.rawBody));
        } catch (eParse) {
            result.error = "CORE inquiry returned invalid JSON";
        }
    }

    var businessStatus = result.body && result.body.status &&
            typeof result.body.status === "object"
            ? result.body.status
            : {};
    result.statusCode = businessStatus.code === null ||
            businessStatus.code === undefined
            ? ""
            : String(businessStatus.code).trim();
    result.statusDetail = String(businessStatus.detail || "").trim();

    var httpStatusCode = Number(result.httpStatus);
    var isHttpSuccess = httpStatusCode === 200;
    var isBusinessSuccess = result.statusCode === "0";

    // Only HTTP 200 allows the retry flow to process the business result.
    result.callSucceeded = isHttpSuccess;

    result.success = isHttpSuccess &&
            result.body !== null &&
            isBusinessSuccess &&
            !result.error;

    if (!result.success && !result.error) {
        if (!isHttpSuccess) {
            result.error = "CORE inquiry HTTP status: " + result.httpStatus;
        } else if (!result.statusCode) {
            result.error = "CORE inquiry response has no status.code";
        } else {
            result.error = result.statusDetail ||
                    ("CORE inquiry failed with status code: " +
                    result.statusCode);
        }
    }


    return result;
}

// Vi du test tren SM ScriptLibrary (khong hardcode trong luong nghiep vu):
// print(rteJSONStringify(inquireTransactionStatus("<chanRefno>")));
