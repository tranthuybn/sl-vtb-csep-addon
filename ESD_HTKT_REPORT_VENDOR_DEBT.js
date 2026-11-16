/**
 * ScriptLibrary : ESD_HTKT_REPORT_VENDOR_DEBT
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Báo cáo công nợ nhà cung cấp theo hợp đồng
 * Table đích   : esdHTKTreportVendorDebt
 * -----------------------------------------------------------------------------
 * Chức năng:
 * - Thu thập thông tin Hợp đồng (esdHDcontract) & Nhà cung cấp (esdHTKTvendor, esdHDcontractSupplier).
 * - Tính toán 4 chỉ số tài chính cấp NCC theo đúng logic chuẩn (bao gồm cả phiếu approved và accounted):
 *   1) total.payable.amount : Số công nợ phải trả NCC (Công nợ 331 còn lại)
 *      -> Lấy theo trường debt.amount bảng esdHTKTpaymentVendor (phiếu approved/accounted).
 *   2) total.advance.amount : Số tiền đã tạm ứng cho NCC
 *      -> Lấy theo các khoản TAM_UNG (phiếu ĐNTƯ approved/accounted).
 *   3) total.refund.amount  : Số tiền hoàn ứng từ NCC
 *      -> Lấy theo các khoản hoàn ứng PREPAYMENT thuộc phiếu ĐNTT (phiếu approved/accounted).
 *   4) total.paid.amount    : Số tiền đã thanh toán thực tế cho NCC
 *      -> Lấy theo các phiếu ĐNTT & thuế ĐNTƯ (phiếu approved/accounted).  
 * - Lưu / Cập nhật (Upsert) dữ liệu vào bảng esdHTKTreportVendorDebt.
 * -----------------------------------------------------------------------------
 */

function run() {
    try {
        var input = null;
        try { input = vars['$L.file']; } catch (ignoreInput) {}

        var contractId = "";
        var vendorId = "";
        var recordId = "";
        var type = "";
        var currentUser = "SYSTEM";

        if (input) {
            currentUser = String(input["created.by"] || input.operator || (vars['$lo_operator'] ? vars['$lo_operator']["contact.name"] : "") || "SYSTEM");
            if (input.contractId) contractId = String(input.contractId).trim();
            else if (input["contract.id"]) contractId = String(input["contract.id"]).trim();
            if (input.vendorId) vendorId = String(input.vendorId).trim();
            else if (input["vendor.id"]) vendorId = String(input["vendor.id"]).trim();
            if (input.recordId || input.paymentId || input.prepaymentId) {
                recordId = String(input.recordId || input.paymentId || input.prepaymentId).trim();
            }
            if (input.type) type = String(input.type).trim();

            if (!contractId && !recordId && input.queryString) {
                try {
                    var q = JSON.parse(input.queryString);
                    if (Array.isArray(q)) q = q[0] || {};
                    contractId = String(q.contractId || q.contract_id || "").trim();
                    vendorId = String(q.vendorId || q.vendor_id || "").trim();
                    recordId = String(q.recordId || q.paymentId || q.prepaymentId || q.id || "").trim();
                    type = String(q.type || "").trim();
                } catch (eQ) {}
            } else if (!contractId && !recordId && input.details) {
                try {
                    var d = JSON.parse(input.details);
                    contractId = String(d.contractId || d.contract_id || "").trim();
                    vendorId = String(d.vendorId || d.vendor_id || "").trim();
                    recordId = String(d.recordId || d.paymentId || d.prepaymentId || d.id || "").trim();
                    type = String(d.type || "").trim();
                } catch (eD) {}
            }
        }

        var result;
        if (recordId && type) {
            result = syncVendorDebtReportForHTKT(recordId, type, currentUser);
        } else {
            result = syncVendorDebtReport(contractId, vendorId, currentUser);
        }

        if (input) {
            input.queryReturn = JSON.stringify(result);
        }

        return result;
    } catch (err) {
        var errResult = {
            success: false,
            message: "Lỗi thực thi syncVendorDebtReport: " + err.toString()
        };
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify(errResult);
        }
        return errResult;
    }
}

/**
 * Hàm gọi từ các SL khác của HTKT:
 * Nhận vào ID của phiếu Payment hoặc Prepayment và chuỗi type quyết định bảng cần query để lấy mã hợp đồng (contract.id),
 * sau đó gọi syncVendorDebtReport(contractId) để đổ dữ liệu vào bảng esdHTKTreportVendorDebt.
 *
 * @param {string} recordId     - ID của phiếu ĐNTT (esdHTKTpayment) hoặc ĐNTƯ (esdHTKTprepayment)
 * @param {string} type         - Chuỗi xác định loại phiếu:
 *                                + Payment    : "payment" | "PAYMENT" | "esdHTKTpayment" | "TT" | "THANH_TOAN"
 *                                + Prepayment : "prepayment" | "PREPAYMENT" | "esdHTKTprepayment" | "TU" | "TAM_UNG"
 * @param {string} operatorName - Người thực hiện (tùy chọn)
 */
function syncVendorDebtReportForHTKT(recordId, type, operatorName) {
    recordId = String(recordId || "").trim();
    var normalizedType = String(type || "").trim().toUpperCase();

    if (!recordId || !normalizedType) {
        var msgMissing = "Thiếu recordId hoặc type khi gọi syncVendorDebtReportForHTKT (recordId=" + recordId + ", type=" + type + ").";
        return {
            success: false,
            message: msgMissing
        };
    }

    var tableName = "";
    var isPayment = false;
    var isPrepayment = false;
    if (
            normalizedType === "PAYMENT" ||
            normalizedType === "THANH_TOAN"
    ) {
        tableName = "esdHTKTpayment";
        isPayment = true;
    } else if (
            normalizedType === "PREPAYMENT" ||
            normalizedType === "TAM_UNG"
    ) {
        tableName = "esdHTKTprepayment";
        isPrepayment = true;
    } else {
        var msgInvalidType = "Giá trị type không hợp lệ: " + type + " (chỉ hỗ trợ PAYMENT hoặc PREPAYMENT).";
        return {
            success: false,
            message: msgInvalidType
        };
    }

    var contractId = "";
    var user = operatorName || "";
    var rec = null;

    try {
        rec = new SCFile(tableName, SCFILE_READONLY);
        var query = 'id="' + escapeSmQueryValue(recordId) + '"';
        if (rec.doSelect(query) !== RC_SUCCESS) {
            var msgNotFound = "Không tìm thấy bản ghi id=" + recordId + " trong bảng " + tableName;
            return {
                success: false,
                message: msgNotFound
            };
        }

        contractId = String(rec["contract.id"] || rec["contract.code"] || "").trim();
        var docStatus = String(rec["status"] || "").trim().toLowerCase();
        var docPhase = String(rec["current.phase"] || "").trim().toLowerCase();
        if (!user) {
            user = String(rec["updated.by"] || rec["created.by"] || "SYSTEM").trim();
        }
    } catch (eQuery) {
        var msgErr = "Lỗi truy vấn bảng " + tableName + " với id=" + recordId + ": " + eQuery.toString();
        return {
            success: false,
            message: msgErr
        };
    } finally {
        closeSCFile(rec);
    }

    if (!contractId) {
        var msgNoContract = "Bản ghi " + recordId + " trong bảng " + tableName + " không có mã hợp đồng (contract.id).";
        return {
            success: false,
            message: msgNoContract
        };
    }

    // Đảm bảo điều kiện lấy công nợ: Phiếu phải ở trạng thái approved hoặc accounted
    var isApprovedOrAccounted = (docStatus === "approved" || docStatus === "accounted" || docPhase === "approved" || docPhase === "accounted" || docPhase === "end");
    if (!isApprovedOrAccounted) {
        var msgNotApproved = "Bản ghi " + recordId + " trong bảng " + tableName + " có trạng thái '" + docStatus + "' (chưa approved hoặc accounted), không tính công nợ.";
        return {
            success: false,
            message: msgNotApproved
        };
    }


    if (isPayment) {
        return syncPaymentIncremental(recordId, contractId, user);
    } else if (isPrepayment) {
        return syncPrepaymentIncremental(recordId, contractId, user);
    }

    return syncVendorDebtReport(contractId, "", user);
}

/**
 * Hàm điều phối tổng hợp và đổ trực tiếp dữ liệu báo cáo công nợ NCC vào bảng esdHTKTreportVendorDebt
 * @param {string} filterContractId - Mã hợp đồng cần đồng bộ (bắt buộc không được rỗng)
 * @param {string} filterVendorId   - ID NCC cần đồng bộ (tùy chọn)
 * @param {string} operatorName     - Người thực hiện
 */

/**
 * Lấy tổng số tiền thanh toán từ dòng CORE của phiếu Payment trong esdHTKTaccountingInformation (type="CORE").
 * Nếu không có dòng CORE (ví dụ thanh toán tiền mặt/chưa sinh CORE), fallback về fallbackAmount (pvFile["amount"]).
 * @param {string} paymentId - ID phiếu thanh toán
 * @param {string} vendorId  - ID nhà cung cấp
 * @param {number} fallbackAmount - Số tiền dự phòng nếu chưa có accountingInformation
 * @returns {number} Số tiền thanh toán thực tế dòng CORE
 */
function getPaymentCorePayAmount(paymentId, vendorId, fallbackAmount) {
    var aiFile = null;
    try {
        aiFile = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
        var q = 'prepayment.id="' + escapeSmQueryValue(paymentId) + '" and type="CORE"';
        if (vendorId) {
            q += ' and vendor.id="' + escapeSmQueryValue(vendorId) + '"';
        }
        var rc = aiFile.doSelect(q);
        var totalCore = 0;
        var found = false;
        while (rc == RC_SUCCESS) {
            var amt = getNumberField(aiFile, ["amount", "ai.amount"]);
            if (amt > 0) {
                totalCore += amt;
                found = true;
            }
            rc = aiFile.getNext();
        }
        if (found) return totalCore;
    } catch (eAi) {
    } finally {
        closeSCFile(aiFile);
    }
    return fallbackAmount || 0;
}

