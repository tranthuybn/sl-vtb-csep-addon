// =========================================================================
// THỰC HIỆN VALIDATE TRƯỚC TIÊN
// =========================================================================
var errorMss = lib.ESD_HTKT_EXPENSE_VENDOR.validateVendorAndPaymentDetails(
  vars.$L_file
);

if (errorMss && errorMss.length > 0) {
  vars.$G_hasError = true;
  vars.$G_errMsg = "Dữ liệu chưa hợp lệ:\n - " + errorMss.join("\n - ");
  vars.$L_action = "do nothing";
} else {
  vars.$G_hasError = false;
  vars.$G_errMsg = "";

  var supplierId = String(vars.$supplierId || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  var taxCode = String(vars.$taxCode || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  var itemVendor = new SCFile("esdHTKTvendor");
  var vendorId = null;

  try {
    var queryVendor =
      'vendor.number="' + taxCode +
      '" and supplier.id="' + supplierId + '"';

    var result = itemVendor.doSelect(queryVendor);

    if (result === RC_SUCCESS) {
      vendorId = itemVendor["id"];
    } else {
      var generatedVendorId = new SCDatum();
      var numberRc = new SCDatum();
      numberRc.setValue(-1);

      system.functions.rtecall(
        "getnumber",
        numberRc,
        generatedVendorId,
        "esdHTKTvendor"
      );

      if (String(numberRc.getText()) !== "0" || !generatedVendorId.getText()) {
        throw new Error("Không sinh được mã nhà cung cấp.");
      }

      vendorId = generatedVendorId.getText();

      itemVendor["id"] = vendorId;
      itemVendor["vendor.name"] = vars.$supplierName || "";
      itemVendor["vendor.number"] = vars.$taxCode || "";
      itemVendor["username"] = vars.$lo_operator["name"];
      itemVendor["ogl.country"] = "VN";
      itemVendor["address"] = vars.$supplierAddress || "";
      itemVendor["supplier.id"] = vars.$supplierId || "";

      var addRc = itemVendor.doAction("add");
      if (addRc !== RC_SUCCESS) {
        throw new Error(
          "Không tạo được nhà cung cấp. Code: " +
          addRc +
          ", message: " +
          itemVendor.getMessages()
        );
      }
    }

    if (vars.$amount == null || vars.$amount === "") {
      vars.$amount = "0";
    }

    vars.$L_file["amount"] = vars.$amount;
    vars.$L_file["vendor.id"] = vendorId;
    vars.$L_file["vendor.site.id"] = vars.$oglSiteCode;
    vars.$L_file["currency"] = vars.$currency;
  } finally {
    try {
      itemVendor.doClose();
    } catch (closeError) {}
  }
}