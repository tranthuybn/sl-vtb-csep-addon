try {
    if (system.functions.filename(vars.$L_file) == "ModuleStatus") {
        lib.custom.selectWfPhaseByWorkflow(vars.$L_file.workflow);
    }
    
    // Custom back action
    var table = system.functions.filename(vars.$L_file);
    lib.ESD_Utils.backQueue(table);
    
    vars['$G.prepayment.id'] = vars.$L_file.id;
    vars['$G.prepayment.status'] = vars.$L_file.status;
    vars['$G.contract.id'] = vars.$L_file.contract_id;
} catch (e) {}

var record = vars.$L_file;

vars.$descriptionReadOnly = !lib.ESD_HTKT_PREPAYMENT_WF.canEditInCurrenPhase(vars.$L_file);
vars.$approvalLv1ReadOnly = !lib.ESD_HTKT_PREPAYMENT_WF.canUpdateApprovalInfo(vars.$L_file, 'require.check.level1');
vars.$approvalLv2ReadOnly = !lib.ESD_HTKT_PREPAYMENT_WF.canUpdateApprovalInfo(vars.$L_file, 'require.check.level2');
vars.$hideApprovalKttc = record['created.by'] == vars.$lo_operator["contact.name"] && record['initial.role'] == 'dmms';

// trưởng thêm: chỉ ẩn tab hạch toán với chính người ĐMMS khởi tạo phiếu
var accountingCurrentUser = vars.$lo_operator
    ? String(vars.$lo_operator["contact.name"] || "").trim().toLowerCase()
    : "";
var accountingInitialRole = record
    ? String(record["initial.role"] || "").trim().toLowerCase()
    : "";
var accountingCreatedBy = record
    ? String(record["created.by"] || "").trim().toLowerCase()
    : "";
var accountingCurrentPhase = record
    ? String(record["current.phase"] || "").trim().toLowerCase()
    : "";
var prepaymentStatus = record
    ? String(record["status"] || "").trim().toLowerCase()
    : "";

vars["$showAccountingTab"] = !(
    accountingInitialRole == "dmms" &&
    accountingCurrentUser != "" &&
    accountingCurrentUser == accountingCreatedBy
);

// trưởng thêm: chỉ hiển thị tab Kết quả giao dịch khi quy trình kết thúc và phiếu không bị hủy
vars["$showAccountingResultTab"] =
    accountingCurrentPhase == "end" &&
    prepaymentStatus != "cancelled";

//if (vars.$L_file.department) {
//    var unitId = vars.$L_file.department;
//    var orgUnitFile = new SCFile("esdQTorgUnit");
//    
//    if (orgUnitFile.doSelect("unit.id=\"" + unitId + "\"") == RC_SUCCESS) {
//        vars.$departmentName = orgUnitFile["unit.name"];
//    }
//}
// =========================================================================
// XỬ LÝ LẤY TÊN PHÒNG BAN THÔNG THƯỜNG
// =========================================================================
vars.$departmentName = "";
if (vars.$L_file.department) {
    var unitId = vars.$L_file.department;
    try {
        var orgUnitFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);
        if (orgUnitFile.doSelect("unit.id=\"" + unitId + "\"") == RC_SUCCESS) {
            vars.$departmentName = orgUnitFile["unit.name"];
        }
        orgUnitFile.doClose();
    } catch (eDept) {}
}

vars.$unitLv1Name = ""; // Khởi tạo biến lưu tên Khối/CN hiển thị lên UI
var creatorName = vars.$L_file["created.by"];

if (creatorName) {
    try {
        var contactFileLv1 = new SCFile("contacts", SCFILE_READONLY);
        var safeCreatorName = String(creatorName).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        var rcContactLv1 = contactFileLv1.doSelect('contact.name="' + safeCreatorName + '"');
        
        if (rcContactLv1 == RC_SUCCESS) {
            var creatorLv1Id = String(contactFileLv1["lv1.id"] || contactFileLv1.lv1_id || "").trim();
            
            // Nếu có lv1.id, chọc tiếp vào bảng esdQTorgUnit để lấy tên
            if (creatorLv1Id) {
                var orgUnitLv1File = new SCFile("esdQTorgUnit", SCFILE_READONLY);
                var safeCreatorLv1Id = creatorLv1Id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                
                if (orgUnitLv1File.doSelect('unit.id="' + safeCreatorLv1Id + '"') == RC_SUCCESS) {
                    vars.$unitLv1Name = orgUnitLv1File["unit.name"];
                }
                orgUnitLv1File.doClose();
            }
        }
        contactFileLv1.doClose();
    } catch (eLv1) {}
}
// trưởng thêm: xác định quyền hiển thị tab theo người đang đăng nhập
vars["$isKttc"] = false;
vars["$isDmms"] = false;