/**
 * Xử lý tính tổng công nợ cộng dồn cho phiếu PAYMENT:
 * - Lấy debt.amount của paymentVendor ứng với payment.id hiện tại.
 * - Lấy số tiền thanh toán thực tế từ dòng CORE của payment (type="CORE" trong esdHTKTaccountingInformation).
 * - Nếu thanh toán có nhiều NCC thì gom nhóm và tính tổng theo từng NCC.
 * - Nếu (contract.id, vendor.id) chưa có trong esdHTKTreportVendorDebt: Ghi mới từ 0 + debt.amount.
 * - Từ những lần hạch toán sau: Lấy công nợ hiện tại (lần trước) cộng dồn với debt.amount của phiếu hiện tại.
 */
function syncPaymentIncremental(paymentId, contractId, user) {
    var result = {
        success: true,
        paymentId: paymentId,
        contractId: contractId,
        totalVendors: 0,
        details: []
    };

    // Kiểm tra điều kiện trạng thái phiếu thanh toán: approved hoặc accounted
    var payFile = null;
    try {
        payFile = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        if (payFile.doSelect('id="' + escapeSmQueryValue(paymentId) + '"') == RC_SUCCESS) {
            var pStat = String(payFile["status"] || "").trim().toLowerCase();
            var pPhase = String(payFile["current.phase"] || "").trim().toLowerCase();
            if (pStat !== "approved" && pStat !== "accounted" && pPhase !== "approved" && pPhase !== "accounted" && pPhase !== "end") {
                result.success = false;
                result.message = "Phiếu thanh toán " + paymentId + " có trạng thái '" + pStat + "' (chưa approved hoặc accounted), không tính công nợ.";
                return result;
            }
        }
    } catch (ePayCheck) {
    } finally {
        closeSCFile(payFile);
    }

    var pvFile = null;
    var vendorMap = {}; // vendorId -> { debtAmount, amount, refundAmount }
    var vendorList = [];

    try {
        pvFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
        var qPv = 'payment.id="' + escapeSmQueryValue(paymentId) + '"';
        var rcPv = pvFile.doSelect(qPv);

        while (rcPv == RC_SUCCESS) {
            var vId = String(pvFile["vendor.id"] || "").trim();
            if (vId) {
                if (!vendorMap[vId]) {
                    vendorMap[vId] = {
                        vendorId: vId,
                        debtAmount: 0,
                        amount: 0,
                        refundAmount: 0
                    };
                    vendorList.push(vId);
                }
                var dAmt = getNumberField(pvFile, ["debt.amount", "debt_amount"]);
                var pAmt = getNumberField(pvFile, ["amount", "pv.amount"]);
                var rAmt = getNumberField(pvFile, ["refund.amount", "pv.refund.amount"]);

                vendorMap[vId].debtAmount += dAmt;
                vendorMap[vId].amount += pAmt;
                vendorMap[vId].refundAmount += rAmt;
            }
            rcPv = pvFile.getNext();
        }
    } catch (ePv) {
        var errPv = "Lỗi đọc esdHTKTpaymentVendor cho paymentId=" + paymentId + ": " + ePv.toString();
        result.success = false;
        result.message = errPv;
        return result;
    } finally {
        closeSCFile(pvFile);
    }

    if (vendorList.length === 0) {
        var msgNoVendor = "Phiếu " + paymentId + " không có bản ghi NCC nào trong esdHTKTpaymentVendor.";
        result.message = msgNoVendor;
        return result;
    }

    result.totalVendors = vendorList.length;

    // Cập nhật trường amount theo đúng số tiền thực chi từ dòng CORE của payment (type="CORE")
    for (var vi = 0; vi < vendorList.length; vi++) {
        var curVid = vendorList[vi];
        vendorMap[curVid].amount = getPaymentCorePayAmount(paymentId, curVid, vendorMap[curVid].amount);
    }

    for (var i = 0; i < vendorList.length; i++) {
        var vId = vendorList[i];
        var item = vendorMap[vId];
        var vendorInfo = getVendorInfo(vId);

        var checkFile = null;
        try {
            checkFile = new SCFile("esdHTKTreportVendorDebt");
            var qReport = 'contract.id="' + escapeSmQueryValue(contractId) + '" and vendor.id="' + escapeSmQueryValue(vId) + '"';
            var isUpdate = (checkFile.doSelect(qReport) == RC_SUCCESS);

            if (isUpdate) {
                var processedRefList = parseRefIdJsonToList(checkFile["list.ref.id"]);
                if (processedRefList.indexOf(paymentId) !== -1) {
                    // Phiếu này đã được đồng bộ vào công nợ NCC trước đó (tránh cộng trùng khi phiếu có nhiều dòng accounting như trả treo + hoàn ứng kích hoạt nhiều lần)
                    result.details.push({
                        vendorId: vId,
                        action: "SKIP_DUPLICATE",
                        paymentId: paymentId,
                        message: "Phiếu " + paymentId + " đã tồn tại trong list.ref.id, bỏ qua để tránh cộng dồn trùng lặp (case trả treo + hoàn ứng)."
                    });
                    continue;
                }

                var prevPayable = parseAmount(checkFile["total.payable.amount"]);
                var prevPaid = parseAmount(checkFile["total.paid.amount"]);
                var prevAdvance = parseAmount(checkFile["total.advance.amount"]);
                var prevRefund = parseAmount(checkFile["total.refund.amount"]);

                // Lũy kế cho cả 4 trường trong PAYMENT:
                // 1. Công nợ = prevPayable + item.debtAmount
                var newPayable = prevPayable + item.debtAmount;
                // 2. Đã thanh toán = prevPaid + item.amount
                var newPaid = prevPaid + item.amount;
                // 3. Hoàn ứng = prevRefund + item.refundAmount
                var newRefund = prevRefund + item.refundAmount;
                // 4. Tạm ứng = prevAdvance (giữ nguyên tạm ứng đã lũy kế trước đó)
                var newAdvance = prevAdvance;

                checkFile["total.payable.amount"] = String(newPayable);
                checkFile["total.paid.amount"] = String(newPaid);
                checkFile["total.advance.amount"] = String(newAdvance);
                checkFile["total.refund.amount"] = String(newRefund);
                checkFile["list.ref.id"] = appendRefIdToJson(checkFile["list.ref.id"], paymentId);
                checkFile["created.by"] = user;
                checkFile["created.at"] = (system.functions && system.functions.tod) ? system.functions.tod() : new Date();

                var rcUpdate = checkFile.doUpdate();
                if (rcUpdate == RC_SUCCESS || rcUpdate === true) {
                    result.details.push({
                        vendorId: vId,
                        action: "UPDATE",
                        listRefId: checkFile["list.ref.id"],
                        prevPayable: prevPayable,
                        deltaDebt: item.debtAmount,
                        newPayable: newPayable,
                        prevPaid: prevPaid,
                        deltaPaid: item.amount,
                        newPaid: newPaid,
                        prevRefund: prevRefund,
                        deltaRefund: item.refundAmount,
                        newRefund: newRefund,
                        advance: newAdvance
                    });
                }
            } else {
                // Bản ghi mới (INSERT) -> Tính lũy kế từ 0 + delta tương ứng
                var newPayable = 0 + item.debtAmount;
                var newPaid = 0 + item.amount;
                var newRefund = 0 + item.refundAmount;
                var newAdvance = 0;
                var initialListRefId = appendRefIdToJson("", paymentId);

                var newRecord = {
                    "id": "",
                    "contract.id": contractId,
                    "vendor.id": vId,
                    "vendor.number": vendorInfo ? vendorInfo.vendorNumber : "",
                    "vendor.name": vendorInfo ? vendorInfo.vendorName : "",
                    "total.payable.amount": String(newPayable),
                    "total.paid.amount": String(newPaid),
                    "total.advance.amount": String(newAdvance),
                    "total.refund.amount": String(newRefund),
                    "list.ref.id": initialListRefId,
                    "_isIncremental": true,
                    "created.at": (system.functions && system.functions.tod) ? system.functions.tod() : new Date(),
                    "created.by": user
                };

                var saveRes = saveReportVendorDebt(newRecord);
                if (saveRes.success) {
                    result.details.push({
                        vendorId: vId,
                        action: "INSERT",
                        listRefId: initialListRefId,
                        newPayable: newPayable,
                        newPaid: newPaid,
                        newRefund: newRefund,
                        newAdvance: newAdvance
                    });
                }
            }
        } finally {
            closeSCFile(checkFile);
        }
    }

    result.message = "Đã đồng bộ công nợ cho " + result.totalVendors + " NCC của phiếu " + paymentId;
    return result;
}

/**
 * Hỗ trợ kích hoạt sinh bút toán tự động từ ScriptLibrary ESD_HTKT_PREPAYMENT_ENTRY nếu bảng esdHTKTprepaymentEntry chưa có dữ liệu.
 */
function ensurePrepaymentEntriesGenerated(prepaymentId) {
    try {
        if (typeof lib !== "undefined") {
            var entryLib = lib.ESD_HTKT_PREPAYMENT_ENTRY || lib.ESD_HTKT_PREPYAMENT_ENTRY;
            if (entryLib) {
                if (typeof entryLib.syncPrepaymentEntryNowByInputDetails === "function") {
                    entryLib.syncPrepaymentEntryNowByInputDetails({
                        prepaymentId: prepaymentId,
                        vendorId: ""
                    });
                } else if (typeof entryLib.syncPrepaymentEntryBySourceChange === "function") {
                    entryLib.syncPrepaymentEntryBySourceChange("esdHTKTprepayment", { id: prepaymentId });
                }
            }
        }
    } catch (eSync) {
    }
}

