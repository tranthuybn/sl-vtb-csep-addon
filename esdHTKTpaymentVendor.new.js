try {
  if (system.functions.filename(vars.$L_file) == "ModuleStatus") {
    lib.custom.selectWfPhaseByWorkflow(vars.$L_file.workflow);
  }

  //custom back action
  var table = system.functions.filename(vars.$L_file);
  lib.ESD_Utils.backQueue(table);
} catch (e) { }

vars.$canEditSite = false;

// Chỉ gán false nếu biến này CHƯA TỪNG ĐƯỢC TẠO (lần đầu vào màn hình)
if (vars.$isSupplierDisabled === undefined || vars.$isSupplierDisabled === null || vars.$isSupplierDisabled === "null") {
  vars.$isSupplierDisabled = false;
}

vars.$L_mode = (vars.$isSupplierDisabled === true || vars.$isSupplierDisabled === "true") ? "view" : "add";

// Nếu lần đầu vào màn này và user chưa chọn Phương thức thanh toán thì để mặc định là "CHUYENKHOAN"
if (!vars.$L_file['payment.method']) {
  vars.$L_file['payment.method'] = 'CHUYENKHOAN';
}


// 1. Lấy payment.id từ biến $G.payment.id (hoặc fallback về $L.file nếu cần)
var paymentId = vars.$L_file['payment.id'] || vars.$G_payment_id;
if (!paymentId && vars.$L_file && vars.$L_file.payment_id != null) {
  paymentId = vars.$L_file.payment_id;
}
vars.$L_file['payment.id'] = paymentId;

