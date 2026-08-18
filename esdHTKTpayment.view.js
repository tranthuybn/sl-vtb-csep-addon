try {
    if (system.functions.filename(vars.$L_file) == "ModuleStatus") {
        lib.custom.selectWfPhaseByWorkflow(vars.$L_file.workflow);
    }

    // Custom back action
    var table = system.functions.filename(vars.$L_file);
    lib.ESD_Utils.backQueue(table);

    vars['$G.payment.id'] = vars.$L_file.id;
    vars['$G.payment.status'] = vars.$L_file.status;
    vars['$G.contract.id'] = vars.$L_file.contract_id;
} catch (e) { }

var record = vars.$L_file;

vars.$showTab = false;
vars.$descriptionReadOnly = !lib.ESD_HTKT_PAYMENT_WF.canEditInCurrenPhase(vars.$L_file);
vars.$approvalLv1ReadOnly = !lib.ESD_HTKT_PAYMENT_WF.canUpdateApprovalInfo(vars.$L_file, 'require.check.level1');
vars.$approvalLv2ReadOnly = !lib.ESD_HTKT_PAYMENT_WF.canUpdateApprovalInfo(vars.$L_file, 'require.check.level2');
vars.$hideApprovalKttc = record['created.by'] == vars.$lo_operator["contact.name"] && record['initial.role'] == 'dmms';

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
var paymentStatus = record
    ? String(record["status"] || "").trim().toLowerCase()
    : "";

vars["$showAccountingTab"] = !(
    accountingInitialRole == "dmms" &&
    accountingCurrentUser != "" &&
    accountingCurrentUser == accountingCreatedBy
);


// chỉ hiển thị tab Kết quả giao dịch khi quy trình kết thúc và phiếu không bị hủy
vars["$showAccountingResultTab"] =
    accountingCurrentPhase == "end" &&
    paymentStatus != "cancelled";

if (vars.$L_file.department) {
    var unitId = vars.$L_file.department;
    try {
        var orgUnitFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);
        if (orgUnitFile.doSelect("unit.id=\"" + unitId + "\"") == RC_SUCCESS) {
            vars.$departmentName = orgUnitFile["unit.name"];
        }
        orgUnitFile.doClose();
    } catch (eDept) { }
}

vars["$isKttc"] = false;
vars["$isDmms"] = false;

try {
    lib.ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX.loadPaymentApprovalComboBoxes();

    // 2. Lấy trực tiếp tên người dùng đang đăng nhập (Current User)
    var currentOperator = vars.$lo_operator;
    var targetUser = currentOperator
        ? String(currentOperator["contact.name"] || "").trim()
        : "";

    var currentPaymentRole =
        lib.ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX
            .getPaymentRoleByRights(targetUser);

    vars["$isKttc"] = currentPaymentRole == "kttc";
    vars["$isDmms"] = currentPaymentRole == "dmms";

    vars.$currentUserRole = currentPaymentRole; // Role của user hiện tại đang login


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
                } catch (eCloseContact) { }
            }
        }
    }
} catch (eApprovalCombo) {
    print("=== DEBUG [Error] eApprovalCombo: " + eApprovalCombo);
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

vars.$totalPrepayment = "0";            // (1) Tổng giá trị đã tạm ứng
vars.$totalPayment = "0";              // (2) Tổng giá trị đã thanh toán
vars.$remainingContractValue = "0";   // (3) Tổng giá trị HĐ/KMS còn lại

var contractId = vars.$L_file.contract_id;


if (contractId) {
    try {
        // 1. Tính "Tổng giá trị đã tạm ứng" từ bảng esdHTKTprepaymentVendor
        var totalPrepayment = "0";
        var prepaymentFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        var sqlPrepayment = 'contract.id="' + contractId + '"' +
            ' and (status="accounted")';

        if (prepaymentFile.doSelect(sqlPrepayment) === RC_SUCCESS) {
            do {
                var prepaymentVendorFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);

                if (prepaymentVendorFile.doSelect('prepayment.id="' + prepaymentFile.id + '"') === RC_SUCCESS) {
                    do {

                        totalPrepayment =
                            lib.ESD_HTKT_Utils.addStringsManual(
                                totalPrepayment,
                                prepaymentVendorFile.amount
                            );
                    } while (prepaymentVendorFile.getNext() === RC_SUCCESS);
                }

                prepaymentVendorFile.doClose();

            } while (prepaymentFile.getNext() === RC_SUCCESS);
        }

        prepaymentFile.doClose();
        // 2. Tính "Tổng giá trị đã thanh toán" (ĐNTT có trạng thái = "Đã hạch toán")
        var totalPayment = "0";
        var paymentFile = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        var sqlPayment = 'contract.id="' + contractId + '" and status="accounted"';
        if (paymentFile.doSelect(sqlPayment) === RC_SUCCESS) {
            do {
                totalPayment =
                    lib.ESD_HTKT_Utils.addStringsManual(
                        totalPayment,
                        paymentFile["total.amount.paid"]
                    );
            } while (paymentFile.getNext() === RC_SUCCESS);
        }
        paymentFile.doClose();

        // 3. Tính "Tổng giá trị HĐ/KMS còn lại" 
        var currentContractAmount = String(record["total.contract.amount"] || 0);

        var remainingContractValue =
            lib.ESD_HTKT_Utils.subtractStringsManual(
                currentContractAmount,
                totalPrepayment
            );

        remainingContractValue =
            lib.ESD_HTKT_Utils.subtractStringsManual(
                remainingContractValue,
                totalPayment
            );


        // =====================================================
        // 4. GÁN KẾT QUẢ
        // =====================================================
        vars.$totalPrepayment =
            totalPrepayment;

        vars.$totalPayment =
            totalPayment;

        vars.$remainingContractValue =
            remainingContractValue;
    } catch (eCalc) {

    }
}
vars['$showWF'] = lib.ESD_ENV_CONFIG.getENV() == "SIT";