/**
 * Lấy số tiền thuế khấu trừ (invoice amount) của phiếu Tạm ứng:
 * Lấy từ các dòng bút toán tự sinh của thuế trong bảng esdHTKTprepaymentEntry được sinh ra từ ScriptLibrary ESD_HTKT_PREPAYMENT_ENTRY.
 * Bảng esdHTKTprepaymentEntry có thể có NHIỀU dòng TU-BT-02 (theo từng NCC, từng loại khấu trừ, từng hóa đơn),
 * hàm sẽ quét toàn bộ bảng và cộng dồn đầy đủ tất cả các dòng TU-BT-02 theo từng nhà cung cấp (vendor.id).
 * Hỗ trợ case nhiều NCC: map chính xác các dòng thuế về từng NCC theo danh sách knownVendorList.
 * @param {string} prepaymentId    - ID phiếu tạm ứng
 * @param {string} primaryVendorId - ID NCC chính để fallback nếu dòng bút toán thiếu vendor.id
 * @param {Array}  knownVendorList - Danh sách NCC đã biết từ prepaymentVendor
 * @returns {Object} map vendorId -> tổng tiền thuế khấu trừ của tất cả dòng TU-BT-02
 */
function getPrepaymentTaxByDeduction(prepaymentId, primaryVendorId, knownVendorList) {
    var taxByVendor = {};
    var vendors = knownVendorList || [];

    // Xây dựng alias map để chuẩn hóa mọi mã NCC (id, vendor.number/MST, supplier.id) về đúng vendor.id trong danh sách
    var aliasMap = {};
    for (var vi = 0; vi < vendors.length; vi++) {
        var vid = String(vendors[vi] || "").trim();
        if (vid) {
            aliasMap[vid.toLowerCase()] = vid;
            var vInfo = getVendorInfo(vid);
            if (vInfo) {
                if (vInfo.id) aliasMap[String(vInfo.id).trim().toLowerCase()] = vid;
                if (vInfo.vendorNumber) aliasMap[String(vInfo.vendorNumber).trim().toLowerCase()] = vid;
                if (vInfo.supplierId) aliasMap[String(vInfo.supplierId).trim().toLowerCase()] = vid;
            }
        }
    }

    function resolveVendorId(candidate) {
        if (!candidate) return "";
        var c = String(candidate).trim().toLowerCase();
        if (aliasMap[c]) return aliasMap[c];
        var info = getVendorInfo(candidate, candidate);
        if (info && info.id) {
            var resolved = String(info.id).trim();
            if (aliasMap[resolved.toLowerCase()]) return aliasMap[resolved.toLowerCase()];
            return resolved;
        }
        return candidate;
    }

    // 1. Quét từ bảng esdHTKTprepaymentEntry (duyệt đầy đủ tất cả các dòng TU-BT-02)
    var entryFile = null;
    var foundTaxInEntry = false;
    var vendorsWithEntryTax = {};
    try {
        entryFile = new SCFile("esdHTKTprepaymentEntry", SCFILE_READONLY);
        var qEntry = 'prepayment.id="' + escapeSmQueryValue(prepaymentId) + '"';
        var rcEntry = entryFile.doSelect(qEntry);

        // Nếu chưa có dòng bút toán nào trong prepaymentEntry, thử gọi ScriptLibrary ESD_HTKT_PREPAYMENT_ENTRY để tự sinh
        if (rcEntry !== RC_SUCCESS) {
            closeSCFile(entryFile);
            ensurePrepaymentEntriesGenerated(prepaymentId);
            entryFile = new SCFile("esdHTKTprepaymentEntry", SCFILE_READONLY);
            rcEntry = entryFile.doSelect(qEntry);
        }

        while (rcEntry == RC_SUCCESS) {
            var rawEntryType = String(entryFile["entry.type"] || entryFile["entry_type"] || entryFile["entry.code"] || entryFile["entry_code"] || entryFile["rule.code"] || entryFile["rule_code"] || "").trim();
            var upperEntryType = rawEntryType.toUpperCase();
            var cleanType = upperEntryType.replace(/[^A-Z0-9]/g, ""); // "TUBT02"

            // Nhận diện đầy đủ các dòng bút toán thuế:
            // - Theo mã entry.type / rule.code: "TU-BT-02", "TU_BT_02", "TU.BT.02", "BT-02", "THUE", "TAX", "VAT"
            var isTaxByCode = (
                    cleanType === "TUBT02" ||
                    cleanType === "TUBT2" ||
                    cleanType === "BT02" ||
                    cleanType === "BT2" ||
                    cleanType === "THUE" ||
                    cleanType === "TAX" ||
                    cleanType === "VAT" ||
                    cleanType.indexOf("TUBT02") !== -1 ||
                    cleanType.indexOf("BT02") !== -1 ||
                    upperEntryType.indexOf("TU-BT-02") !== -1 ||
                    upperEntryType.indexOf("TU_BT_02") !== -1 ||
                    upperEntryType.indexOf("THUE") !== -1 ||
                    upperEntryType.indexOf("THUẾ") !== -1
            );

            // - Theo cấu trúc AP chuẩn: type = "AP" & ledger.type = "Standard" & account.type = "DEBIT"
            var ledgerType = String(entryFile["ledger.type"] || entryFile["ledger_type"] || "").trim().toUpperCase();
            var accountType = String(entryFile["account.type"] || entryFile["account_type"] || "").trim().toUpperCase();
            var rowType = String(entryFile["type"] || "").trim().toUpperCase();
            var isTaxByStructure = (rowType === "AP" && ledgerType === "STANDARD" && (accountType === "DEBIT" || accountType === "NO" || accountType === "NỢ"));

            var isTaxEntry = (isTaxByCode || isTaxByStructure) && rowType !== "GL";

            if (isTaxEntry) {
                var rawVid = String(entryFile["vendor.id"] || entryFile["vendor_id"] || "").trim();
                var vId = resolveVendorId(rawVid);

                if (!vId) {
                    if (vendors.length === 1) {
                        vId = vendors[0];
                    } else if (primaryVendorId) {
                        vId = primaryVendorId;
                    }
                }

                var amt = getNumberField(entryFile, ["amount", "entry.amount"]);
                if (vId && !isNaN(amt) && amt !== 0) {
                    taxByVendor[vId] = (taxByVendor[vId] || 0) + amt;
                    vendorsWithEntryTax[vId] = true;
                    foundTaxInEntry = true;
                }
            }
            rcEntry = entryFile.getNext();
        }
    } catch (eEntry) {
    } finally {
        closeSCFile(entryFile);
    }

    // 2. Dự phòng: Kiểm tra từ esdHTKTprepaymentInvoice nếu có NCC nào chưa có thuế từ prepaymentEntry
    var needsInvoiceCheck = false;
    if (!foundTaxInEntry) {
        needsInvoiceCheck = true;
    } else {
        for (var vi2 = 0; vi2 < vendors.length; vi2++) {
            var checkVid = vendors[vi2];
            if (!taxByVendor[checkVid] || taxByVendor[checkVid] <= 0) {
                needsInvoiceCheck = true;
                break;
            }
        }
    }

    if (needsInvoiceCheck) {
        var prepInvFile = null;
        try {
            prepInvFile = new SCFile("esdHTKTprepaymentInvoice", SCFILE_READONLY);
            var qPrepInv = 'prepayment.id="' + escapeSmQueryValue(prepaymentId) + '"';
            if (prepInvFile.doSelect(qPrepInv) == RC_SUCCESS) {
                do {
                    var dedType = String(prepInvFile["deduction.type"] || "").trim().toUpperCase();
                    // Chỉ lấy thuế theo loại khấu trừ (KHAUTRU_001, KHAUTRU_002; bỏ qua KHAUTRU_003: Không khấu trừ)
                    var isDeductible = (dedType !== "KHAUTRU_003" && dedType.indexOf("KHONG") === -1 && dedType.indexOf("KHÔNG") === -1);
                    if (isDeductible) {
                        var invId = String(prepInvFile["invoice.id"] || "").trim();
                        var invTax = 0;
                        var sellerTaxCode = "";

                        if (invId) {
                            var invFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
                            if (invFile.doSelect('id="' + escapeSmQueryValue(invId) + '"') == RC_SUCCESS) {
                                invTax = getNumberField(invFile, ["total.tax", "totalTax"]);
                                sellerTaxCode = String(invFile["seller.tax.code"] || "").trim();
                            }
                            closeSCFile(invFile);
                        }

                        if (invTax !== 0 && !isNaN(invTax)) {
                            var targetVendorId = "";
                            if (sellerTaxCode) {
                                targetVendorId = resolveVendorId(sellerTaxCode);
                            }
                            if (!targetVendorId) {
                                if (vendors.length === 1) {
                                    targetVendorId = vendors[0];
                                } else if (primaryVendorId) {
                                    targetVendorId = primaryVendorId;
                                }
                            }
                            // Chỉ cộng từ hóa đơn nếu NCC này chưa có thuế từ prepaymentEntry
                            if (targetVendorId && !vendorsWithEntryTax[targetVendorId]) {
                                taxByVendor[targetVendorId] = (taxByVendor[targetVendorId] || 0) + invTax;
                            }
                        }
                    }
                } while (prepInvFile.getNext() == RC_SUCCESS);
            }
        } catch (eInv) {
        } finally {
            closeSCFile(prepInvFile);
        }
    }

    // 3. Dự phòng cấp 3: Nếu vẫn còn NCC chưa có thuế, quét từ esdHTKTaccountingInformation (AP THUE)
    for (var vi3 = 0; vi3 < vendors.length; vi3++) {
        var vCheck = vendors[vi3];
        if (!taxByVendor[vCheck] || taxByVendor[vCheck] <= 0) {
            var aiFile = null;
            try {
                aiFile = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
                var qAi = 'prepayment.id="' + escapeSmQueryValue(prepaymentId) + '" AND type="AP" AND sub.type="THUE"';
                if (vCheck) {
                    qAi += ' AND vendor.id="' + escapeSmQueryValue(vCheck) + '"';
                }
                if (aiFile.doSelect(qAi) == RC_SUCCESS) {
                    do {
                        var amtAi = getNumberField(aiFile, ["amount", "ai.amount"]);
                        if (amtAi !== 0 && !isNaN(amtAi)) {
                            taxByVendor[vCheck] = (taxByVendor[vCheck] || 0) + amtAi;
                        }
                    } while (aiFile.getNext() == RC_SUCCESS);
                }
            } catch (eAi) {
            } finally {
                closeSCFile(aiFile);
            }
        }
    }

    return taxByVendor;
}

