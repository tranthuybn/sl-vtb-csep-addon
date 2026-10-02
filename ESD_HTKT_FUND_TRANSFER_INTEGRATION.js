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

    var url = config.coreBaseUrl + "/prf-dep-inq/v1/acct-inq";
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
    print('checkNameAccount::request: ' + rteJSONStringify(data));
    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(data), headers);
    print('checkNameAccount::httpStatus: ' + (response ? response.statusCode : null));
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

    var url = config.coreBaseUrl + "/gateway-info-inq/v1/gwinfoinq";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token),
        new Header("requestId", "ac1b7dc8-bd99-425a-a775-56bd512ab33b"),
        new Header("username", config['coreUsername']),
        new Header("password", config['corePassword']),
        new Header("ClientID", config['coreClientId']),
        new Header("RequestTime", lib.ESD_HTKT_Utils.formatDateToISOWithOffset()),
    ];

    var checkData = {
        "spname": "com.fnf.xes.SML",
        "reftype": config['coreClientId'],
        "refid": config['coreClientId'],
        "data": {
            "gwLogicalName": "G003_SML",
            "gwActionCode": "S03_SML_ACCOUNT_INQ",
            "acctIdFrom": "100868368326",
            "acctIdTo": acctId,
            "bankIdTo": napasCode,
            "postingDt": lib.ESD_HTKT_Utils.formatDateToISO(),
            "processingCode": "432020",
            "amt": 0,
            "curCode": "VND",
            "comment": "RTGS Transaction",
            "acquiredId": "970415",
            "merchantType": "7399"
        }
    };
    print('checkNameAccount::request: ' + rteJSONStringify(checkData));
    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(checkData), headers);
    print('checkNameAccountNapas::httpStatus: ' + (response ? response.statusCode : null));
    print('checkNameAccount::response: ' + (response ? response.body : null));
    if (response && response.body) {
        try {
            var responseObj = rteJSONParse(response.body);
            if (responseObj) {
                return responseObj;
            }
        } catch (e) {
            print('checkNameAccountNapas::error: API return invalid JSON');
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

    var url = config.coreBaseUrl + "/api/transfer-in/fundstransferadd";
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
    //    var data = {
    //        "requestId": requestId,
    //        "clientDt": dateString,
    //        "channel": config['coreChannel'],
    //        "spname": "com.xesapi.xferadd20.FunsTransferAdd",
    //        "data": {
    //            "depAcctIdFrom": {
    //                "acctId": "1111",
    //                "acctCur": "VND"
    //            },
    //            "depAcctIdTo": {
    //                "acctId": "117000115134",
    //                "acctCur": "VND"
    //            },
    //            "amount": "10000", // so tien chuyen
    //            "curCode": "VND", // loai tien
    //            "reversedInd": "N",
    //            "trnRefNum": requestId,
    //            "notes": "Chuyen tien trong he thong" // Nội dung chuyển tiền
    //        }
    //    };

    print('fundTranfer::request: ' + rteJSONStringify(transferData));
    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(transferData), headers);
    print('fundTranfer::httpStatus: ' + (response ? response.statusCode : null));
    print('fundTranfer::response: ' + (response ? response.body : null));
    if (response && response.body) {
        try {
            var responseObj = rteJSONParse(response.body);
            if (responseObj) {
                return responseObj;
            }
        } catch (e) {
            print('fundTranfer::error: API return invalid JSON');
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

    var url = config.coreBaseUrl + "/api/transfer-out/pmtadd";
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
    //    var data = {
    //        "requestId": requestId,
    //        "clientDt": dateString,
    //        "channel": config['coreChannel'],
    //        "reftype": "IB",
    //        //        "refid": "945284",
    //        "spname": "com.fnf.xes.PRF",
    //        "data": {
    //            //            "uid": "",
    //            "serviceBranch": "",
    //            "approveId": "",
    //            "pmtType": "Outgoing IBPS_Bilateral",
    //            "pmtMethod": "Account",
    //            "trnType": "Transaction Internet Banking",
    //            "fromAcctId": "101870783864", // tai khoan chuyen
    //            //            "fromBankId": "", // citad
    //            //            "fromBranchId": "",
    //            //            "fromAcctName": "",
    //            //            "toCardNum": "",
    //            "toAcctId": "", // tai khoan nhan
    //            "toBankId": "", // citad code
    //            "toBranchId": "79616001", // citad branch code
    //            "toAcctName": "NGUYEN THI MY LIEN", // ten nguoi thu huong
    //            "amount": [{
    //                "amount": "3000", // so tien chuyen
    //                "crcd": "VND", // loai tien chuyen
    //                "amountType": "TRAN_AMOUNT"
    //            }],
    //            "trnDesc": "CHUYEN TIEN", // noi dung chuyen tien
    //            "chanRefNum": requestId
    //        }
    //    };
    print('fundTranferOut::request: ' + rteJSONStringify(transferData));
    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(transferData), headers);
    print('fundTranferOut::httpStatus: ' + (response ? response.statusCode : null));
    print('fundTranferOut::response: ' + (response ? response.body : null));
    if (response && response.body) {
        try {
            var responseObj = rteJSONParse(response.body);
            if (responseObj) {
                return responseObj;
            }
        } catch (e) {
            print('fundTranferOut::error: API return invalid JSON');
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
