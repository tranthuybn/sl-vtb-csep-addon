/**
 * ScriptLibrary : ESD_HTKT_HHDV_DISBURSEMENT
 * -----------------------------------------------------------------------------
 * Module   : HTKT - Tab "Hàng hoá dịch vụ" (giải ngân theo HHDV) - Thanh toán / Tạm ứng
 * Chức năng: Lấy danh sách HHDV của HĐ/KMS theo NCC, phân loại KH-01 / KH-02,
 *            tra KHV còn lại (KH-01) hoặc Khoản mục/Chỉ tiêu, dòng con ĐV/PB và
 *            KHCP khả dụng (KH-02).
 *            Kiểm tra ràng buộc BR-03, BR-04, BR-05, BR-06, BR-07 và cập nhật
 *            số liệu giải ngân sang HĐ, Kế hoạch khi phê duyệt cuối (BR-08).
 *
 * Bảng lưu: esdHTKTpaymentHHDVDisbursement (dùng chung Thanh toán / Tạm ứng, payment.id = mã đề nghị).
 *
 * Chuỗi mapping:
 *   esdHDcontractHHDV (contract.id = HĐ)
 *     hhdv.id có 3 nguồn tuỳ luồng tạo HĐ:
 *       A. Thêm HHDV từ ĐXMS (addContractHHDV) : hhdv.id = esdMSdxmsItemAssignment.id
 *       B. Tạo HĐ từ gói thầu / TTMS           : hhdv.id = esdMSkmsHHDV.id
 *       B'. Dữ liệu chuyển đổi                 : hhdv.id = esdMSkmsHHDVTranfer.id
 *     ASG (esdMSdxmsItemAssignment) = A trực tiếp | B: kmsHHDV.hmcm.id -> ASG.id
 *       dxms.type -> KH-01 / KH-02 (fallback esdMSdxmsItem.dxms.type | capital.source.type)
 *     KH-01: Khoá KH = HĐ.item.id | kmsHHDV.item.id | ASG.dxms.item.id -> esdKHpurchaseItem.item.id
 *            KHV còn lại = khv.propose - disbursed.amount
 *     KH-02: ASG.dxms.id -> esdMSdxms (INDICATOR_ID, COST_ID)
 *            -> esdMSdxmsCost (dòng con ĐV/PB: UNIT_NAME, UNIT_ID, DEPT_ID)
 *            -> esdKHplanIndicators (PLAN_COST_AVAILABLE / PLAN_POST_ADJUSTMENT)
 * -----------------------------------------------------------------------------
 */

/*
 * Được gọi từ router ESD_ApiCustomScript_HTKT:
 *   case "getHHDVDisbursement": result = lib.ESD_HTKT_HHDV_DISBURSEMENT.getHHDVDisbursement(details);
 *   case "saveHHDVDisbursement": result = lib.ESD_HTKT_HHDV_DISBURSEMENT.saveHHDVDisbursement(details);
 *   case "clearHHDVDisbursement": result = lib.ESD_HTKT_HHDV_DISBURSEMENT.clearHHDVDisbursement(details);
 */

var PLAN_TYPE_BY_DXMS = {
    DXMS_01_01_01: "KH-01",
    DXMS_01_01_03: "KH-01",
    DXMS_02_01_01: "KH-01",
    DXMS_01_01_02: "KH-02",
    DXMS_02_01_02: "KH-02"
};

/* ============================== Logger ============================== */

var _smLogger = typeof getLog === "function" ? getLog("ESD_HTKT_HHDV_DISBURSEMENT") : null;
var log = {
    info: function(msg) {},
    warn: function(msg) {
        if (_smLogger && typeof _smLogger.warn === "function") {
            try { _smLogger.warn("[HHDV][WARN] " + msg); } catch (e) {}
        }
    },
    error: function(msg) {
        if (_smLogger && typeof _smLogger.error === "function") {
            try { _smLogger.error("[HHDV][ERROR] " + msg); } catch (e) {}
        }
    }
};

/* ============================== Helpers ============================== */

function str(v) {
    if (v === null || v === undefined) return "";
    var s = String(v).replace(/^\s+|\s+$/g, "");
    return s === "null" || s === "undefined" ? "" : s;
}