/**
 * Xử lý tính tổng lũy kế cả 4 giá trị cho phiếu PREPAYMENT (Tạm ứng):
 * - Hỗ trợ case nhiều NCC: gom nhóm theo từng NCC từ esdHTKTprepaymentVendor.
 * - Công nợ (total.payable.amount) = prevPayable + tất cả thuế của tạm ứng (deltaTax).
 * - Đã thanh toán (total.paid.amount) = prevPaid + tất cả thuế của tạm ứng (deltaTax).
 * - Tạm ứng (total.advance.amount) = prevAdvance + số tiền tạm ứng của phiếu hiện tại (deltaAdvance).
 * - Hoàn ứng (total.refund.amount) = prevRefund (giữ nguyên hoàn ứng đã lũy kế).
 * - Nếu là bản ghi mới (INSERT): tính lũy kế từ 0 + delta tương ứng.
 */
function syncPrepaymentIncremental(prepaymentId, contractId, user) {
    var result = {
        success: true,
        prepaymentId: prepaymentId,
        contractId: contractId,
        totalVendors: 0,
        details: []
    };

    // Kiểm tra điều kiện trạng thái phiếu tạm ứng: approved hoặc accounted
    var prepCheck = null;
    try {
        prepCheck = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        if (prepCheck.doSelect('id="' + escapeSmQueryValue(prepaymentId) + '"') == RC_SUCCESS) {
            var prStat = String(prepCheck["status"] || "").trim().toLowerCase();
            var prPhase = String(prepCheck["current.phase"] || "").trim().toLowerCase();
            if (prStat !== "approved" && prStat !== "accounted" && prPhase !== "approved" && prPhase !== "accounted" && prPhase !== "end") {
                result.success = false;
                result.message = "Phiếu tạm ứng " + prepaymentId + " có trạng thái '" + prStat + "' (chưa approved hoặc accounted), không tính công nợ.";
                return result;
            }
        }
    } catch (ePrepCheck) {
    } finally {
        closeSCFile(prepCheck);
    }

    var prepvFile = null;
    var advanceByVendor = {};
    var vendorList = [];
    var primaryVendorId = "";

    try {
        prepvFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
        var qPrepv = 'prepayment.id="' + escapeSmQueryValue(prepaymentId) + '"';
        var rcPrepv = prepvFile.doSelect(qPrepv);

        while (rcPrepv == RC_SUCCESS) {
            var vId = String(prepvFile["vendor.id"] || "").trim();
            if (vId) {
                if (!primaryVendorId) primaryVendorId = vId;
                if (!advanceByVendor[vId]) {
                    advanceByVendor[vId] = 0;
                    vendorList.push(vId);
                }
                var aAmt = getNumberField(prepvFile, ["amount", "pv.amount"]);
                advanceByVendor[vId] += aAmt;
            }
            rcPrepv = prepvFile.getNext();
        }
    } catch (ePrepv) {
        var errPrepv = "Lỗi đọc esdHTKTprepaymentVendor cho prepaymentId=" + prepaymentId + ": " + ePrepv.toString();
        result.success = false;
        result.message = errPrepv;
        return result;
    } finally {
        closeSCFile(prepvFile);
    }

    // Dự phòng: nếu không tìm thấy bản ghi nào trong esdHTKTprepaymentVendor, thử lấy từ esdHTKTprepayment
    if (vendorList.length === 0) {
        var prepFile = null;
        try {
            prepFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
            if (prepFile.doSelect('id="' + escapeSmQueryValue(prepaymentId) + '"') == RC_SUCCESS) {
                var pVendorId = String(prepFile["vendor.id"] || prepFile["supplier.id"] || "").trim();
                var pAmt = getNumberField(prepFile, ["amount", "advance.amount", "total.amount"]);
                if (pVendorId) {
                    primaryVendorId = pVendorId;
                    vendorList.push(pVendorId);
                    advanceByVendor[pVendorId] = pAmt;
                }
            }
        } catch (eP) {
        } finally {
            closeSCFile(prepFile);
        }
    }

    // Lấy thuế AP Invoice tạm ứng theo loại khấu trừ cho từng NCC
    var taxByVendor = getPrepaymentTaxByDeduction(prepaymentId, primaryVendorId, vendorList);

    // Hợp nhất danh sách vendor (nếu có NCC nào phát sinh thuế mà chưa có trong vendorList)
    for (var tVend in taxByVendor) {
        if (taxByVendor.hasOwnProperty(tVend) && vendorList.indexOf(tVend) === -1) {
            vendorList.push(tVend);
        }
    }

    if (vendorList.length === 0) {
        var msgNoVendor = "Phiếu tạm ứng " + prepaymentId + " không tìm thấy thông tin NCC.";
        result.message = msgNoVendor;
        return result;
    }

    result.totalVendors = vendorList.length;

    for (var i = 0; i < vendorList.length; i++) {
        var vId = vendorList[i];
        var deltaTax = Number(taxByVendor[vId] || 0);
        var deltaAdvanceRaw = Number(advanceByVendor[vId] || 0);
        // Tạm ứng = Tạm ứng trừ thuế của phiếu tạm ứng (TU-BT-01 = vendorAmount - taxAmount)
        var deltaAdvance = Math.max(0, deltaAdvanceRaw - deltaTax);
        var vendorInfo = getVendorInfo(vId);

        var checkFile = null;
        try {
            checkFile = new SCFile("esdHTKTreportVendorDebt");
            var qReport = 'contract.id="' + escapeSmQueryValue(contractId) + '" and vendor.id="' + escapeSmQueryValue(vId) + '"';
            var isUpdate = (checkFile.doSelect(qReport) == RC_SUCCESS);

            if (isUpdate) {
                var processedPrepList = parseRefIdJsonToList(checkFile["list.ref.id"]);
                if (processedPrepList.indexOf(prepaymentId) !== -1) {
                    // Phiếu tạm ứng này đã được đồng bộ vào công nợ NCC trước đó
                    result.details.push({
                        vendorId: vId,
                        action: "SKIP_DUPLICATE",
                        prepaymentId: prepaymentId,
                        message: "Phiếu tạm ứng " + prepaymentId + " đã tồn tại trong list.ref.id, bỏ qua để tránh cộng dồn trùng lặp."
                    });
                    continue;
                }

                var prevPayable = parseAmount(checkFile["total.payable.amount"]);
                var prevPaid = parseAmount(checkFile["total.paid.amount"]);
                var prevAdvance = parseAmount(checkFile["total.advance.amount"]);
                var prevRefund = parseAmount(checkFile["total.refund.amount"]);

                // LŨY KẾ CẢ 4 GIÁ TRỊ THEO ĐÚNG YÊU CẦU:
                // 1. Công nợ = prevPayable + ap invoice (thuế tạm ứng deltaTax)
                var newPayable = prevPayable + deltaTax;
                // 2. Đã thanh toán = prevPaid + giá trị thuế theo hóa đơn (deltaTax có xét loại khấu trừ)
                var newPaid = prevPaid + deltaTax;
                // 3. Tạm ứng = prevAdvance + Tạm ứng trừ thuế (deltaAdvanceRaw - deltaTax)
                var newAdvance = prevAdvance + deltaAdvance;
                // 4. Hoàn ứng = prevRefund (hoàn ứng của tất cả các phiếu thanh toán, giữ nguyên trong tạm ứng)
                var newRefund = prevRefund;

                checkFile["total.payable.amount"] = String(newPayable);
                checkFile["total.paid.amount"] = String(newPaid);
                checkFile["total.advance.amount"] = String(newAdvance);
                checkFile["total.refund.amount"] = String(newRefund);
                checkFile["list.ref.id"] = appendRefIdToJson(checkFile["list.ref.id"], prepaymentId);
                checkFile["created.by"] = user;
                checkFile["created.at"] = (system.functions && system.functions.tod) ? system.functions.tod() : new Date();

                var rcUpdate = checkFile.doUpdate();
                if (rcUpdate == RC_SUCCESS || rcUpdate === true) {
                    result.details.push({
                        vendorId: vId,
                        action: "UPDATE",
                        listRefId: checkFile["list.ref.id"],
                        prevPayable: prevPayable,
                        deltaTax: deltaTax,
                        newPayable: newPayable,
                        prevPaid: prevPaid,
                        newPaid: newPaid,
                        prevAdvance: prevAdvance,
                        deltaAdvanceRaw: deltaAdvanceRaw,
                        deltaAdvanceNet: deltaAdvance,
                        newAdvance: newAdvance,
                        refund: newRefund
                    });
                }
            } else {
                // Bản ghi mới (INSERT) -> Tính lũy kế từ 0 + delta tương ứng
                var newPayable = 0 + deltaTax;
                var newPaid = 0 + deltaTax;
                var newAdvance = 0 + deltaAdvance;
                var newRefund = 0;
                var initialListRefId = appendRefIdToJson("", prepaymentId);

                var newRecord = {
                    "id": "",
                    "contract.id": contractId,
                    "vendor.id": vId,
                    "vendor.number": vendorInfo ? vendorInfo.vendorNumber : "",
                    "vendor.name": vendorInfo ? vendorInfo.vendorName : "",
                    "total.payable.amount": String(newPayable),
                    "total.paid.amount": String(newPaid),
                    "total.advance.amount": String(newAdvance),
                    "total.refund.amount": String(newRefund),
                    "list.ref.id": initialListRefId,
                    "_isIncremental": true,
                    "created.at": (system.functions && system.functions.tod) ? system.functions.tod() : new Date(),
                    "created.by": user
                };

                var saveRes = saveReportVendorDebt(newRecord);
                if (saveRes.success) {
                    result.details.push({
                        vendorId: vId,
                        action: "INSERT",
                        listRefId: initialListRefId,
                        newPayable: newPayable,
                        deltaTax: deltaTax,
                        newPaid: newPaid,
                        deltaAdvanceRaw: deltaAdvanceRaw,
                        deltaAdvanceNet: deltaAdvance,
                        newAdvance: newAdvance,
                        newRefund: newRefund
                    });
                }
            }
        } finally {
            closeSCFile(checkFile);
        }
    }

    result.message = "Đã đồng bộ công nợ cho " + result.totalVendors + " NCC của phiếu tạm ứng " + prepaymentId;
    return result;
}