// Chỉ thực hiện truy vấn nếu có paymentId
if (paymentId || vars.$L_file['payment.id']) {
  var usedSupplierIds = {};
  var paymentVendorFile = new SCFile("esdHTKTpaymentVendor");
  var rc = paymentVendorFile.doSelect('payment.id="' + paymentId + '"');

  while (rc == RC_SUCCESS) {
    var vId = paymentVendorFile["vendor.id"];

    // Nếu vId rỗng, nó sẽ không vào block if này -> không thêm vào danh sách lọc
    if (vId != null && vId != "") {
      var vendorFile = new SCFile("esdHTKTvendor");
      var rcVendor = vendorFile.doSelect('id="' + vId + '"');

      if (rcVendor == RC_SUCCESS) {
        var sId = vendorFile["supplier.id"];
        // Chỉ thêm vào danh sách loại trừ nếu có supplier.id hợp lệ
        if (sId != null && sId != "") {
          usedSupplierIds[sId] = true;
        }
      }
    }
    rc = paymentVendorFile.getNext();
  }
  try {
    if (paymentVendorFile) paymentVendorFile.doClose();
  } catch (e) { }
  // BƯỚC B: Query lấy NCC từ Hợp đồng và lọc
  arrVendors = [];
  var itemFile = new SCFile("esdHTKTpayment");

  var itemQuery =
    `select htktPayment.contract.id as contract.id, hdVendor.supplier.id as supplier.id, hdVendor.supplier.name as supplier.name,` +
    ` hdVendor.payment.method as payment.method, hdVendor.remaining.amount as remaining.amount,` +
    ` dmVendor.tax.code as tax.code,htktPayment.description as description, dmVendor.address as address, dmVendor.type as type,` +
    ` htktPayment.unit.lv1 as unit.lv1` + // Lấy unit.lv1 từ phiếu cha
    ` from esdHTKTpayment htktPayment` +
    ` JOIN esdHDcontractSupplier hdVendor ON (htktPayment.contract.id = hdVendor.contract.id)` +
    ` JOIN esdDMSupplier dmVendor ON (hdVendor.supplier.id = dmVendor.id)` +
    ` where htktPayment.id = "` +
    paymentId +
    `"`;

  var rcItem = itemFile.doSelect(itemQuery);

  while (rcItem == RC_SUCCESS) {
    // Lưu lại unit.lv1 vào biến $L.file để dùng khi bấm Lưu
    if (itemFile["unit.lv1"]) {
      vars.$L_file['unit.lv1'] = itemFile["unit.lv1"];
    }

    var currentSupplierId = itemFile["supplier.id"];
    var currentContractId = itemFile['contract.id'];

    // Lấy thông tin bảo lãnh từ kết quả query
    // Lưu ý: Tên field trong itemFile sẽ tương ứng với các alias đã đặt trong SELECT
    if (!usedSupplierIds[currentSupplierId]) {
      // TÍNH SỐ TIỀN CÒN LẠI CỦA NHÀ CUNG CẤP

      var initialRemainingAmount = String(itemFile['remaining.amount'] || "0");
      var finalRemainingAmount = initialRemainingAmount;

      // Tổng tiền đã tạm ứng của NCC trong các phiếu
      var totalApprovedAmount = "0";
      var hasApprovedTicket = false;
      var checkFile =
        new SCFile("esdHTKTprepaymentVendor");

      var checkQuery =
        `select pv.amount as amount ` +
        `from esdHTKTprepaymentVendor pv ` +
        `join esdHTKTprepayment p ` +
        `on (pv.prepayment.id = p.id) ` +
        `join esdHTKTvendor v ` +
        `on (pv.vendor.id = v.id) ` +
        `where p.contract.id = "` +
        currentContractId +
        `" and v.supplier.id = "` +
        currentSupplierId +
        `" and (p.status = "accounted")`;

      var rcCheck =
        checkFile.doSelect(checkQuery);

      while (rcCheck == RC_SUCCESS) {

        hasApprovedTicket = true;

        totalApprovedAmount =
          lib.ESD_HTKT_Utils.addStringsManual(
            totalApprovedAmount,
            String(checkFile["amount"] || "0")
          );

        rcCheck =
          checkFile.getNext();
      }

      try {
        if (checkFile) {
          checkFile.doClose();
        }
      } catch (e) { }

      // Tổng tiền đã thanh toán của NCC trong các phiếu
      var totalPaidAmount = "0";
      var hasPaidTicket = false;
      var paymentCheckFile =
        new SCFile("esdHTKTpaymentVendor");

      var paymentCheckQuery =
        `select pv.amount as amount ` +
        `from esdHTKTpaymentVendor pv ` +
        `join esdHTKTpayment p ` +
        `on (pv.payment.id = p.id) ` +
        `join esdHTKTvendor v ` +
        `on (pv.vendor.id = v.id) ` +
        `where p.contract.id = "` +
        currentContractId +
        `" and v.supplier.id = "` +
        currentSupplierId +
        `" and (p.status = "accounted")`;

      var rcPaymentCheck =
        paymentCheckFile.doSelect(paymentCheckQuery);

      while (rcPaymentCheck == RC_SUCCESS) {

        hasPaidTicket = true;

        totalPaidAmount =
          lib.ESD_HTKT_Utils.addStringsManual(
            totalPaidAmount,
            String(paymentCheckFile["amount"] || "0")
          );

        rcPaymentCheck =
          paymentCheckFile.getNext();
      }

      try {
        if (paymentCheckFile) {
          paymentCheckFile.doClose();
        }
      } catch (e) { }


      // ================================================================
      // Số tiền còn lại =
      // Tổng tiền ban đầu - Tổng tiền đã tạm ứng - Tổng tiền đã thanh toán
      // ================================================================
      if (hasApprovedTicket) {
        finalRemainingAmount =
          lib.ESD_HTKT_Utils.subtractStringsManual(
            initialRemainingAmount,
            totalApprovedAmount
          );
      }

      if (hasPaidTicket) {
        finalRemainingAmount =
          lib.ESD_HTKT_Utils.subtractStringsManual(
            finalRemainingAmount,
            totalPaidAmount
          );
      }

      arrVendors.push({
        "supplier.id": currentSupplierId,
        "supplier.name": itemFile["supplier.name"],
        "payment.method": itemFile["payment.method"],
        "remaining.amount": finalRemainingAmount,
        "tax.code": itemFile["tax.code"],
        "bank": itemFile["bank"],
        "expire.date": itemFile["expire.date"],
        "address": itemFile["address"],
        "type": itemFile["type"]
      });
      usedSupplierIds[currentSupplierId] = true;
    }
    rcItem = itemFile.getNext();
  }
  try {
    if (itemFile) itemFile.doClose();
  } catch (e) { }

  // 4. Set vào biến cho droplist và các biến bảo lãnh (lấy dòng đầu tiên nếu có)
  vars.$supplierdisplays = arrVendors.map((x) => x["supplier.name"]);
  vars.$suppliervalues = arrVendors.map((x) => x["supplier.id"]);
} else {
  vars.$supplierdisplays = [];
  vars.$suppliervalues = [];
}

// droplist ngan hang thu huong
var bankList = lib.ESD_HTKT_ACCOUNTING_UTILS.getBankDroplist();
vars.$bankcode = bankList.map(b => `${b.code}|${b.citad}|${b.napas}`);
vars.$bankname = bankList.map(b => b.name);