/** Tiền trên HĐ lưu VARCHAR, có thể kèm dấu phẩy */
function num(v) {
    var s = str(v).replace(/,/g, "");
    if (s === "") return 0;
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function hasValue(v) {
    return str(v).replace(/,/g, "") !== "";
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

function q(v) {
    return '"' + str(v).replace(/"/g, '\\"') + '"';
}

function cleanId(v) {
    if (v === null || v === undefined) return "";
    var s = str(v);
    if (s.indexOf("{") === 0 && s.indexOf("}") === s.length - 1) {
        s = s.substring(1, s.length - 1);
    }
    if (s.indexOf(",") !== -1) {
        s = s.split(",")[0];
    }
    return str(s).replace(/^["']|["']$/g, "").trim();
}

/** Đọc 1 bản ghi (readonly), trả về SCFile hoặc null */
function findOne(table, query) {
    try {
        var f = new SCFile(table, SCFILE_READONLY);
        return f.doSelect(query) === RC_SUCCESS ? f : null;
    } catch (e) {
        return null;
    }
}

/** Tìm bản ghi hợp đồng hoặc PO theo id, contract.code, contract.no hoặc name */
function findContractOrPo(code) {
    if (!code) return null;
    var c = cleanId(code);
    var f = findOne("esdHDcontract", "id=" + q(c));
    if (!f) f = findOne("esdHDcontract", "contract.code=" + q(c));
    if (!f) f = findOne("esdHDcontract", "contract.no=" + q(c));
    if (!f) f = findOne("esdHDcontract", "name=" + q(c));
    return f;
}

/** Nhận diện bản ghi có phải là Đơn đặt hàng (PO) hay không */
function isPoContract(rec) {
    if (!rec) return false;
    var cat = str(rec["category"]).toUpperCase();
    var cType = str(rec["contract.type"]).toUpperCase();
    var id = str(rec["id"]).toUpperCase();
    var code = str(rec["contract.code"] || rec["contract.no"]).toUpperCase();
    return (cat === "HD_PO" || cType === "PO" || id.indexOf("PO") === 0 || code.indexOf("PO") === 0);
}

/** Kiểm tra xem 2 mã vendorId/supplierId có trỏ về cùng một Nhà cung cấp hay không */
function checkIsSameVendor(v1, v2) {
    if (!v1 || !v2) return false;
    if (v1 === v2) return true;
    try {
        var fVen = findOne("esdHTKTvendor", "id=" + q(v1) + " or supplier.id=" + q(v1) + " or vendor.number=" + q(v1));
        if (fVen) {
            var vId = str(fVen["id"]);
            var sId = str(fVen["supplier.id"]);
            var vNum = str(fVen["vendor.number"]);
            if (v2 === vId || v2 === sId || v2 === vNum) return true;
        }
        var fVen2 = findOne("esdHTKTvendor", "id=" + q(v2) + " or supplier.id=" + q(v2) + " or vendor.number=" + q(v2));
        if (fVen2) {
            var vId2 = str(fVen2["id"]);
            var sId2 = str(fVen2["supplier.id"]);
            var vNum2 = str(fVen2["vendor.number"]);
            if (v1 === vId2 || v1 === sId2 || v1 === vNum2) return true;
        }
    } catch (eVen) {}
    return false;
}

/** Truy xuất mã Hợp đồng mẹ (Master Contract) từ PO */
function getMasterContractIdFromPo(poId, poRec) {
    if (!poId && !poRec) return "";
    var rec = poRec || findContractOrPo(poId);
    var parentId = "";
    if (rec) {
        parentId = cleanId(rec["item.id"] || rec["contract.id"] || rec["parent.contract.id"] || rec["parent.id"] || rec["kms.id"]);
        if (parentId === cleanId(rec["id"])) parentId = "";
        log.info("getMasterContractIdFromPo -> PO record [" + (poId || rec["id"]) + "]: item.id=" + rec["item.id"] + ", contract.id=" + rec["contract.id"] + ", parent.id=" + rec["parent.id"] + " => parentId=" + parentId);
    } else {
        log.info("getMasterContractIdFromPo -> Không tìm thấy bản ghi PO [" + poId + "] trong esdHDcontract");
    }
    var targetPoId = cleanId(poId || (rec ? rec["id"] : ""));
    if (!parentId && targetPoId) {
        var fPv = findOne("esdHTKTpaymentVendor", "po.id=" + q(targetPoId));
        if (fPv) {
            parentId = cleanId(fPv["contract.id"]);
            log.info("getMasterContractIdFromPo -> Tìm thấy HĐ mẹ từ esdHTKTpaymentVendor: " + parentId);
        }
    }
    if (!parentId && targetPoId) {
        var fPrep = findOne("esdHTKTprepayment", "po.id=" + q(targetPoId));
        if (fPrep) {
            parentId = cleanId(fPrep["contract.id"]);
            log.info("getMasterContractIdFromPo -> Tìm thấy HĐ mẹ từ esdHTKTprepayment: " + parentId);
        }
    }
    if (!parentId && targetPoId) {
        var fPay = findOne("esdHTKTpayment", "list.po.id=" + q(targetPoId)) || findOne("esdHTKTpayment", "po.id=" + q(targetPoId));
        if (fPay) {
            parentId = cleanId(fPay["contract.id"]);
            log.info("getMasterContractIdFromPo -> Tìm thấy HĐ mẹ từ esdHTKTpayment: " + parentId);
        }
    }
    return parentId;
}

function parseInput(input) {
    if (!input) return {};
    if (typeof input === "string") {
        try { return JSON.parse(input); } catch (e) { return {}; }
    }
    if (input.queryString) {
        try { return JSON.parse(input.queryString); } catch (e2) { return {}; }
    }
    return input;
}

/** Thành tiền sau thuế của dòng HĐ: amount.after.tax -> convert -> tự tính */
function getAmountAfterTax(row) {
    if (hasValue(row["amount.after.tax"])) return num(row["amount.after.tax"]);
    if (hasValue(row["amount.after.tax.convert"])) return num(row["amount.after.tax.convert"]);

    var before = hasValue(row["amount.before.tax"])
            ? num(row["amount.before.tax"])
            : num(row["unit.price"]) * num(row["quantity"]);
    return before + num(row["money.tax"]) + num(row["money.tax.other"]);
}

/* ============================== Resolve HHDV ============================== */

/**
 * Resolve nguồn của 1 dòng esdHDcontractHHDV.
 * @param {SCFile} row Dòng bản ghi esdHDcontractHHDV
 * @param {string} [masterContractId] Mã Hợp đồng mẹ (Master Contract) để tra cứu bổ sung
 * @returns {{flow:string, asg:SCFile|null, kms:SCFile|null, dxmsType:string, planType:string, khKey:string, dxmsId:string}}
 */
function resolveHHDV(row, masterContractId) {
    var candidates = [];
    function addCandidate(val) {
        var s = str(val);
        if (!s) return;
        if (candidates.indexOf(s) === -1) candidates.push(s);
        // Bỏ hậu tố _Pxxxx nếu có (ví dụ HM_26_4_0000361_P09325 -> HM_26_4_0000361)
        var stripped = s.replace(/_P[0-9a-zA-Z]+$/i, "");
        if (stripped && stripped !== s && candidates.indexOf(stripped) === -1) {
            candidates.push(stripped);
        }
    }

    addCandidate(row["hhdv.id"]);
    addCandidate(row["id"]);
    addCandidate(row["item.id"]);
    addCandidate(row["hmcm.id"]);
    addCandidate(row["dxms.item.id"]);

    var res = { flow: "", asg: null, kms: null, dxmsType: "", planType: "", khKey: "", dxmsId: "" };

    // 1. Tìm ASG hoặc KMS từ danh sách candidate IDs
    for (var ci = 0; ci < candidates.length; ci++) {
        var cand = candidates[ci];
        res.asg = findOne("esdMSdxmsItemAssignment", "id=" + q(cand));
        if (res.asg) {
            res.flow = "A_ASG";
            break;
        }
        res.kms = findOne("esdMSkmsHHDV", "id=" + q(cand));
        if (res.kms) {
            res.flow = "B_KMS";
            if (str(res.kms["hmcm.id"])) {
                res.asg = findOne("esdMSdxmsItemAssignment", "id=" + q(res.kms["hmcm.id"]));
            }
            break;
        }
        var kmsTr = findOne("esdMSkmsHHDVTranfer", "id=" + q(cand));
        if (kmsTr) {
            res.kms = kmsTr;
            res.flow = "B_TRANFER";
            if (str(kmsTr["hmcm.id"])) {
                res.asg = findOne("esdMSdxmsItemAssignment", "id=" + q(kmsTr["hmcm.id"]));
            }
            break;
        }
    }

    // 2. Xác định loại ĐXMS (dxms.type): ASG -> esdMSdxmsItem -> dòng HĐ -> esdMSdxms
    var dxmsType = res.asg ? str(res.asg["dxms.type"]) : "";
    if (!dxmsType && res.asg && str(res.asg["item.id"])) {
        var dxmsItem = findOne("esdMSdxmsItem", "id=" + q(res.asg["item.id"]));
        if (dxmsItem) dxmsType = str(dxmsItem["dxms.type"]);
    }
    if (!dxmsType) {
        for (var cj = 0; cj < candidates.length; cj++) {
            var dItem = findOne("esdMSdxmsItem", "id=" + q(candidates[cj]));
            if (dItem && str(dItem["dxms.type"])) {
                dxmsType = str(dItem["dxms.type"]);
                break;
            }
        }
    }
    if (!dxmsType) dxmsType = str(row["dxms.type"]);

    res.dxmsId = (res.asg ? str(res.asg["dxms.id"] || res.asg["dxms_id"]) : "") ||
            (res.kms ? str(res.kms["dxms.id"] || res.kms["dxms_id"]) : "") ||
            str(row["dxms.id"] || row["dxms_id"]);

    if (!dxmsType && res.dxmsId) {
        var dxmsRec = findOne("esdMSdxms", "id=" + q(res.dxmsId));
        if (dxmsRec) {
            dxmsType = str(dxmsRec["dxms.type"] || dxmsRec["type"]);
        }
    }

    res.dxmsType = dxmsType;

    // 3. Phân loại theo dxmsType
    if (dxmsType) {
        var upperType = dxmsType.toUpperCase();
        if (upperType.indexOf("01_01_01") !== -1 || upperType.indexOf("01_01_03") !== -1 || upperType.indexOf("02_01_01") !== -1) {
            res.planType = "KH-01";
        } else if (upperType.indexOf("01_01_02") !== -1 || upperType.indexOf("02_01_02") !== -1) {
            res.planType = "KH-02";
        } else if (PLAN_TYPE_BY_DXMS[dxmsType]) {
            res.planType = PLAN_TYPE_BY_DXMS[dxmsType];
        }
    }

    // 4. Fallback: Nguồn vốn (capital.source.type) trên dòng HĐ, ASG, ĐXMS hoặc Header HĐ mẹ
    if (!res.planType) {
        var capSources = [
            str(row["capital.source.type"]),
            res.asg ? str(res.asg["capital.source.type"]) : "",
            res.kms ? str(res.kms["capital.source.type"]) : ""
        ];
        var masterId = masterContractId || str(row["contract.id"]);
        if (masterId) {
            var hdRec = findContractOrPo(masterId);
            if (hdRec) {
                capSources.push(str(hdRec["capital.source.type"] || hdRec["capital.type"] || hdRec["source.type"]));
            }
        }
        for (var csi = 0; csi < capSources.length; csi++) {
            var cs = capSources[csi].toLowerCase();
            if (!cs) continue;
            if (cs.indexOf("đầu tư") !== -1 || cs.indexOf("dau tu") !== -1 || cs === "vdt") {
                res.planType = "KH-01";
                break;
            }
            if (cs.indexOf("chi phí") !== -1 || cs.indexOf("chi phi") !== -1 || cs === "vcp") {
                res.planType = "KH-02";
                break;
            }
        }
    }

    res.khKey = str(row["item.id"]) || (res.kms ? str(res.kms["item.id"]) : "") || (res.asg ? str(res.asg["dxms.item.id"]) : "");

    // 5. Fallback: Kiểm tra xem có trong bảng Kế hoạch Vốn Đầu Tư (esdKHpurchaseItem) không -> KH-01
    if (!res.planType) {
        for (var cki = 0; cki < candidates.length; cki++) {
            var khItem = findOne("esdKHpurchaseItem", "item.id=" + q(candidates[cki]));
            if (khItem) {
                res.planType = "KH-01";
                if (!res.khKey) res.khKey = candidates[cki];
                break;
            }
        }
    }

    // 6. Fallback: Kiểm tra xem có trong bảng ĐXMS Chi phí (esdMSdxmsCost) không -> KH-02
    if (!res.planType && res.dxmsId) {
        var fCostCheck = findOne("esdMSdxmsCost", "dxms.id=" + q(res.dxmsId));
        if (fCostCheck) {
            res.planType = "KH-02";
        }
    }

    // 7. SAFETY FALLBACK: Nếu vẫn chưa phân loại được, mặc định đưa vào KH-02 (Chi phí hoạt động)
    // để dòng HHDV luôn được hiển thị cho Kế toán giải ngân, không bị ẩn vào meta.unclassified.
    if (!res.planType) {
        res.planType = "KH-02";
        log.info("resolveHHDV -> HHDV [" + str(row["id"]) + "] chưa xác định được qua ASG/KMS/ĐXMS/Nguồn vốn -> Fallback mặc định KH-02 (Chi phí hoạt động) để hiển thị lên form.");
    }

    if (!res.flow) res.flow = "ORPHAN";
    return res;
}

/** KHV còn lại từ esdKHpurchaseItem. null nếu không tra được. */
function getKhvRemaining(khKey, planYear) {
    if (!khKey) return null;
    var kh = findOne("esdKHpurchaseItem", "item.id=" + q(khKey) + " and year.request=" + planYear);
    if (!kh) kh = findOne("esdKHpurchaseItem", "item.id=" + q(khKey));
    if (!kh) return null;
    return {
        khId: str(kh["id"]),
        year: str(kh["year.request"]),
        khv: num(kh["khv.propose"]),
        disbursed: num(kh["disbursed.amount"]),
        remaining: round2(num(kh["khv.propose"]) - num(kh["disbursed.amount"]))
    };
}

/** KHCP khả dụng từ esdKHplanIndicators theo indicator.id, planYear và scopeId */
function getKhcpAvailable(indicatorId, planYear, scopeType, scopeId) {
    if (!indicatorId || !scopeId || scopeType === "ALL") return null;
    var query = "indicator.id=" + q(indicatorId);
    if (planYear) query += " and plan.year=" + planYear;
    if (scopeType === "DEPARTMENT") {
        query += " and dept.id=" + q(scopeId);
    } else if (scopeType === "UNIT") {
        query += " and unit.id=" + q(scopeId);
    }

    var khcp = findOne("esdKHplanIndicators", query);
    if (!khcp && planYear) {
        var fbQuery = "indicator.id=" + q(indicatorId);
        if (scopeType === "DEPARTMENT") fbQuery += " and dept.id=" + q(scopeId);
        else if (scopeType === "UNIT") fbQuery += " and unit.id=" + q(scopeId);
        khcp = findOne("esdKHplanIndicators", fbQuery);
    }
    if (!khcp) return null;

    return hasValue(khcp["plan.cost.available"])
            ? num(khcp["plan.cost.available"])
            : (hasValue(khcp["plan.post.adjustment"]) ? num(khcp["plan.post.adjustment"]) : null);
}

/* ============================== Bảng giải ngân ============================== */

var DISBURSEMENT_TABLE = "esdHTKTpaymentHHDVDisbursement";

/**
 * Trạng thái đề nghị được tính là "đã giải ngân".
 */
var DISBURSED_STATUSES = { approved: true, accounted: true };

/** Khoá dòng giải ngân trong 1 phiếu NCC */
function rowKey(hhdvId, scopeType, scopeId) {
    return hhdvId + "|" + (scopeType || "HHDV") + "|" + (scopeId || hhdvId);
}

/** Trạng thái của đề nghị (thanh toán hoặc tạm ứng), có cache */
function getRequestStatus(requestId, cache) {
    if (cache.hasOwnProperty(requestId)) return cache[requestId];
    var header = findOne("esdHTKTpayment", "id=" + q(requestId)) || findOne("esdHTKTprepayment", "id=" + q(requestId));
    cache[requestId] = header ? str(header["status"]) : "";
    return cache[requestId];
}

/**
 * Đọc bảng giải ngân của HĐ:
 *  - current         : số đã lưu của phiếu NCC hiện tại, theo rowKey
 *  - disbursed       : tổng đã giải ngân theo hhdv.id của các đề nghị khác đã duyệt
 *  - disbursedByScope: tổng đã giải ngân theo từng dòng con rowKey của các đề nghị khác đã duyệt
 */
function loadDisbursements(contractId, requestId, requestVendorId, altContractId) {
    var res = { current: {}, disbursed: {}, disbursedByScope: {} };
    var statusCache = {};
    var f = new SCFile(DISBURSEMENT_TABLE, SCFILE_READONLY);
    var query = "contract.id=" + q(contractId);
    if (altContractId && altContractId !== contractId) {
        query = "(contract.id=" + q(contractId) + " or contract.id=" + q(altContractId) + ")";
    }
    var rc = f.doSelect(query);
    while (rc === RC_SUCCESS) {
        var hhdvId = str(f["hhdv.id"]);
        var amount = num(f["amount"]);
        var scopeType = str(f["scope.type"]) || "HHDV";
        var scopeId = str(f["scope.id"]) || hhdvId;
        var key = rowKey(hhdvId, scopeType, scopeId);

        var isCurrent = str(f["payment.id"]) === requestId && str(f["payment.vendor.id"]) === requestVendorId;
        if (isCurrent) {
            res.current[key] = amount;
        } else if (DISBURSED_STATUSES[getRequestStatus(str(f["payment.id"]), statusCache)]) {
            res.disbursed[hhdvId] = round2((res.disbursed[hhdvId] || 0) + amount);
            res.disbursedByScope[key] = round2((res.disbursedByScope[key] || 0) + amount);
        }
        rc = f.getNext();
    }
    return res;
}

/* ============================== Context ============================== */

/** Chuẩn hoá payload Thanh toán / Tạm ứng về 1 dạng */
function resolveRequest(p) {
    var isPrepayment = !!str(p.prepaymentId);
    return {
        isPrepayment: isPrepayment,
        requestId: isPrepayment ? str(p.prepaymentId) : str(p.paymentId),
        requestVendorId: isPrepayment ? str(p.prepaymentVendorId) : str(p.paymentVendorId),
        vendorId: str(p.vendorId)
    };
}

/**
 * Xác định chính xác Hợp đồng mẹ (Master Contract), PO và Nhà cung cấp (Vendor/NCC).
 * Nguyên tắc: HHDV luôn thuộc Hợp đồng mẹ (HĐ) và lọc theo Nhà cung cấp (NCC).
 * Không được truy vấn HHDV theo mã PO một cách độc lập vì esdHDcontractHHDV lưu theo contract.id = HĐ.
 */
function resolveContractAndVendor(p, req) {
    log.info("resolveContractAndVendor -> Bắt đầu nhận diện: rawContractId=" + p.contractId + ", rawPoId=" + (p.poId || p.po_id) + ", rawVendorId=" + (p.vendorId || req.vendorId) + ", requestId=" + req.requestId + ", requestVendorId=" + req.requestVendorId);

    var isPrepayment = req.isPrepayment;
    var rawPoId = cleanId(p.poId || p.po_id || p["po.id"]);
    var rawContractId = cleanId(p.contractId || p["contract.id"]);
    var rawVendorId = cleanId(p.vendorId || p["vendor.id"] || req.vendorId);

    var masterContractId = "";
    var poId = rawPoId;
    var vendorId = rawVendorId;

    // 1. Kiểm tra header của phiếu nếu có requestId (đã có đề nghị)
    var header = null;
    if (req.requestId) {
        header = findOne(isPrepayment ? "esdHTKTprepayment" : "esdHTKTpayment", "id=" + q(req.requestId));
        if (header) {
            var hContract = cleanId(header["contract.id"]);
            var hPo = cleanId(header["po.id"] || header["list.po.id"]);
            var hVendor = cleanId(header["vendor.id"] || header["supplier.id"]);
            log.info("1. Header phiếu [" + req.requestId + "]: contract.id=" + hContract + ", po.id=" + hPo + ", vendor.id=" + hVendor);

            if (hContract) masterContractId = hContract;
            if (!poId && hPo) poId = hPo;
            if (!vendorId && hVendor) vendorId = hVendor;
        } else {
            log.info("1. Không tìm thấy header phiếu [" + req.requestId + "] trong " + (isPrepayment ? "esdHTKTprepayment" : "esdHTKTpayment"));
        }
    }

    // 2. Kiểm tra dòng vendor của phiếu nếu có requestVendorId
    if (req.requestVendorId) {
        var vTbl = isPrepayment ? "esdHTKTprepaymentVendor" : "esdHTKTpaymentVendor";
        var vRec = findOne(vTbl, "id=" + q(req.requestVendorId));
        if (vRec) {
            var vVendor = cleanId(vRec["vendor.id"] || vRec["supplier.id"]);
            var vPo = cleanId(vRec["po.id"]);
            var vContract = isPrepayment ? "" : cleanId(vRec["contract.id"]);
            log.info("2. Dòng vendor phiếu [" + req.requestVendorId + "]: po.id=" + vPo + ", vendor.id=" + vVendor + ", contract.id=" + vContract);

            if (!vendorId && vVendor) vendorId = vVendor;
            if (!poId && vPo) poId = vPo;
            if (!masterContractId && vContract) masterContractId = vContract;
        } else {
            log.info("2. Không tìm thấy dòng vendor [" + req.requestVendorId + "] trong bảng " + vTbl);
        }
    }

    // 3. Phân biệt rawContractId là HĐ mẹ hay thực chất là PO
    if (rawContractId && !masterContractId) {
        var cRec = findContractOrPo(rawContractId);
        if (cRec) {
            var isPo = isPoContract(cRec);
            log.info("3. Tra cứu rawContractId [" + rawContractId + "] trong esdHDcontract -> isPo=" + isPo + ", category=" + cRec["category"] + ", contract.type=" + cRec["contract.type"] + ", item.id=" + cRec["item.id"] + ", contract.id=" + cRec["contract.id"]);
            if (isPo) {
                if (!poId) poId = rawContractId;
                masterContractId = getMasterContractIdFromPo(rawContractId, cRec);
                log.info("   -> Quy đổi từ PO [" + rawContractId + "] sang HĐ mẹ: " + masterContractId);
            } else {
                masterContractId = rawContractId;
            }
        } else {
            log.info("3. Không tìm thấy rawContractId [" + rawContractId + "] trong esdHDcontract");
            masterContractId = rawContractId;
        }
    }

    // 4. Nếu có poId mà vẫn chưa có masterContractId, truy vết HĐ mẹ từ PO
    if (poId && !masterContractId) {
        log.info("4. Tìm HĐ mẹ cho poId [" + poId + "]...");
        masterContractId = getMasterContractIdFromPo(poId, null);
        log.info("   -> Kết quả tìm HĐ mẹ từ poId: " + masterContractId);
    }

    // Dự phòng nếu không tìm được HĐ mẹ: dùng rawContractId hoặc poId
    if (!masterContractId) {
        masterContractId = rawContractId || poId;
        log.warn("4. Fallback masterContractId: " + masterContractId);
    }

    // 5. Nếu chưa có vendorId mà có PO, tìm vendor của PO từ esdHDcontractSupplier
    if (!vendorId && poId) {
        var fPoSupp = findOne("esdHDcontractSupplier", "contract.id=" + q(poId));
        if (fPoSupp) {
            vendorId = cleanId(fPoSupp["supplier.id"] || fPoSupp["vendor.id"]);
            log.info("5. Tìm thấy vendorId từ esdHDcontractSupplier của PO [" + poId + "]: " + vendorId);
        } else {
            log.info("5. Không tìm thấy vendorId trong esdHDcontractSupplier cho PO [" + poId + "]");
        }
    }

    log.info("resolveContractAndVendor -> KẾT QUẢ: masterContractId=" + masterContractId + ", poId=" + poId + ", vendorId=" + vendorId);

    return {
        masterContractId: masterContractId,
        poId: poId,
        vendorId: vendorId
    };
}

/** Lấy contract.id từ payload / context (tự động quy đổi PO về HĐ mẹ) */
function resolveContractId(p, req) {
    var r = resolveContractAndVendor(p, req);
    return r.masterContractId;
}

/* ============================== API: GET ============================== */

/**
 * Action: getHHDVDisbursement
 * Payload (FE):
 *   Thanh toán: { paymentId, paymentVendorId, vendorId, contractId, poId, planYear }
 *   Tạm ứng   : { prepaymentId, prepaymentVendorId, vendorId, contractId, poId, planYear }
 * Trả về: { success, data: HHDVDisbursementData, meta }
 */
function getHHDVDisbursement(input) {
    try {
        log.info("================================================================================");
        log.info("getHHDVDisbursement START");
        var rawInputStr = "";
        try { rawInputStr = (typeof input === "object" ? JSON.stringify(input) : String(input)); } catch (eJson) { rawInputStr = String(input); }
        log.info("Input payload: " + rawInputStr);

        var p = parseInput(input);
        var req = resolveRequest(p);
        var resolved = resolveContractAndVendor(p, req);
        var contractId = resolved.masterContractId;
        var vendorId = resolved.vendorId;
        var poId = resolved.poId;

        log.info("Target Master Contract (HĐ mẹ): " + contractId + ", PO: " + (poId || "(không có)") + ", Vendor: " + (vendorId || "(không có)"));

        if (!contractId) {
            log.error("Không xác định được Hợp đồng mẹ (HĐ) của đề nghị hoặc PO. Hủy truy vấn!");
            return { success: false, message: "Không xác định được Hợp đồng (HĐ) của đề nghị hoặc PO." };
        }

        var planYear = Number(p.planYear) || new Date().getFullYear();
        var meta = {
            contractId: contractId,
            poId: poId,
            vendorId: vendorId,
            planYear: planYear,
            total: 0,
            kh01: 0,
            kh02: 0,
            unclassified: [],
            flows: {}
        };

        // Luôn truy vấn esdHDcontractHHDV theo Hợp đồng mẹ (Master Contract)
        var actualContractId = contractId;
        var row = new SCFile("esdHDcontractHHDV", SCFILE_READONLY);
        var qHhdv = "contract.id=" + q(contractId);
        log.info("Thực thi query esdHDcontractHHDV: " + qHhdv);
        var rc = row.doSelect(qHhdv);
        log.info("Kết quả doSelect esdHDcontractHHDV với HĐ mẹ [" + contractId + "]: RC=" + rc + (rc === RC_SUCCESS ? " (Tìm thấy bản ghi)" : " (0 BẢN GHI)"));

        // Dự phòng: nếu HĐ mẹ chưa có dòng HHDV nào nhưng bản thân PO lại có lưu riêng (hiếm gặp)
        if (rc !== RC_SUCCESS && poId && poId !== contractId) {
            var qPoHhdv = "contract.id=" + q(poId);
            log.info("Dự phòng: Thử query esdHDcontractHHDV theo PO [" + poId + "]: " + qPoHhdv);
            var rcPo = row.doSelect(qPoHhdv);
            log.info("Kết quả doSelect esdHDcontractHHDV theo PO: RC=" + rcPo);
            if (rcPo === RC_SUCCESS) {
                rc = RC_SUCCESS;
                actualContractId = poId;
                meta.isDirectPoHhdv = true;
            }
        }

        if (rc !== RC_SUCCESS) {
            log.warn("CẢNH BÁO: Bảng esdHDcontractHHDV hoàn toàn KHÔNG CÓ dòng nào cho contract.id=" + contractId + (poId ? " và po.id=" + poId : "") + "!");
        }

        var saved = loadDisbursements(actualContractId, req.requestId, req.requestVendorId, poId);
        var kh01Items = [];
        var kh02Items = [];
        var currency = "";
        var totalScanned = 0;
        var totalAccepted = 0;
        var totalVendorSkipped = 0;

        while (rc === RC_SUCCESS) {
            totalScanned++;
            var hhdvId = str(row["id"]);
            var itemName = str(row["item.name"] || row["hhdv.name"]);
            var assignedVendor = cleanId(row["supplier.id"] || row["vendor.id"]);

            // Lọc theo Nhà cung cấp (NCC):
            // Nếu HHDV có gán NCC cụ thể và biết vendorId, chỉ lấy HHDV của NCC này.
            // Dòng không gán NCC (rỗng) là dùng chung cho toàn HĐ, hiển thị cho mọi NCC.
            if (vendorId && assignedVendor && assignedVendor !== vendorId) {
                if (!checkIsSameVendor(assignedVendor, vendorId)) {
                    totalVendorSkipped++;
                    log.info("[LỌC BỎ] HHDV [" + hhdvId + " - " + itemName + "] gán NCC: " + assignedVendor + ", khác NCC đề nghị: " + vendorId);
                    rc = row.getNext();
                    continue;
                } else {
                    log.info("[KHỚP NCC MỞ RỘNG] HHDV [" + hhdvId + "] có assignedVendor=" + assignedVendor + " khớp với vendorId=" + vendorId + " qua esdHTKTvendor!");
                }
            }

            totalAccepted++;
            meta.total++;
            var r = resolveHHDV(row, actualContractId);
            meta.flows[r.flow] = (meta.flows[r.flow] || 0) + 1;
            if (!currency) currency = str(row["currency.code"]);

            var amountAfterTax = round2(getAmountAfterTax(row));
            var disbursed = saved.disbursed[hhdvId] || num(row["disbursed.amount"]) || 0;
            log.info("[CHẤP NHẬN] HHDV [" + hhdvId + " - " + itemName + "] -> Phân loại: " + r.planType + ", Thành tiền sau thuế: " + amountAfterTax + ", Đã giải ngân: " + disbursed + ", Gán NCC: " + (assignedVendor || "Dùng chung HĐ"));

            if (r.planType === "KH-01") {
                meta.kh01++;
                var kh = getKhvRemaining(r.khKey, planYear);
                var planCode = (kh && kh.khId) ? kh.khId : r.khKey;
                kh01Items.push({
                    hhdvId: hhdvId,
                    itemName: str(row["item.name"]) || str(row["hhdv.name"]),
                    itemUnit: str(row["item.unit"]),
                    quantity: hasValue(row["quantity"]) ? num(row["quantity"]) : null,
                    capitalSourceType: str(row["capital.source.type"]) || "Vốn đầu tư",
                    planItemCode: planCode,
                    itemCode: r.khKey,
                    khvRemaining: kh ? kh.remaining : null,
                    amountAfterTax: amountAfterTax,
                    disbursedAmount: disbursed,
                    amount: saved.current[rowKey(hhdvId, "HHDV", hhdvId)] || 0
                });
            } else if (r.planType === "KH-02") {
                meta.kh02++;
                var dxms = r.dxmsId ? findOne("esdMSdxms", "id=" + q(r.dxmsId)) : null;
                var costId = dxms ? str(dxms["cost.id"] || dxms["cost_id"]) : "";
                var indicatorId = dxms ? str(dxms["indicator.id"] || dxms["indicator_id"]) : "";
                var costName = dxms ? str(dxms["cost.name"] || dxms["cost_name"]) : "";
                var indicatorName = dxms ? str(dxms["indicator.name"] || dxms["indicator_name"]) : "";

                if (costId && !costName) {
                    var cItem = findOne("esdDMCostItems", "cost.id=" + q(costId)) || findOne("esdDMCostItems", "id=" + q(costId));
                    if (cItem) costName = str(cItem["name"] || cItem["cost.name"]);
                }
                if (indicatorId && !indicatorName) {
                    var iItem = findOne("esdDMIndicators", "indicator.id=" + q(indicatorId)) || findOne("esdDMIndicators", "id=" + q(indicatorId));
                    if (iItem) indicatorName = str(iItem["name"] || iItem["indicator.name"]);
                }

                // Load children (dòng con ĐV/PB) từ esdMSdxmsCost
                var children = [];
                if (r.dxmsId) {
                    var fCost = new SCFile("esdMSdxmsCost", SCFILE_READONLY);
                    var rcCost = fCost.doSelect("dxms.id=" + q(r.dxmsId));
                    while (rcCost === RC_SUCCESS) {
                        var scopeType = "UNIT";
                        var scopeId = str(fCost["unit.id"] || fCost["unit_id"]);
                        var scopeName = str(fCost["unit.name"] || fCost["unit_name"] || fCost["name"]);
                        var deptId = str(fCost["dept.id"] || fCost["dept_id"]);
                        var deptName = str(fCost["dept.name"] || fCost["dept_name"]);

                        if (deptId || (!scopeId && deptName)) {
                            scopeType = "DEPARTMENT";
                            scopeId = deptId || scopeId;
                            scopeName = deptName || scopeName;
                        }

                        var rawScope = str(fCost["scope.type"] || fCost["scope_type"] || fCost["register.scope"]).toUpperCase();
                        if (rawScope === "ALL" || scopeName === "Toàn hàng" || scopeId === "ALL") {
                            scopeType = "ALL";
                            scopeId = "ALL";
                            scopeName = "Toàn hàng";
                        } else if (rawScope === "DEPARTMENT") {
                            scopeType = "DEPARTMENT";
                        } else if (rawScope === "UNIT") {
                            scopeType = "UNIT";
                        }

                        var khcpAvail = (scopeType === "ALL") ? null : getKhcpAvailable(indicatorId, planYear, scopeType, scopeId);
                        var childKey = rowKey(hhdvId, scopeType, scopeId);
                        var childDisbursed = saved.disbursedByScope[childKey] || 0;
                        var childAmount = saved.current[childKey] || 0;

                        children.push({
                            scopeType: scopeType,
                            scopeId: scopeId,
                            scopeName: scopeName,
                            khcpAvailable: khcpAvail,
                            disbursedAmount: childDisbursed,
                            amount: childAmount
                        });
                        rcCost = fCost.getNext();
                    }
                }

                // Nếu chưa có trong esdMSdxmsCost, kiểm tra các dòng đã lưu trong esdHTKTpaymentHHDVDisbursement
                if (children.length === 0) {
                    for (var curKey in saved.current) {
                        if (curKey.indexOf(hhdvId + "|") === 0) {
                            var parts = curKey.split("|");
                            var sType = parts[1] || "UNIT";
                            var sId = parts[2] || parts[0];
                            children.push({
                                scopeType: sType,
                                scopeId: sId,
                                scopeName: sId === "ALL" ? "Toàn hàng" : sId,
                                khcpAvailable: (sType === "ALL") ? null : getKhcpAvailable(indicatorId, planYear, sType, sId),
                                disbursedAmount: saved.disbursedByScope[curKey] || 0,
                                amount: saved.current[curKey] || 0
                            });
                        }
                    }
                }

                // Fallback 1 dòng mặc định nếu không có dữ liệu phân bổ ĐV/PB
                if (children.length === 0) {
                    var defUnit = dxms ? str(dxms["unit.dxms"] || dxms["unit.id"]) : "";
                    var defDept = dxms ? str(dxms["dept.dxms"] || dxms["dept.id"]) : "";
                    var defName = dxms ? str(dxms["unit.name"] || dxms["location"]) : "";
                    if (defDept) {
                        children.push({
                            scopeType: "DEPARTMENT",
                            scopeId: defDept,
                            scopeName: defName || defDept,
                            khcpAvailable: getKhcpAvailable(indicatorId, planYear, "DEPARTMENT", defDept),
                            disbursedAmount: 0,
                            amount: 0
                        });
                    } else if (defUnit) {
                        children.push({
                            scopeType: "UNIT",
                            scopeId: defUnit,
                            scopeName: defName || defUnit,
                            khcpAvailable: getKhcpAvailable(indicatorId, planYear, "UNIT", defUnit),
                            disbursedAmount: 0,
                            amount: 0
                        });
                    } else {
                        children.push({
                            scopeType: "ALL",
                            scopeId: "ALL",
                            scopeName: "Toàn hàng",
                            khcpAvailable: null,
                            disbursedAmount: 0,
                            amount: 0
                        });
                    }
                }

                // Số tiền giải ngân lần này của dòng cha = tổng các dòng con
                var parentAmount = 0;
                for (var cIdx = 0; cIdx < children.length; cIdx++) {
                    parentAmount += children[cIdx].amount;
                }

                kh02Items.push({
                    hhdvId: hhdvId,
                    itemName: str(row["item.name"]) || str(row["hhdv.name"]),
                    itemUnit: str(row["item.unit"]),
                    quantity: hasValue(row["quantity"]) ? num(row["quantity"]) : null,
                    capitalSourceType: str(row["capital.source.type"]) || "Vốn chi phí",
                    costId: costId,
                    costName: costName,
                    indicatorId: indicatorId,
                    indicatorName: indicatorName,
                    amountAfterTax: amountAfterTax,
                    disbursedAmount: disbursed,
                    amount: round2(parentAmount),
                    children: children
                });
            } else {
                meta.unclassified.push(hhdvId + " [" + r.flow + (r.dxmsType ? ", " + r.dxmsType : "") + "]");
            }
            rc = row.getNext();
        }

        log.info("KẾT THÚC getHHDVDisbursement: Đã duyệt " + meta.total + " dòng (KH-01: " + kh01Items.length + ", KH-02: " + kh02Items.length + ", Chưa phân loại: " + meta.unclassified.length + ")");
        log.info("================================================================================");

        return {
            success: true,
            data: {
                requestAmount: 0, // FE lấy từ initData ($amount / $isAmount)
                planYear: planYear,
                currency: currency || undefined,
                plans: [
                    { planType: "KH-01", items: kh01Items },
                    { planType: "KH-02", items: kh02Items }
                ]
            },
            meta: meta
        };
    } catch (e) {
        log.error("LỖI EXCEPTION trong getHHDVDisbursement: " + e + (e.stack ? "\n" + e.stack : ""));
        return { success: false, message: "Lỗi lấy thông tin giải ngân theo HHDV: " + e };
    }
}

/* ============================== API: SAVE ============================== */

/**
 * Kiểm tra lại BR-04 / BR-05 trên server cho cả KH-01 và KH-02.
 * Trả về chuỗi lỗi hoặc "" nếu hợp lệ.
 */
function validateDisbursements(rows, plans) {
    var kh01Items = (plans[0] && plans[0].planType === "KH-01") ? plans[0].items : [];
    var kh02Items = (plans[1] && plans[1].planType === "KH-02")
            ? plans[1].items
            : (plans[0] && plans[0].planType === "KH-02" ? plans[0].items : []);

    var itemsById = {};
    var kh01ByPlanCode = {};

    for (var i = 0; i < kh01Items.length; i++) {
        var it1 = kh01Items[i];
        itemsById[it1.hhdvId] = it1;
        var code = it1.planItemCode || it1.hhdvId;
        if (!kh01ByPlanCode[code]) {
            kh01ByPlanCode[code] = { total: 0, limit: it1.khvRemaining };
        }
    }

    for (var j = 0; j < kh02Items.length; j++) {
        var it2 = kh02Items[j];
        itemsById[it2.hhdvId] = it2;
    }

    var hhdvTotals = {};

    for (var k = 0; k < rows.length; k++) {
        var r = rows[k];
        if (r.amount < 0) {
            return "Số tiền giải ngân của HHDV " + r.hhdvId + " không được âm.";
        }
        var item = itemsById[r.hhdvId];
        if (!item) {
            return "HHDV " + r.hhdvId + " không thuộc HĐ/KMS của đề nghị.";
        }

        hhdvTotals[r.hhdvId] = round2((hhdvTotals[r.hhdvId] || 0) + r.amount);

        if (r.planType === "KH-01") {
            var pCode = item.planItemCode || item.hhdvId;
            if (kh01ByPlanCode[pCode]) {
                kh01ByPlanCode[pCode].total = round2(kh01ByPlanCode[pCode].total + r.amount);
            }
        } else if (r.planType === "KH-02") {
            // BR-05 cho từng dòng con KH-02
            if (r.scopeType !== "ALL" && item.children) {
                for (var c = 0; c < item.children.length; c++) {
                    var ch = item.children[c];
                    if (ch.scopeId === r.scopeId && ch.khcpAvailable !== null && ch.khcpAvailable !== undefined) {
                        if (r.amount > ch.khcpAvailable) {
                            return "Đơn vị/phòng ban " + ch.scopeName + " (" + r.hhdvId + "): Số tiền giải ngân lần này vượt KHCP khả dụng.";
                        }
                    }
                }
            }
        }
    }

    // BR-04: Giới hạn theo HĐ cho từng HHDV (cả KH-01 và KH-02)
    for (var hid in hhdvTotals) {
        var hhdvItem = itemsById[hid];
        var maxDisburse = round2(hhdvItem.amountAfterTax - hhdvItem.disbursedAmount);
        if (hhdvTotals[hid] > maxDisburse) {
            return "HHDV " + hid + ": vượt Số tiền giải ngân còn lại theo HĐ/KMS (" + hhdvTotals[hid] + " > " + maxDisburse + ").";
        }
    }

    // BR-05: Giới hạn theo KH-01 (tổng các HHDV cùng hạng mục KH)
    for (var pKey in kh01ByPlanCode) {
        var pGroup = kh01ByPlanCode[pKey];
        if (pGroup.limit !== null && pGroup.limit !== undefined && pGroup.total > pGroup.limit) {
            return "Hạng mục KH " + pKey + ": tổng Số tiền giải ngân lần này (" + pGroup.total + ") vượt KHV còn lại (" + pGroup.limit + ").";
        }
    }

    return "";
}

/**
 * Action: saveHHDVDisbursement
 * Payload: { ...payload get, planYear, rows: [{hhdvId, planType, planYear, scopeType, scopeId, amount}] }
 * Ghi đè toàn bộ dòng giải ngân của phiếu NCC hiện tại. Chỉ lưu dòng có amount > 0.
 * id = <payment.id>_<payment.vendor.id>_<stt>
 */
function saveHHDVDisbursement(input) {
    try {
        var p = parseInput(input);
        var req = resolveRequest(p);
        if (!req.requestId || !req.requestVendorId || !req.vendorId) {
            return { success: false, message: "Thiếu thông tin đề nghị / NCC." };
        }
        var resolved = resolveContractAndVendor(p, req);
        var contractId = resolved.masterContractId;
        if (!contractId) return { success: false, message: "Không xác định được HĐ/KMS của đề nghị." };

        var planYear = Number(p.planYear) || new Date().getFullYear();
        var rows = [];
        var inputRows = p.rows || [];
        for (var i = 0; i < inputRows.length; i++) {
            var src = inputRows[i];
            rows.push({
                hhdvId: str(src.hhdvId),
                planType: str(src.planType),
                scopeType: str(src.scopeType) || "HHDV",
                scopeId: str(src.scopeId) || str(src.hhdvId),
                amount: round2(num(src.amount))
            });
        }

        // Validate theo dữ liệu hiện tại trên server (không tin số FE gửi lên)
        var current = getHHDVDisbursement({
            paymentId: req.isPrepayment ? "" : req.requestId,
            paymentVendorId: req.isPrepayment ? "" : req.requestVendorId,
            prepaymentId: req.isPrepayment ? req.requestId : "",
            prepaymentVendorId: req.isPrepayment ? req.requestVendorId : "",
            contractId: contractId,
            poId: resolved.poId,
            vendorId: req.vendorId,
            planYear: planYear
        });
        if (!current.success) return current;

        var error = validateDisbursements(rows, current.data.plans);
        if (error) return { success: false, message: error };

        // Xoá dòng cũ của phiếu NCC
        var del = new SCFile(DISBURSEMENT_TABLE);
        var rcDel = del.doSelect("payment.id=" + q(req.requestId) + " and payment.vendor.id=" + q(req.requestVendorId));
        while (rcDel === RC_SUCCESS) {
            if (del.doDelete() !== RC_SUCCESS) {
                return { success: false, message: "Không xoá được dòng giải ngân cũ " + str(del["id"]) + "." };
            }
            rcDel = del.getNext();
        }

        // Ghi dòng mới
        var seq = 0;
        for (var k = 0; k < rows.length; k++) {
            var r = rows[k];
            if (r.amount <= 0) continue;
            seq++;
            var f = new SCFile(DISBURSEMENT_TABLE);
            f["id"] = req.requestId + "_" + req.requestVendorId + "_" + ("00" + seq).slice(-3);
            f["payment.vendor.id"] = req.requestVendorId;
            f["payment.id"] = req.requestId;
            f["contract.id"] = contractId;
            f["vendor.id"] = req.vendorId;
            f["hhdv.id"] = r.hhdvId;
            f["plan.type"] = r.planType;
            f["plan.year"] = String(planYear);
            f["scope.type"] = r.scopeType;
            f["scope.id"] = r.scopeId;
            f["amount"] = String(r.amount);
            var rcIns = f.doInsert();
            if (rcIns !== RC_SUCCESS) {
                return { success: false, message: "Lưu HHDV " + r.hhdvId + " thất bại (RC=" + rcIns + ")." };
            }
        }

        return { success: true, data: { saved: seq } };
    } catch (e) {
        log.error("saveHHDVDisbursement: " + e);
        return { success: false, message: "Lỗi lưu thông tin giải ngân theo HHDV: " + e };
    }
}

/**
 * Action / Helper: clearHHDVDisbursement (BR-02)
 * Xóa toàn bộ dữ liệu giải ngân HHDV của 1 đề nghị hoặc 1 dòng NCC cụ thể khi:
 *  - Người dùng đổi HĐ/KMS hoặc đổi NCC (BR-02)
 *  - Dòng NCC bị xóa khỏi đề nghị (deletePaymentVendor / deletePrepaymentVendor)
 *  - Phiếu đề nghị bị xóa / hủy
 *
 * Hỗ trợ cả 2 cách gọi:
 *  1. Direct params: clearHHDVDisbursement(requestId, requestVendorId)
 *  2. Object payload: clearHHDVDisbursement({ requestId, requestVendorId, paymentId, paymentVendorId, prepaymentId, prepaymentVendorId })
 *
 * @param {string|object} arg1 Mã đề nghị hoặc object payload
 * @param {string} [arg2] Mã dòng NCC (payment.vendor.id)
 * @returns {object} { success: boolean, deleted: number }
 */
function clearHHDVDisbursement(arg1, arg2) {
    try {
        var requestId = "";
        var requestVendorId = "";

        if (typeof arg1 === "object" && arg1 !== null) {
            var p = parseInput(arg1);
            requestId = cleanId(p.requestId || p.paymentId || p.prepaymentId || "");
            requestVendorId = cleanId(p.requestVendorId || p.paymentVendorId || p.prepaymentVendorId || "");
        } else if (typeof arg1 === "string") {
            if (arg1.indexOf("{") === 0) {
                var parsed = parseInput(arg1);
                requestId = cleanId(parsed.requestId || parsed.paymentId || parsed.prepaymentId || "");
                requestVendorId = cleanId(parsed.requestVendorId || parsed.paymentVendorId || parsed.prepaymentVendorId || "");
            } else {
                requestId = cleanId(arg1);
                requestVendorId = cleanId(arg2);
            }
        }

        if (!requestId) {
            return { success: false, message: "Thiếu requestId / paymentId." };
        }

        var f = new SCFile(DISBURSEMENT_TABLE);
        var query = "payment.id=" + q(requestId);
        if (requestVendorId) {
            query += " and (payment.vendor.id=" + q(requestVendorId) + " or vendor.id=" + q(requestVendorId) + ")";
        }

        var count = 0;
        var rc = f.doSelect(query);
        while (rc === RC_SUCCESS) {
            if (f.doDelete() === RC_SUCCESS) {
                count++;
            }
            rc = f.getNext();
        }

        log.info("clearHHDVDisbursement -> Đã xóa " + count + " dòng giải ngân cho requestId=" + requestId + (requestVendorId ? ", requestVendorId=" + requestVendorId : ""));
        return { success: true, deleted: count };
    } catch (e) {
        log.error("clearHHDVDisbursement error: " + e);
        return { success: false, message: "Lỗi xóa dữ liệu giải ngân HHDV: " + e };
    }
}

/* ============================== Workflow Hooks (BR-06, BR-07, BR-08) ============================== */

/**
 * BR-06: Điều kiện gửi duyệt.
 * Kiểm tra khi người dùng bấm Trình duyệt đề nghị:
 *  - Nếu HĐ có HHDV: bắt buộc tổng số tiền giải ngân theo HHDV = số tiền đề nghị của NCC (chênh lệch = 0).
 *  - Tái kiểm tra BR-04 và BR-05.
 * Trả về chuỗi thông báo lỗi hoặc null nếu hợp lệ.
 */
function validateSubmission(requestId, isPrepayment) {
    try {
        var resolved = resolveContractAndVendor({ requestId: requestId }, { requestId: requestId, isPrepayment: isPrepayment });
        var contractId = resolved.masterContractId;
        if (!contractId) return null;

        // Kiểm tra xem HĐ hoặc PO có HHDV không
        var fHhdv = findOne("esdHDcontractHHDV", "contract.id=" + q(contractId));
        if (!fHhdv && resolved.poId) {
            fHhdv = findOne("esdHDcontractHHDV", "contract.id=" + q(resolved.poId));
        }
        if (!fHhdv) return null; // HĐ không có HHDV thì không bắt buộc

        var vendorTable = isPrepayment ? "esdHTKTprepaymentVendor" : "esdHTKTpaymentVendor";
        var vendorFk = isPrepayment ? "prepayment.id" : "payment.id";
        var fVendor = new SCFile(vendorTable, SCFILE_READONLY);
        var rcV = fVendor.doSelect(vendorFk + "=" + q(requestId));

        while (rcV === RC_SUCCESS) {
            var requestVendorId = str(fVendor["id"]);
            var vendorId = str(fVendor["vendor.id"]);
            var reqAmount = num(fVendor["amount"] || fVendor["is.amount"] || fVendor["payable.amount"]);

            var dataRes = getHHDVDisbursement({
                requestId: requestId,
                paymentId: isPrepayment ? "" : requestId,
                prepaymentId: isPrepayment ? requestId : "",
                requestVendorId: requestVendorId,
                paymentVendorId: isPrepayment ? "" : requestVendorId,
                prepaymentVendorId: isPrepayment ? requestVendorId : "",
                vendorId: vendorId,
                contractId: contractId
            });

            if (!dataRes.success) return dataRes.message;

            var totalHHDV = 0;
            var plans = dataRes.data.plans;
            var saveRows = [];
            for (var p = 0; p < plans.length; p++) {
                for (var it = 0; it < plans[p].items.length; it++) {
                    var item = plans[p].items[it];
                    if (plans[p].planType === "KH-01") {
                        totalHHDV += item.amount;
                        if (item.amount > 0) {
                            saveRows.push({
                                hhdvId: item.hhdvId,
                                planType: "KH-01",
                                scopeType: "HHDV",
                                scopeId: item.hhdvId,
                                amount: item.amount
                            });
                        }
                    } else {
                        for (var ch = 0; ch < (item.children || []).length; ch++) {
                            var child = item.children[ch];
                            totalHHDV += child.amount;
                            if (child.amount > 0) {
                                saveRows.push({
                                    hhdvId: item.hhdvId,
                                    planType: "KH-02",
                                    scopeType: child.scopeType,
                                    scopeId: child.scopeId,
                                    amount: child.amount
                                });
                            }
                        }
                    }
                }
            }
            totalHHDV = round2(totalHHDV);

            // BR-06: Tổng số tiền giải ngân theo HHDV phải bằng Số tiền đề nghị
            if (round2(Math.abs(reqAmount - totalHHDV)) > 0.01) {
                return "Đề nghị chưa thể gửi duyệt: Tổng số tiền giải ngân theo HHDV (" + totalHHDV +
                        ") không khớp với Số tiền đề nghị của NCC (" + reqAmount + "). Tổng số tiền chênh lệch phải bằng 0.";
            }

            // Kiểm tra BR-04, BR-05
            var valErr = validateDisbursements(saveRows, plans);
            if (valErr) return "Lỗi phân bổ HHDV: " + valErr;

            rcV = fVendor.getNext();
        }

        return null;
    } catch (e) {
        log.error("validateSubmission: " + e);
        return "Lỗi kiểm tra HHDV khi gửi duyệt: " + e;
    }
}

/**
 * BR-07: Kiểm tra lại BR-04, BR-05 theo số liệu tại thời điểm phê duyệt.
 * Chặn phê duyệt khi vượt.
 */
function validateApproval(requestId, isPrepayment) {
    try {
        var resolved = resolveContractAndVendor({ requestId: requestId }, { requestId: requestId, isPrepayment: isPrepayment });
        var contractId = resolved.masterContractId;
        if (!contractId) return null;

        var fHhdv = findOne("esdHDcontractHHDV", "contract.id=" + q(contractId));
        if (!fHhdv && resolved.poId) {
            fHhdv = findOne("esdHDcontractHHDV", "contract.id=" + q(resolved.poId));
        }
        if (!fHhdv) return null;

        var vendorTable = isPrepayment ? "esdHTKTprepaymentVendor" : "esdHTKTpaymentVendor";
        var vendorFk = isPrepayment ? "prepayment.id" : "payment.id";
        var fVendor = new SCFile(vendorTable, SCFILE_READONLY);
        var rcV = fVendor.doSelect(vendorFk + "=" + q(requestId));

        while (rcV === RC_SUCCESS) {
            var requestVendorId = str(fVendor["id"]);
            var vendorId = str(fVendor["vendor.id"]);

            var dataRes = getHHDVDisbursement({
                requestId: requestId,
                paymentId: isPrepayment ? "" : requestId,
                prepaymentId: isPrepayment ? requestId : "",
                requestVendorId: requestVendorId,
                paymentVendorId: isPrepayment ? "" : requestVendorId,
                prepaymentVendorId: isPrepayment ? requestVendorId : "",
                vendorId: vendorId,
                contractId: contractId
            });

            if (!dataRes.success) return dataRes.message;

            var plans = dataRes.data.plans;
            var saveRows = [];
            for (var p = 0; p < plans.length; p++) {
                for (var it = 0; it < plans[p].items.length; it++) {
                    var item = plans[p].items[it];
                    if (plans[p].planType === "KH-01") {
                        if (item.amount > 0) {
                            saveRows.push({
                                hhdvId: item.hhdvId,
                                planType: "KH-01",
                                scopeType: "HHDV",
                                scopeId: item.hhdvId,
                                amount: item.amount
                            });
                        }
                    } else {
                        for (var ch = 0; ch < (item.children || []).length; ch++) {
                            var child = item.children[ch];
                            if (child.amount > 0) {
                                saveRows.push({
                                    hhdvId: item.hhdvId,
                                    planType: "KH-02",
                                    scopeType: child.scopeType,
                                    scopeId: child.scopeId,
                                    amount: child.amount
                                });
                            }
                        }
                    }
                }
            }

            var valErr = validateDisbursements(saveRows, plans);
            if (valErr) {
                return "Chặn phê duyệt do số liệu giải ngân theo HHDV vượt hạn mức tại thời điểm hiện tại: " + valErr;
            }

            rcV = fVendor.getNext();
        }

        return null;
    } catch (e) {
        log.error("validateApproval: " + e);
        return "Lỗi kiểm tra HHDV khi phê duyệt: " + e;
    }
}

/**
 * BR-08 / Mục 3: Cập nhật thông tin giải ngân sang các phân hệ khi phê duyệt bước cuối.
 * - Phân hệ Hợp đồng (esdHDcontractHHDV): cập nhật disbursed.amount
 * - Phân hệ Kế hoạch:
 *    + KH-01 (esdKHpurchaseItem): cộng dồn vào disbursed.amount
 *    + KH-02 (esdKHplanIndicators): cộng dồn vào amount.accounted
 */
function syncFinalApproval(requestId, isPrepayment) {
    try {
        var fDisb = new SCFile(DISBURSEMENT_TABLE, SCFILE_READONLY);
        var rc = fDisb.doSelect("payment.id=" + q(requestId));
        if (rc !== RC_SUCCESS) {
            return { success: true, count: 0 };
        }

        var hhdvSums = {}; // hhdvId -> total amount
        var kh01Sums = {}; // itemCode -> total amount
        var kh02Sums = {}; // indicatorId|scopeType|scopeId -> total amount

        while (rc === RC_SUCCESS) {
            var hhdvId = str(fDisb["hhdv.id"]);
            var amt = num(fDisb["amount"]);
            var planType = str(fDisb["plan.type"]);
            var scopeType = str(fDisb["scope.type"]);
            var scopeId = str(fDisb["scope.id"]);
            var cId = str(fDisb["contract.id"]);
            var disbYear = str(fDisb["plan.year"]);

            if (amt > 0) {
                hhdvSums[hhdvId] = round2((hhdvSums[hhdvId] || 0) + amt);

                if (planType === "KH-01") {
                    var hdItem = findOne("esdHDcontractHHDV", "id=" + q(hhdvId));
                    var khKey = hdItem ? str(hdItem["item.id"]) : "";
                    if (khKey) {
                        var key1 = khKey + "|" + disbYear;
                        kh01Sums[key1] = round2((kh01Sums[key1] || 0) + amt);
                    }
                } else if (planType === "KH-02" && scopeType !== "ALL") {
                    var hdItem2 = findOne("esdHDcontractHHDV", "id=" + q(hhdvId));
                    var rH = hdItem2 ? resolveHHDV(hdItem2, cId) : null;
                    var dxmsId = rH ? rH.dxmsId : "";
                    var dxms = dxmsId ? findOne("esdMSdxms", "id=" + q(dxmsId)) : null;
                    var indId = dxms ? str(dxms["indicator.id"] || dxms["indicator_id"]) : "";
                    if (indId) {
                        var key2 = indId + "|" + scopeType + "|" + scopeId + "|" + disbYear;
                        kh02Sums[key2] = round2((kh02Sums[key2] || 0) + amt);
                    }
                }
            }
            rc = fDisb.getNext();
        }

        // 3.1 & 3.2 Cập nhật esdHDcontractHHDV
//        for (var hid in hhdvSums) {
//            var hRec = new SCFile("esdHDcontractHHDV");
//            if (hRec.doSelect("id=" + q(hid)) === RC_SUCCESS) {
//                var oldDisbursed = num(hRec["disbursed.amount"] || hRec["undisbursed.amount"] || 0);
//                var newDisbursed = round2(oldDisbursed + hhdvSums[hid]);
//                hRec["disbursed.amount"] = String(newDisbursed);
//                hRec.doUpdate();
//            }
//        }

        // 3.3 Phân hệ Kế hoạch: KH-01 (cập nhật kèm năm kế hoạch)
        for (var k1 in kh01Sums) {
            var parts1 = k1.split("|");
            var itemCode = parts1[0];
            var pYear1 = parts1[1];
            var khItem = new SCFile("esdKHpurchaseItem");
            var qKh01 = "(item.id=" + q(itemCode) + " or id=" + q(itemCode) + ")";
            if (pYear1) qKh01 += " and year.request=" + pYear1;
            if (khItem.doSelect(qKh01) === RC_SUCCESS) {
                var oldKhv = num(khItem["disbursed.amount"] || 0);
                var newKhv = round2(oldKhv + kh01Sums[k1]);
                khItem["disbursed.amount"] = String(newKhv);
                khItem.doUpdate();
            } else if (pYear1 && khItem.doSelect("(item.id=" + q(itemCode) + " or id=" + q(itemCode) + ")") === RC_SUCCESS) {
                var oldKhvFb = num(khItem["disbursed.amount"] || 0);
                khItem["disbursed.amount"] = String(round2(oldKhvFb + kh01Sums[k1]));
                khItem.doUpdate();
            }
        }

        // 3.3 Phân hệ Kế hoạch: KH-02 (cập nhật kèm năm kế hoạch)
        for (var k2 in kh02Sums) {
            var parts2 = k2.split("|");
            var ind = parts2[0];
            var sType2 = parts2[1];
            var sId2 = parts2[2];
            var pYear2 = parts2[3];
            var qKhcp = "indicator.id=" + q(ind);
            if (sType2 === "DEPARTMENT") qKhcp += " and dept.id=" + q(sId2);
            else if (sType2 === "UNIT") qKhcp += " and unit.id=" + q(sId2);
            if (pYear2) qKhcp += " and plan.year=" + pYear2;

            var pInd = new SCFile("esdKHplanIndicators");
            if (pInd.doSelect(qKhcp) === RC_SUCCESS) {
                var oldAcc = num(pInd["amount.accounted"] || 0);
                var newAcc = round2(oldAcc + kh02Sums[k2]);
                pInd["amount.accounted"] = String(newAcc);
                pInd.doUpdate();
            } else if (pYear2) {
                var qKhcpFb = "indicator.id=" + q(ind);
                if (sType2 === "DEPARTMENT") qKhcpFb += " and dept.id=" + q(sId2);
                else if (sType2 === "UNIT") qKhcpFb += " and unit.id=" + q(sId2);
                if (pInd.doSelect(qKhcpFb) === RC_SUCCESS) {
                    var oldAccFb = num(pInd["amount.accounted"] || 0);
                    pInd["amount.accounted"] = String(round2(oldAccFb + kh02Sums[k2]));
                    pInd.doUpdate();
                }
            }
        }

        return { success: true, count: Object.keys(hhdvSums).length };
    } catch (e) {
        log.error("syncFinalApproval error: " + e);
        return { success: false, message: "Lỗi đồng bộ HHDV khi phê duyệt: " + e };
    }
}

/* ============================================================================== */
/* API / TÍCH HỢP: TRẢ DỮ LIỆU GIẢI NGÂN HHDV CHO CÁC SQUAD KHÁC                */
/* [NOTE - CẦN TRAO ĐỔI THÊM VỚI CÁC SQUAD ĐỂ CHỐT ĐẦY ĐỦ CÁC TRƯỜNG DỮ LIỆU]   */
/* ============================================================================== */

/**
 * Trả dữ liệu giải ngân HHDV cho các phân hệ/Squad khác (Squad 2 - Hợp đồng, Squad 1 - Kế hoạch, Squad 4 - XDCB...).
 *
 * Cách gọi từ ScriptLibrary:
 *   lib.ESD_HTKT_HHDV_DISBURSEMENT.getDisbursementDataForExternalSquad({
 *       contractId: "HDMS_26_GT_1211_01355", // hoặc poId
 *       vendorId: "0000000034",             // tùy chọn: lọc theo NCC
 *       hhdvId: "HM_26_4_0000361_P09325",   // tùy chọn: lọc theo 1 HHDV cụ thể
 *       statusOnlyApproved: true            // tùy chọn: true = chỉ lấy đề nghị đã duyệt/hạch toán
 *   });
 *
 *
 * @param {object|string} input Tham số truy vấn hoặc chuỗi mã HĐ/PO
 * @returns {object} { success: boolean, data: { contractId, poId, totalDisbursed, items: [...], history: [...] } }
 */
function getDisbursementDataForExternalSquad(input) {
    try {
        var p = parseInput(input);
        if (typeof input === "string") {
            p = { contractId: input };
        }
        var rawContractId = cleanId(p.contractId || p.poId || p.id || "");
        var vendorId = cleanId(p.vendorId || p.supplierId || "");
        var hhdvId = cleanId(p.hhdvId || "");
        var statusOnlyApproved = (p.statusOnlyApproved === true || p.statusOnlyApproved === "true");

        if (!rawContractId && !hhdvId) {
            return {
                success: false,
                message: "Cần cung cấp ít nhất mã Hợp đồng (contractId), Đơn đặt hàng (poId) hoặc mã HHDV (hhdvId)."
            };
        }

        // Xác định HĐ mẹ nếu input là PO
        var masterContractId = rawContractId;
        var poId = "";
        if (rawContractId) {
            var cRec = findContractOrPo(rawContractId);
            if (cRec && isPoContract(cRec)) {
                poId = rawContractId;
                masterContractId = getMasterContractIdFromPo(rawContractId, cRec) || rawContractId;
            }
        }

        // Truy vấn bảng giải ngân esdHTKTpaymentHHDVDisbursement
        var queries = [];
        if (masterContractId) {
            if (poId && poId !== masterContractId) {
                queries.push("(contract.id=" + q(masterContractId) + " or contract.id=" + q(poId) + ")");
            } else {
                queries.push("contract.id=" + q(masterContractId));
            }
        }
        if (vendorId) {
            queries.push("vendor.id=" + q(vendorId));
        }
        if (hhdvId) {
            queries.push("hhdv.id=" + q(hhdvId));
        }

        var fDisb = new SCFile(DISBURSEMENT_TABLE, SCFILE_READONLY);
        var queryStr = queries.join(" and ");
        var rc = fDisb.doSelect(queryStr);

        var history = [];
        var itemsMap = {};
        var totalDisbursed = 0;
        var statusCache = {};

        while (rc === RC_SUCCESS) {
            var curHhdvId = str(fDisb["hhdv.id"]);
            var reqId = str(fDisb["payment.id"]);
            var reqVendorId = str(fDisb["payment.vendor.id"]);
            var vId = str(fDisb["vendor.id"]);
            var amt = num(fDisb["amount"]);
            var pType = str(fDisb["plan.type"]);
            var pYear = str(fDisb["plan.year"]);
            var sType = str(fDisb["scope.type"]);
            var sId = str(fDisb["scope.id"]);

            var reqStatus = getRequestStatus(reqId, statusCache);
            var isApproved = !!DISBURSED_STATUSES[reqStatus];

            if (!statusOnlyApproved || isApproved) {
                totalDisbursed = round2(totalDisbursed + amt);

                if (!itemsMap[curHhdvId]) {
                    itemsMap[curHhdvId] = {
                        hhdvId: curHhdvId,
                        totalAmount: 0,
                        disbursementCount: 0,
                        planType: pType,
                        vendorId: vId
                    };
                }
                itemsMap[curHhdvId].totalAmount = round2(itemsMap[curHhdvId].totalAmount + amt);
                itemsMap[curHhdvId].disbursementCount++;

                history.push({
                    id: str(fDisb["id"]),
                    requestId: reqId,
                    requestVendorId: reqVendorId,
                    vendorId: vId,
                    contractId: str(fDisb["contract.id"]),
                    hhdvId: curHhdvId,
                    amount: amt,
                    planType: pType,
                    planYear: pYear,
                    scopeType: sType,
                    scopeId: sId,
                    requestStatus: reqStatus,
                    isApproved: isApproved
                });
            }

            rc = fDisb.getNext();
        }

        // Chuyển itemsMap sang mảng items
        var itemsList = [];
        for (var k in itemsMap) {
            itemsList.push(itemsMap[k]);
        }

        return {
            success: true,
            data: {
                contractId: masterContractId,
                poId: poId,
                vendorId: vendorId || undefined,
                totalDisbursed: totalDisbursed,
                itemCount: itemsList.length,
                historyCount: history.length,
                items: itemsList,
                history: history
            },
            note: "Hàm tích hợp trả data giải ngân HHDV cho các Squad khác (Squad 2 - HĐ, Squad 1 - KH, Squad 4 - XDCB). Cần trao đổi thêm để bổ sung các trường dữ liệu theo yêu cầu cụ thể của từng Squad."
        };
    } catch (e) {
        log.error("getDisbursementDataForExternalSquad error: " + e);
        return {
            success: false,
            message: "Lỗi truy xuất dữ liệu giải ngân HHDV cho external squad: " + e
        };
    }
}