function syncVendorDebtReport(filterContractId, filterVendorId, operatorName) {
    filterContractId = String(filterContractId || "").trim();
    filterVendorId = String(filterVendorId || "").trim();
    var user = operatorName || "SYSTEM";

    var syncResults = {
        success: false,
        totalProcessed: 0,
        totalSuccess: 0,
        totalFailed: 0,
        details: []
    };

    // Chặn đổ dữ liệu nếu truyền contractId rỗng
    if (!filterContractId) {
        syncResults.message = "Thiếu contractId, bỏ qua không đổ dữ liệu.";
        return syncResults;
    }

    syncResults.success = true;

    // 1. LẤY DANH SÁCH CẶP (HỢP ĐỒNG - NHÀ CUNG CẤP)
    var pairList = getContractVendorPairs(filterContractId, filterVendorId);

    if (!pairList || pairList.length === 0) {
        syncResults.message = "Không tìm thấy hợp đồng hoặc nhà cung cấp nào để tổng hợp báo cáo.";
        return syncResults;
    }

    var processedContractVendors = {};

    // 2. DUYỆT TỪNG CẶP (CONTRACT - VENDOR) ĐỂ TÍNH TOÁN VÀ ĐỔ TRỰC TIẾP VÀO DB
    for (var i = 0; i < pairList.length; i++) {
        var pair = pairList[i];
        var contractId = pair.contractId;
        var vendorId = pair.vendorId;
        var supplierId = pair.supplierId; // MST / Mã supplier trong hợp đồng

        try {
            // 2.1. Đọc thông tin NCC (esdHTKTvendor)
            var vendorInfo = getVendorInfo(vendorId, supplierId);
            if (!vendorInfo) {
                syncResults.totalProcessed++;
                syncResults.totalFailed++;
                var errVendorMsg = "Không tìm thấy NCC trong esdHTKTvendor: " + (vendorId || supplierId);
                syncResults.details.push({
                    contractId: contractId,
                    vendorId: vendorId,
                    success: false,
                    message: errVendorMsg
                });
                continue;
            }

            // Cập nhật lại vendorId chuẩn từ esdHTKTvendor nếu trước đó chỉ có supplierId
            vendorId = vendorInfo.id;

            // Tránh xử lý trùng cặp (contract.id, vendor.id) sau khi đã resolve vendorId chuẩn
            var resolvedKey = contractId + "|" + vendorId;
            if (processedContractVendors[resolvedKey]) {
                continue;
            }
            processedContractVendors[resolvedKey] = true;
            syncResults.totalProcessed++;

            // 2.2. Tính toán các chỉ số tài chính NCC theo logic tab Công nợ & Full code SM
            var debtSummary = calculateVendorDebtMetrics(contractId, vendorId, vendorInfo.supplierId || supplierId);

            // 2.3. Đóng gói dữ liệu bản ghi báo cáo theo đúng 12 trường của bảng esdHTKTreportVendorDebt
            var reportRecord = {
                "id": "",                                                              // 1. ID - VARCHAR(60) (Tự tăng khi INSERT)
                "contract.id": contractId,                                             // 2. CONTRACT_ID - VARCHAR(60)
                "vendor.id": vendorId,                                                 // 3. VENDOR_ID - VARCHAR(60)
                "vendor.number": vendorInfo.vendorNumber,                              // 4. VENDOR_NUMBER - VARCHAR(60)
                "vendor.name": vendorInfo.vendorName,                                  // 5. VENDOR_NAME - VARCHAR(500)
                "total.payable.amount": String(debtSummary.totalPayableAmount || "0"), // 6. TOTAL_PAYABLE_AMOUNT - VARCHAR(100)
                "total.advance.amount": String(debtSummary.totalAdvanceAmount || "0"), // 7. TOTAL_ADVANCE_AMOUNT - VARCHAR(100)
                "total.refund.amount": String(debtSummary.totalRefundAmount || "0"),   // 8. TOTAL_REFUND_AMOUNT - VARCHAR(100)
                "total.paid.amount": String(debtSummary.totalPaidAmount || "0"),       // 9. TOTAL_PAID_AMOUNT - VARCHAR(100)
                "list.ref.id": JSON.stringify(debtSummary.refIds || []),               // 10. LIST_REF_ID - VARCHAR / TEXT (JSON array)
                "created.at": (system.functions && system.functions.tod) ? system.functions.tod() : new Date(), // 11. CREATED_AT - TIMESTAMP
                "created.by": user                                                     // 12. CREATE_BY - VARCHAR(200)
            };

            // 2.4. Lưu hoặc cập nhật trực tiếp vào bảng esdHTKTreportVendorDebt
            var saveStatus = saveReportVendorDebt(reportRecord);
            if (saveStatus.success) {
                reportRecord.id = saveStatus.id || "";
                syncResults.totalSuccess++;
                syncResults.details.push({
                    id: reportRecord.id,
                    contractId: contractId,
                    vendorId: vendorId,
                    vendorNumber: vendorInfo.vendorNumber,
                    success: true,
                    action: saveStatus.action,
                    data: reportRecord
                });
            } else {
                syncResults.totalFailed++;
                syncResults.details.push({
                    id: reportRecord.id,
                    contractId: contractId,
                    vendorId: vendorId,
                    success: false,
                    message: saveStatus.message
                });
            }

        } catch (eItem) {
            syncResults.totalFailed++;
            var exMsg = "Lỗi xử lý cặp (" + contractId + ", " + vendorId + "): " + eItem.toString();
            syncResults.details.push({
                contractId: contractId,
                vendorId: vendorId,
                success: false,
                message: exMsg
            });
        }
    }

    syncResults.message = "Đã xử lý: " + syncResults.totalProcessed + " | Thành công: " + syncResults.totalSuccess + " | Thất bại: " + syncResults.totalFailed;

    return syncResults;
}

/**
 * 1. Lấy danh sách cặp (contractId, vendorId) cần xử lý (bắt buộc có filterContractId)
 */
function getContractVendorPairs(filterContractId, filterVendorId) {
    var pairs = [];
    var mapUnique = {};

    filterContractId = String(filterContractId || "").trim();
    filterVendorId = String(filterVendorId || "").trim();
    if (!filterContractId) {
        return pairs;
    }

    // Trường hợp 1: Có cả contractId và vendorId cụ thể
    if (filterContractId && filterVendorId) {
        pairs.push({
            contractId: filterContractId,
            vendorId: filterVendorId,
            supplierId: ""
        });
        return pairs;
    }

    // Trường hợp 2: Quét từ esdHDcontractSupplier theo contract.id
    var supplierFile = null;
    try {
        supplierFile = new SCFile("esdHDcontractSupplier", SCFILE_READONLY);
        var query = 'contract.id="' + escapeSmQueryValue(filterContractId) + '"';

        var rc = supplierFile.doSelect(query);
        while (rc == RC_SUCCESS) {
            var cId = String(supplierFile["contract.id"] || "").trim();
            var sId = String(supplierFile["supplier.id"] || "").trim();

            if (cId && sId) {
                var key = cId + "|SUP|" + sId;
                if (!mapUnique[key]) {
                    mapUnique[key] = true;
                    pairs.push({
                        contractId: cId,
                        vendorId: "",       // Sẽ resolve qua esdHTKTvendor
                        supplierId: sId
                    });
                }
            }
            rc = supplierFile.getNext();
        }
    } catch (eSupp) {
    } finally {
        closeSCFile(supplierFile);
    }

    // Bổ sung: Quét thêm từ esdHTKTpaymentVendor (các hợp đồng đã có phiếu ĐNTT approved hoặc accounted)
    var pvFile = null;
    try {
        pvFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
        var qPv = 'select p.contract.id as contract_id, pv.vendor.id as vendor_id from esdHTKTpaymentVendor pv ' +
                'join esdHTKTpayment p on (pv.payment.id = p.id) ' +
                'where (p.status = "approved" or p.status = "accounted") and p.contract.id = "' + escapeSmQueryValue(filterContractId) + '"';
        if (filterVendorId) {
            qPv += ' and pv.vendor.id = "' + escapeSmQueryValue(filterVendorId) + '"';
        }

        if (pvFile.doSelect(qPv) == RC_SUCCESS) {
            do {
                var pvContractId = String(pvFile["contract_id"] || filterContractId).trim();
                var vId = String(pvFile["vendor_id"] || "").trim();
                var pvKey = pvContractId + "|VEN|" + vId;
                if (pvContractId && vId && !mapUnique[pvKey]) {
                    mapUnique[pvKey] = true;
                    pairs.push({
                        contractId: pvContractId,
                        vendorId: vId,
                        supplierId: ""
                    });
                }
            } while (pvFile.getNext() == RC_SUCCESS);
        }
    } catch (ePv) {
    } finally {
        closeSCFile(pvFile);
    }

    // Bổ sung: Quét thêm từ esdHTKTprepaymentVendor (các hợp đồng đã có phiếu ĐNTƯ approved hoặc accounted)
    var prepvFile = null;
    try {
        prepvFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
        var qPrepv = 'select prep.contract.id as contract_id, pv.vendor.id as vendor_id from esdHTKTprepaymentVendor pv ' +
                'join esdHTKTprepayment prep on (pv.prepayment.id = prep.id) ' +
                'where (prep.status = "approved" or prep.status = "accounted") and prep.contract.id = "' + escapeSmQueryValue(filterContractId) + '"';
        if (filterVendorId) {
            qPrepv += ' and pv.vendor.id = "' + escapeSmQueryValue(filterVendorId) + '"';
        }

        if (prepvFile.doSelect(qPrepv) == RC_SUCCESS) {
            do {
                var prepvContractId = String(prepvFile["contract_id"] || filterContractId).trim();
                var vPrepId = String(prepvFile["vendor_id"] || "").trim();
                var prepvKey = prepvContractId + "|VEN|" + vPrepId;
                if (prepvContractId && vPrepId && !mapUnique[prepvKey]) {
                    mapUnique[prepvKey] = true;
                    pairs.push({
                        contractId: prepvContractId,
                        vendorId: vPrepId,
                        supplierId: ""
                    });
                }
            } while (prepvFile.getNext() == RC_SUCCESS);
        }
    } catch (ePrepv) {
    } finally {
        closeSCFile(prepvFile);
    }

    // Bổ sung: Quét thêm từ esdHTKTaccountingInformation (các hợp đồng có bút toán AP)
    var aiFile = null;
    try {
        aiFile = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
        var qAi = 'contract.id="' + escapeSmQueryValue(filterContractId) + '" AND type="AP"';
        if (filterVendorId) {
            qAi += ' AND vendor.id="' + escapeSmQueryValue(filterVendorId) + '"';
        }
        if (aiFile.doSelect(qAi) == RC_SUCCESS) {
            do {
                var aiContractId = String(aiFile["contract.id"] || filterContractId).trim();
                var vAiId = String(aiFile["vendor.id"] || "").trim();
                var aiKey = aiContractId + "|VEN|" + vAiId;
                if (aiContractId && vAiId && !mapUnique[aiKey]) {
                    mapUnique[aiKey] = true;
                    pairs.push({
                        contractId: aiContractId,
                        vendorId: vAiId,
                        supplierId: ""
                    });
                }
            } while (aiFile.getNext() == RC_SUCCESS);
        }
    } catch (eAi) {
    } finally {
        closeSCFile(aiFile);
    }

    return pairs;
}