try {
lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX.loadPrepaymentApprovalComboBoxes(vars.$L_file);
    // 2. Lấy trực tiếp tên người dùng đang đăng nhập (Current User)
    var currentOperator = vars.$lo_operator;
    var targetUser = currentOperator
        ? String(currentOperator["contact.name"] || "").trim()
        : "";

    // trưởng thêm
    var currentPrepaymentRole =
        lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX
            .getPrepaymentRoleByRights(targetUser);

    vars["$isKttc"] = currentPrepaymentRole == "kttc";
    vars["$isDmms"] = currentPrepaymentRole == "dmms";

    var unitLv1 = "";
    var unitLv2 = "";

    // 3. Truy vấn bảng contacts theo user đang đăng nhập
    if (targetUser) {
        var contactFile = null;
        try {
            contactFile = new SCFile("contacts", SCFILE_READONLY);
            var safeUser = (targetUser == null ? "" : String(targetUser)).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            var rcContact = contactFile.doSelect('contact.name="' + safeUser + '"');

            if (rcContact == RC_SUCCESS) {
                unitLv1 = String(contactFile["lv1.id"] || contactFile.lv1_id || "").trim();
                unitLv2 = String(contactFile["lv2.id"] || contactFile.lv2_id || "").trim();
            }
        } catch (eContact) {
        } finally {
            if (contactFile) {
                try {
                    contactFile.doClose();
                } catch (eCloseContact) {}
            }
        }
    }
} catch (eApprovalCombo) {
    vars["$L.kttc.ids"] = [];
    vars["$L.kttc.names"] = [];
    vars["$L.dmms.ids"] = [];
    vars["$L.dmms.rs1"] = [];
    vars["$L.dmms.approval1.ids"] = [];
    vars["$L.dmms.approval1"] = [];
    vars["$L.kttc.approve2.ids"] = [];
    vars["$L.kttc.approve2"] = [];
    vars["$L.kttc.check2.ids"] = [];
    vars["$L.kttc.check2"] = [];
    vars["$L.approve.all.ids"] = [];
    vars["$L.approve.all"] = [];
    vars.$isKttc = false;
    vars.$isDmms = false;
}

vars.$totalPrepayment = "0";
vars.$totalPayment = "0";
vars.$remainingContractValue = "0";
vars.$totalPrepaymentAndPayment = "0"; 

var contractId = vars.$L_file.contract_id;

if (contractId) {
    try {
        var totalPrepaymentAndPayment = "0";
        
        // =====================================================
        // 1. LẤY TỔNG GIÁ TRỊ ĐÃ TẠM ỨNG & THANH TOÁN TỪ HỢP ĐỒNG
        // =====================================================
        var contractFile = new SCFile("esdHDcontract", SCFILE_READONLY);
        
        // Chú ý: Sửa 'id' thành tên trường khóa chính thực tế của bảng esdHDcontract (vd: 'contract.id') nếu cần.
        var sqlContract = 'id="' + contractId + '"'; 
        
        if (contractFile.doSelect(sqlContract) === RC_SUCCESS) {
            var rawTotalPaid = contractFile["total.paid.amount"];
            
            // Xử lý an toàn: Nếu khác null và không phải chuỗi rỗng thì mới gán, ngược lại giữ nguyên "0"
            if (rawTotalPaid != null && String(rawTotalPaid).trim() !== "") {
                totalPrepaymentAndPayment = String(rawTotalPaid).trim();
            }
        }
        contractFile.doClose();

        // =====================================================
        // 2. GIÁ TRỊ HĐ/KMS CÒN LẠI
        // =====================================================
        var currentContractAmount = String(vars.$L_file.contract_amount || "0");

        var remainingContractValue = lib.ESD_HTKT_Utils.subtractStringsManual(
            currentContractAmount,
            totalPrepaymentAndPayment
        );

        // =====================================================
        // 3. GÁN KẾT QUẢ
        // =====================================================
        vars.$totalPrepaymentAndPayment = totalPrepaymentAndPayment;
        vars.$remainingContractValue = remainingContractValue;

    } catch (eCalc) {
        print("ERROR CALCULATE MONEY: " + eCalc);
    }
}

vars['$showWF'] = lib.ESD_ENV_CONFIG.getENV() == "SIT";