/**
 * 2.1. Đọc thông tin NCC từ esdHTKTvendor
 * Map vendor.number (MST) & vendor.name
 */
function getVendorInfo(vendorId, supplierId) {
    var file = null;
    try {
        file = new SCFile("esdHTKTvendor", SCFILE_READONLY);
        var query = "";

        if (vendorId) {
            query = 'id="' + escapeSmQueryValue(vendorId) + '"';
        } else if (supplierId) {
            // supplier.id trong HĐ khớp với vendor.number (MST) hoặc supplier.id trong esdHTKTvendor
            query = 'vendor.number="' + escapeSmQueryValue(supplierId) + '" or supplier.id="' + escapeSmQueryValue(supplierId) + '"';
        }

        if (!query || file.doSelect(query) != RC_SUCCESS) {
            return null;
        }

        return {
            id: String(file["id"] || "").trim(),
            vendorNumber: String(file["vendor.number"] || "").trim(),
            vendorName: String(file["vendor.name"] || "").trim(),
            supplierId: String(file["supplier.id"] || "").trim(),
            vendorType: String(file["vendor.type"] || "").trim()
        };
    } finally {
        closeSCFile(file);
    }
}

/**
 * 2.3. TÍNH TOÁN 4 CHỈ SỐ CÔNG NỢ / TÀI CHÍNH CẤP NCC
 * Khớp hoàn toàn với:
 * - ESD_HTKT_PAYMENT_SUPPLIER_LEDGER_LIST.js (hàm getSupplierDebtSummary)
 * - ESD_HTKT_PAYMENT_VENDOR.js (hàm sumVendorAmount)
 */
function calculateVendorDebtMetrics(contractId, vendorId, supplierId) {
    var metrics = {
        totalPayableAmount: 0,  // Số công nợ phải trả NCC (Nợ 331 còn lại)
        totalAdvanceAmount: 0,  // Số tiền đã tạm ứng cho NCC (Không tính thuế)
        totalRefundAmount: 0,   // Số tiền hoàn ứng từ NCC
        totalPaidAmount: 0,     // Số tiền đã thanh toán thực tế cho NCC
        refIds: []              // Danh sách các mã phiếu/bản ghi tham chiếu
    };

    var allRefIds = [];
    var seenRefIds = {};
    function addRefId(id) {
        id = String(id || "").trim();
        if (id && !seenRefIds[id]) {
            seenRefIds[id] = true;
            allRefIds.push(id);
        }
    }

    // -------------------------------------------------------------------------
    // A. TÍNH CÁC KHOẢN TẠM ỨNG (Trường: total.advance.amount)
    // Lấy theo các khoản TAM_UNG (phiếu ĐNTƯ approved/accounted)
    // -------------------------------------------------------------------------
    var totalAdvanceBase = 0; // Tiền tạm ứng trước thuế (sub.type = "TAM_UNG")
    var queryTamUng =
            "SELECT " +
            "ai.request.id AS requestId, " +
            "ai.prepayment.id AS prepaymentId, " +
            "ai.amount AS advance_amount " +
            "FROM esdHTKTaccountingInformation ai " +
            "JOIN esdHTKTprepayment prep " +
            'ON (ai.prepayment.id = prep.id AND (prep.status = "approved" OR prep.status = "accounted")) ' +
            'WHERE ai.sub.type = "TAM_UNG" ' +
            'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
            'AND (ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '"' + (supplierId && supplierId !== vendorId ? ' OR ai.vendor.id = "' + escapeSmQueryValue(supplierId) + '"' : '') + ') ' +
            'AND ai.type = "AP"';

    var processedAiReqIds = {};
    var processedPrepIds = {};
    var fileTamUng = null;

    try {
        fileTamUng = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
        var rcTu = fileTamUng.doSelect(queryTamUng);
        while (rcTu == RC_SUCCESS) {
            var tuReqId = String(fileTamUng["requestId"] || "").trim();
            var tuPreId = String(fileTamUng["prepaymentId"] || "").trim();
            if (tuPreId) {
                addRefId(tuPreId);
                processedPrepIds[tuPreId] = true;
            }
            if (tuReqId && !processedAiReqIds[tuReqId]) {
                processedAiReqIds[tuReqId] = true;
                totalAdvanceBase += getNumberField(fileTamUng, ["advance_amount", "ai.amount", "amount"]);
            }
            rcTu = fileTamUng.getNext();
        }
    } catch (eTu) {
    } finally {
        closeSCFile(fileTamUng);
    }

    // Bổ sung: Quét các phiếu ĐNTƯ approved hoặc accounted chưa có trong esdHTKTaccountingInformation
    var prepvFile = null;
    try {
        prepvFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
        var qPvTu = 'SELECT pv.prepayment.id AS prepayment_id, pv.amount AS amount ' +
                'FROM esdHTKTprepaymentVendor pv ' +
                'JOIN esdHTKTprepayment prep ON (pv.prepayment.id = prep.id) ' +
                'WHERE prep.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
                'AND (pv.vendor.id = "' + escapeSmQueryValue(vendorId) + '"' +
                (supplierId && supplierId !== vendorId ? ' OR pv.vendor.id = "' + escapeSmQueryValue(supplierId) + '"' : '') + ') ' +
                'AND (prep.status = "approved" OR prep.status = "accounted")';

        if (prepvFile.doSelect(qPvTu) == RC_SUCCESS) {
            do {
                var pId = String(prepvFile["prepayment_id"] || "").trim();
                if (pId && !processedPrepIds[pId]) {
                    processedPrepIds[pId] = true;
                    addRefId(pId);
                    var pAmt = getNumberField(prepvFile, ["amount", "pv.amount"]);
                    totalAdvanceBase += pAmt;
                }
            } while (prepvFile.getNext() == RC_SUCCESS);
        }
    } catch (ePrepv) {
    } finally {
        closeSCFile(prepvFile);
    }

    // -------------------------------------------------------------------------
    // B. TÍNH CÁC KHOẢN HOÀN ỨNG TỪ NCC (Trường: total.refund.amount)
    // Lấy theo trường refund.amount của các phiếu ĐNTT (phiếu approved/accounted).
    // Quét trực tiếp từ bảng esdHTKTpaymentVendor theo từng (payment.id, vendor.id)
    // để đảm bảo mỗi phiếu chỉ tính 1 lần duy nhất, tuyệt đối không bị nhân bản
    // khi phiếu thanh toán có nhiều dòng accounting (trả treo + hoàn ứng...).
    // -------------------------------------------------------------------------
    var totalRefundFromPayVendor = 0;
    var fileRefundPay = null;
    var seenRefundPvIds = {};
    try {
        fileRefundPay = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
        var queryRefund =
                'SELECT pv.id AS id, pv.payment.id AS payment_id, pv.refund.amount AS refund_amount ' +
                'FROM esdHTKTpaymentVendor pv ' +
                'JOIN esdHTKTpayment p ON (pv.payment.id = p.id) ' +
                'WHERE p.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
                'AND (pv.vendor.id = "' + escapeSmQueryValue(vendorId) + '"' +
                (supplierId && supplierId !== vendorId ? ' OR pv.vendor.id = "' + escapeSmQueryValue(supplierId) + '"' : '') + ') ' +
                'AND (p.status = "approved" OR p.status = "accounted")';

        var rcRefund = fileRefundPay.doSelect(queryRefund);
        while (rcRefund == RC_SUCCESS) {
            var rRowId = String(fileRefundPay["id"] || (fileRefundPay["payment_id"] + "_" + vendorId)).trim();
            if (!seenRefundPvIds[rRowId]) {
                seenRefundPvIds[rRowId] = true;
                var rAmt = getNumberField(fileRefundPay, ["refund_amount", "refund.amount"]);
                totalRefundFromPayVendor += rAmt;
                var rPayId = String(fileRefundPay["payment_id"] || "").trim();
                if (rPayId && rAmt > 0) addRefId(rPayId);
            }
            rcRefund = fileRefundPay.getNext();
        }
    } catch (eRefund) {
    } finally {
        closeSCFile(fileRefundPay);
    }

    // Dự phòng: nếu không tìm thấy hoàn ứng trong esdHTKTpaymentVendor, quét từ esdHTKTpaymentEntry (loại bỏ trùng lặp theo entry id)
    if (totalRefundFromPayVendor === 0) {
        var peRefundFile = null;
        var seenPeIds = {};
        try {
            peRefundFile = new SCFile("esdHTKTpaymentEntry", SCFILE_READONLY);
            var qPeDirect =
                    'SELECT pe.id AS id, pe.payment.id AS payment_id, pe.amount AS amount ' +
                    'FROM esdHTKTpaymentEntry pe ' +
                    'JOIN esdHTKTpayment p ON (pe.payment.id = p.id) ' +
                    'WHERE p.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
                    'AND (pe.vendor.id = "' + escapeSmQueryValue(vendorId) + '"' +
                    (supplierId && supplierId !== vendorId ? ' OR pe.vendor.id = "' + escapeSmQueryValue(supplierId) + '"' : '') + ') ' +
                    'AND pe.entry.type = "PREPAYMENT" ' +
                    'AND (p.status = "approved" OR p.status = "accounted")';
            if (peRefundFile.doSelect(qPeDirect) == RC_SUCCESS) {
                do {
                    var peRowId = String(peRefundFile["id"] || "").trim();
                    if (peRowId && !seenPeIds[peRowId]) {
                        seenPeIds[peRowId] = true;
                        var peAmt = getNumberField(peRefundFile, ["amount", "pe.amount"]);
                        totalRefundFromPayVendor += peAmt;
                        var pePayId = String(peRefundFile["payment_id"] || "").trim();
                        if (pePayId && peAmt > 0) addRefId(pePayId);
                    }
                } while (peRefundFile.getNext() == RC_SUCCESS);
            }
        } catch (ePeD) {
        } finally {
            closeSCFile(peRefundFile);
        }
    }

    metrics.totalRefundAmount = totalRefundFromPayVendor;

    // Tính thuế VAT của tạm ứng (sub.type = "THUE") từ các phiếu ĐNTƯ đã phê duyệt hoặc đã hạch toán
    var totalAdvanceTax = 0;
    var queryThue =
            "SELECT ai.amount AS advance_amount, ai.prepayment.id AS prepaymentId FROM esdHTKTaccountingInformation ai " +
            "JOIN esdHTKTprepayment prep ON (ai.prepayment.id = prep.id AND (prep.status = \"approved\" OR prep.status = \"accounted\")) " +
            'WHERE ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
            'AND (ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '"' + (supplierId && supplierId !== vendorId ? ' OR ai.vendor.id = "' + escapeSmQueryValue(supplierId) + '"' : '') + ') ' +
            'AND ai.sub.type = "THUE" ' +
            'AND ai.type = "AP"';
    var fileThue = null;
    try {
        fileThue = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
        var rcThue = fileThue.doSelect(queryThue);
        while (rcThue == RC_SUCCESS) {
            totalAdvanceTax += getNumberField(fileThue, ["advance_amount", "amount", "ai.amount"]);
            var thuePreId = String(fileThue["prepaymentId"] || fileThue["prepayment_id"] || "").trim();
            if (thuePreId) addRefId(thuePreId);
            rcThue = fileThue.getNext();
        }
    } catch (eThue) {
    } finally {
        closeSCFile(fileThue);
    }

    // -------------------------------------------------------------------------
    // Gán Số tiền đã tạm ứng: TẠM ỨNG KHÔNG TÍNH THUẾ (sub.type = "TAM_UNG")
    // -------------------------------------------------------------------------
    metrics.totalAdvanceAmount = totalAdvanceBase;

    // -------------------------------------------------------------------------
    // B. TÍNH CÔNG NỢ PHẢI TRẢ NCC (Trường: total.payable.amount)
    // Yêu cầu: Lấy từ trường debt.amount bảng paymentVendor (esdHTKTpaymentVendor)
    // Lấy các phiếu ĐNTT có trạng thái "approved" hoặc "accounted"
    // -------------------------------------------------------------------------
    var totalDebtFromPayVendor = 0;
    var fileDebtPay = null;
    var seenDebtPvIds = {};
    try {
        fileDebtPay = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
        var queryDebt =
                'SELECT pv.id AS id, pv.payment.id AS payment_id, pv.debt.amount AS debt_amount ' +
                'FROM esdHTKTpaymentVendor pv ' +
                'JOIN esdHTKTpayment p ON (pv.payment.id = p.id) ' +
                'WHERE p.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
                'AND (pv.vendor.id = "' + escapeSmQueryValue(vendorId) + '"' +
                (supplierId && supplierId !== vendorId ? ' OR pv.vendor.id = "' + escapeSmQueryValue(supplierId) + '"' : '') + ') ' +
                'AND (p.status = "approved" OR p.status = "accounted")';

        var rcDebt = fileDebtPay.doSelect(queryDebt);
        while (rcDebt == RC_SUCCESS) {
            var dRowId = String(fileDebtPay["id"] || (fileDebtPay["payment_id"] + "_" + vendorId)).trim();
            if (!seenDebtPvIds[dRowId]) {
                seenDebtPvIds[dRowId] = true;
                totalDebtFromPayVendor += getNumberField(fileDebtPay, ["debt_amount", "debt.amount"]);
                var dPayId = String(fileDebtPay["payment_id"] || "").trim();
                if (dPayId) addRefId(dPayId);
            }
            rcDebt = fileDebtPay.getNext();
        }
    } catch (eDebt) {
    } finally {
        closeSCFile(fileDebtPay);
    }

    // -------------------------------------------------------------------------
    // C. TÍNH TỔNG TIỀN ĐÃ THANH TOÁN THỰC TẾ (Trường: total.paid.amount)
    // = Tổng số tiền thuế trong ĐNTƯ (totalAdvanceTax) + Số tiền thanh toán dòng CORE của các phiếu ĐNTT (type="CORE")
    // -------------------------------------------------------------------------
    var totalCorePayment = 0;
    var processedPaymentIds = {};
    var fileCorePay = null;

    var queryCorePay =
            "SELECT " +
            "ai.request.id AS requestId, " +
            "ai.prepayment.id AS paymentId, " +
            "ai.amount AS core_amount " +
            "FROM esdHTKTaccountingInformation ai " +
            "JOIN esdHTKTpayment payment " +
            'ON (ai.prepayment.id = payment.id AND (payment.status = "approved" OR payment.status = "accounted")) ' +
            'WHERE ai.type = "CORE" ' +
            'AND (ai.contract.id = "' + escapeSmQueryValue(contractId) + '" OR payment.contract.id = "' + escapeSmQueryValue(contractId) + '") ' +
            'AND (ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '"' + (supplierId && supplierId !== vendorId ? ' OR ai.vendor.id = "' + escapeSmQueryValue(supplierId) + '"' : '') + ')';

    try {
        fileCorePay = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
        var rcCore = fileCorePay.doSelect(queryCorePay);
        while (rcCore == RC_SUCCESS) {
            var cPayId = String(fileCorePay["paymentId"] || fileCorePay["payment_id"] || "").trim();
            var cAmount = getNumberField(fileCorePay, ["core_amount", "amount", "ai.amount"]);
            totalCorePayment += cAmount;
            if (cPayId) {
                processedPaymentIds[cPayId] = true;
                addRefId(cPayId);
            }
            rcCore = fileCorePay.getNext();
        }
    } catch (eCore) {
    } finally {
        closeSCFile(fileCorePay);
    }

    // Bổ sung dự phòng: Quét các phiếu ĐNTT approved hoặc accounted chưa có trong esdHTKTaccountingInformation (ví dụ thanh toán tiền mặt)
    var payVendorFile = null;
    try {
        payVendorFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
        var qPvPaid = 'SELECT pv.payment.id AS payment_id, pv.amount AS amount ' +
                'FROM esdHTKTpaymentVendor pv ' +
                'JOIN esdHTKTpayment p ON (pv.payment.id = p.id) ' +
                'WHERE p.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
                'AND (pv.vendor.id = "' + escapeSmQueryValue(vendorId) + '"' +
                (supplierId && supplierId !== vendorId ? ' OR pv.vendor.id = "' + escapeSmQueryValue(supplierId) + '"' : '') + ') ' +
                'AND (p.status = "approved" OR p.status = "accounted")';

        if (payVendorFile.doSelect(qPvPaid) == RC_SUCCESS) {
            do {
                var payId = String(payVendorFile["payment_id"] || "").trim();
                if (payId && !processedPaymentIds[payId]) {
                    processedPaymentIds[payId] = true;
                    addRefId(payId);
                    totalCorePayment += getNumberField(payVendorFile, ["amount", "pv.amount"]);
                }
            } while (payVendorFile.getNext() == RC_SUCCESS);
        }
    } catch (ePayV) {
    } finally {
        closeSCFile(payVendorFile);
    }

    // Gán "Số công nợ phải trả NCC":
    // = Tổng hóa đơn từ ĐNTT (totalDebtFromPayVendor) + Tổng thuế AP invoice từ ĐNTƯ (totalAdvanceTax)
    metrics.totalPayableAmount = totalDebtFromPayVendor + totalAdvanceTax;

    // Tổng tiền đã thanh toán = Tổng thuế của ĐNTƯ + Số tiền thanh toán dòng CORE từ phiếu ĐNTT
    metrics.totalPaidAmount = totalAdvanceTax + totalCorePayment;
    metrics.totalPaidCompletedFromAi = totalCorePayment;
    metrics.totalCorePayment = totalCorePayment;
    metrics.totalAdvanceTax = totalAdvanceTax;
    metrics.totalAdvanceBase = totalAdvanceBase;
    metrics.processedPrepIds = processedPrepIds;
    metrics.totalDebtFromPayVendor = totalDebtFromPayVendor;
    metrics.refIds = allRefIds;

    return metrics;
}

/**
 * 2.4. Lưu hoặc cập nhật bản ghi trực tiếp vào bảng esdHTKTreportVendorDebt (Upsert)
 * Khớp 12 cột trong dbdict esdHTKTreportVendorDebt:
 *  1. id                   (character, VARCHAR(60))
 *  2. contract.id          (character, VARCHAR(60))
 *  3. vendor.id            (character, VARCHAR(60))
 *  4. vendor.number        (character, VARCHAR(60))
 *  5. vendor.name          (character, VARCHAR(500))
 *  6. total.payable.amount (character, VARCHAR(100))
 *  7. total.advance.amount (character, VARCHAR(100))
 *  8. total.refund.amount  (character, VARCHAR(100))
 *  9. total.paid.amount    (character, VARCHAR(100))
 * 10. list.ref.id          (character / text, JSON array dạng text)
 * 11. created.at           (date/time, TIMESTAMP)
 * 12. created.by           (character, VARCHAR(200))
 */
function saveReportVendorDebt(data) {
    var checkFile = null;
    var insertFile = null;
    try {
        checkFile = new SCFile("esdHTKTreportVendorDebt");
        var query = 'contract.id="' + escapeSmQueryValue(data["contract.id"]) +
                '" and vendor.id="' + escapeSmQueryValue(data["vendor.id"]) + '"';
        var isUpdate = (checkFile.doSelect(query) == RC_SUCCESS);

        if (isUpdate) {
            var existingId = String(checkFile["id"] || "").trim();
            if (data["list.ref.id"] !== undefined && data["list.ref.id"] !== null) {
                data["list.ref.id"] = mergeRefIdJson(checkFile["list.ref.id"], data["list.ref.id"]);
            }
            applyReportVendorDebtFields(checkFile, data, true);

            var rcUpdate = checkFile.doUpdate();
            if (rcUpdate == RC_SUCCESS || rcUpdate === true) {
                return { success: true, action: "UPDATE", id: existingId };
            }
            return { success: false, message: "Lỗi doUpdate bảng esdHTKTreportVendorDebt, id=" + existingId + ", rc=" + rcUpdate };
        } else {
            var newId = generateReportVendorDebtId();
            data.id = newId;

            // Khởi tạo SCFile mới hoàn toàn để doInsert an toàn trong Service Manager
            insertFile = new SCFile("esdHTKTreportVendorDebt");
            applyReportVendorDebtFields(insertFile, data, false);

            var rcInsert = insertFile.doInsert();
            if (rcInsert == RC_SUCCESS || rcInsert === true) {
                return { success: true, action: "INSERT", id: newId };
            }

            // Nếu doInsert thất bại do đụng Unique Key (contract.id, vendor.id) khi chạy đồng thời -> Chuyển sang UPDATE
            closeSCFile(checkFile);
            checkFile = new SCFile("esdHTKTreportVendorDebt");
            if (checkFile.doSelect(query) == RC_SUCCESS) {
                var retryId = String(checkFile["id"] || "").trim();
                if (data._isIncremental) {
                    data["total.payable.amount"] = String(parseAmount(checkFile["total.payable.amount"]) + parseAmount(data["total.payable.amount"]));
                    data["total.paid.amount"] = String(parseAmount(checkFile["total.paid.amount"]) + parseAmount(data["total.paid.amount"]));
                    data["total.advance.amount"] = String(parseAmount(checkFile["total.advance.amount"]) + parseAmount(data["total.advance.amount"]));
                    data["total.refund.amount"] = String(parseAmount(checkFile["total.refund.amount"]) + parseAmount(data["total.refund.amount"]));
                }
                if (data["list.ref.id"] !== undefined && data["list.ref.id"] !== null) {
                    data["list.ref.id"] = mergeRefIdJson(checkFile["list.ref.id"], data["list.ref.id"]);
                }
                applyReportVendorDebtFields(checkFile, data, true);
                var rcRetryUpdate = checkFile.doUpdate();
                if (rcRetryUpdate == RC_SUCCESS || rcRetryUpdate === true) {
                    return { success: true, action: "UPDATE", id: retryId };
                }
            }

            return { success: false, message: "Lỗi doInsert bảng esdHTKTreportVendorDebt, id=" + newId + ", rc=" + rcInsert };
        }
    } catch (eSave) {
        return { success: false, message: eSave.toString() };
    } finally {
        closeSCFile(checkFile);
        closeSCFile(insertFile);
    }
}

/**
 * Gán đúng 12 trường theo dbdict của bảng esdHTKTreportVendorDebt
 */
function applyReportVendorDebtFields(scFile, data, isUpdate) {
    if (!isUpdate) {
        scFile["id"] = String(data.id || "").slice(0, 60);
    }
    scFile["contract.id"] = String(data["contract.id"] || "").slice(0, 60);
    scFile["vendor.id"] = String(data["vendor.id"] || "").slice(0, 60);
    scFile["vendor.number"] = String(data["vendor.number"] || "").slice(0, 60);
    scFile["vendor.name"] = String(data["vendor.name"] || "").slice(0, 500);

    scFile["total.payable.amount"] = String(data["total.payable.amount"] || "0").slice(0, 100);
    scFile["total.advance.amount"] = String(data["total.advance.amount"] || "0").slice(0, 100);
    scFile["total.refund.amount"] = String(data["total.refund.amount"] || "0").slice(0, 100);
    scFile["total.paid.amount"] = String(data["total.paid.amount"] || "0").slice(0, 100);

    if (data["list.ref.id"] !== undefined && data["list.ref.id"] !== null) {
        scFile["list.ref.id"] = String(data["list.ref.id"]);
    }

    if (!isUpdate || !scFile["created.at"]) {
        scFile["created.at"] = data["created.at"] || ((system.functions && system.functions.tod) ? system.functions.tod() : new Date());
    }
    if (!isUpdate || !scFile["created.by"]) {
        scFile["created.by"] = String(data["created.by"] || "SYSTEM").slice(0, 200);
    }
}

/**
 * Sinh ID tự tăng từ Sequential Numbers của SM theo đúng chuẩn tạo Payment (ESD_HTKT_PAYMENT_CREATE_REQUEST)
 */
function generateReportVendorDebtId() {
    var numberClass = "esdHTKTreportVendorDebt";
    var numberRc = new SCDatum();
    numberRc.setValue(-1);
    var nextNumber = new SCDatum();

    system.functions.rtecall(
            "getnumber", numberRc, nextNumber, numberClass
    );

    var rcText = String(numberRc.getText()).replace(/^\s+|\s+$/g, "");
    var rawNumber = String(nextNumber.getText()).replace(/^\s+|\s+$/g, "");

    if (/^"[^"]*"$/.test(rawNumber) || /^'[^']*'$/.test(rawNumber)) {
        rawNumber = rawNumber.substring(1, rawNumber.length - 1);
    }

    if (rcText !== "0" || !rawNumber) {
        throw new Error("Không cấp được ID từ Sequential Numbers: " +
                numberClass + ". Kiểm tra bộ đếm hiện có (Increment=1, không Decrement). rc=" +
                rcText + ", number=" + rawNumber);
    }

    var existing = new SCFile("esdHTKTreportVendorDebt", SCFILE_READONLY);
    try {
        var rc = existing.doSelect('id="' + escapeSmQueryValue(rawNumber) + '"');
        if (rc === RC_SUCCESS) {
            throw new Error("Bộ đếm " + numberClass + " cấp mã đã tồn tại: " +
                    rawNumber + ". Dừng tạo bản ghi và đồng bộ bộ đếm với dữ liệu hiện có.");
        }
        if (rc !== RC_NO_MORE) {
            throw new Error("Không kiểm tra được mã bản ghi " + rawNumber + ". Code: " + rc);
        }
    } finally {
        closeSCFile(existing);
    }

    return rawNumber;
}

/**
 * Hàm lấy giá trị số từ file SCFile an toàn
 */
function getNumberField(file, fieldNames) {
    if (!file) return 0;
    for (var i = 0; i < fieldNames.length; i++) {
        var val = file[fieldNames[i]];
        if (val !== null && val !== undefined && val !== "") {
            var strVal = String(val).replace(/,/g, "").trim();
            var num = Number(strVal);
            if (!isNaN(num)) return num;
        }
    }
    return 0;
}

/**
 * Hàm parse giá trị số an toàn từ chuỗi/số
 */
function parseAmount(val) {
    if (val === null || val === undefined || val === "") return 0;
    var s = String(val).replace(/,/g, "").trim();
    var n = Number(s);
    return isNaN(n) ? 0 : n;
}

/**
 * Escape chuỗi an toàn cho Service Manager query
 */
function escapeSmQueryValue(value) {
    return String(value || "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
}

/**
 * Đóng SCFile an toàn trong finally
 */
function closeSCFile(file) {
    try {
        if (file) file.doClose();
    } catch (ignore) {}
}

/**
 * Parse an toàn chuỗi JSON sang mảng chuỗi mã ref.id.
 */
function parseRefIdJsonToList(rawJson) {
    var list = [];
    if (!rawJson) return list;

    var raw = String(rawJson).trim();
    if (!raw || raw === "[]") return list;

    try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            for (var i = 0; i < parsed.length; i++) {
                var item = parsed[i];
                if (item !== null && item !== undefined) {
                    var s = String(item).trim();
                    if (s && list.indexOf(s) === -1) {
                        list.push(s);
                    }
                }
            }
            return list;
        } else if (typeof parsed === "string") {
            var sStr = parsed.trim();
            if (sStr) list.push(sStr);
            return list;
        }
    } catch (eParse) {
        // Fallback: nếu chuỗi cũ là định dạng chuỗi đơn hoặc phân cách phẩy
        var parts = raw.replace(/[\[\]"]/g, "").split(",");
        for (var p = 0; p < parts.length; p++) {
            var piece = parts[p].trim();
            if (piece && list.indexOf(piece) === -1) {
                list.push(piece);
            }
        }
    }

    return list;
}

/**
 * Thêm một mã bản ghi (recordId) vào chuỗi JSON danh sách mã tham chiếu (list.ref.id).
 * - Lưu dạng JSON text: '["ID1","ID2",...]'
 * - Chống trùng lặp (không thêm nếu mã đã tồn tại).
 * - Xử lý an toàn chuỗi null, rỗng, hoặc định dạng không chuẩn.
 */
function appendRefIdToJson(currentJson, newRefId) {
    newRefId = String(newRefId || "").trim();
    if (!newRefId) {
        return currentJson ? String(currentJson).trim() : "[]";
    }

    var list = parseRefIdJsonToList(currentJson);
    if (list.indexOf(newRefId) === -1) {
        list.push(newRefId);
    }

    return JSON.stringify(list);
}

/**
 * Hợp nhất 2 chuỗi JSON (hoặc danh sách) mã tham chiếu, loại bỏ trùng lặp.
 */
function mergeRefIdJson(jsonA, jsonB) {
    var listA = parseRefIdJsonToList(jsonA);
    var listB = parseRefIdJsonToList(jsonB);

    for (var i = 0; i < listB.length; i++) {
        var item = listB[i];
        if (listA.indexOf(item) === -1) {
            listA.push(item);
        }
    }

    return JSON.stringify(listA);
}
