
// Bảng đề nghị thanh toán/dự chi
Table esdHTKTpayment {
  // thông tin chung phiếu
  "transaction.type" varchar // Loại giao dịch (Thanh toán/Dự chi)
  "department" varchar // Phòng ban thực hiện
  "description" text // Nội dung thực hiện/giao dịch
  "created.at" datetime // Ngày tạo đề nghị
  "created.by" varchar // Người tạo đề nghị
  "completed.date" datetime // Ngày hoàn thành

  // thông tin bên hợp đồng : get data bên hđ set vào filed phiếu . logic giống bên Tạm ứng
  "currency" varchar // loại tiền

  // logic record
  "contract.id" varchar // mã Hợp đồng/KMS
  "contract.name" varchar // Tên mã Hợp đồng/KMS
  "status" varchar // trạng thái phiếu
  "id" varchar [pk] // Mã đề nghị thanh toán/dự chi
  "current.phase" varchar // phase/step in workflow 
   // Tab thông tin người duyệt
  "initial.role" varchar // role khởi tạo (dmms/kttc)
  "require.check.level1" bool // Yêu cầu rà soát 1
  "require.check.level2" bool // Yêu cầu rà soát 2
  "user.checker.kttc" varchar // KTTC tiếp nhận
  "user.checker.dmms" varchar // user DMMS rà soát
  "user.approver.dmms" varchar // user DMMS phê duyệt
  "user.approver.kttc" varchar // user KTTC phê duyệt
  "user.checker.final" varchar // user rà soát cấp có thẩm quyền
  "user.approver.final" varchar // user phê duyệt cấp có thẩm quyền 
  "unit.lv1" varchar // Mã đơn vị Khối/CN/DVSN
  "unit.lv2" varchar // Mã đơn vị PB thuộc Khối/CN/ĐVSN
  "executor.payment" varchar // Người đang xử lý

  "approved.invoice.amount" decimal // Tổng số tiền hóa đơn chấp nhận
  "total.prepayment.amount" decimal  // Tổng Số tiền tạm ứng
  "total.amount.paid" decimal  // Tổng Số tiền thanh toán/dự chi
}



// Table commom (dùng chung với bên tạm ứng)
// Bảng nhà cung cấp
Table esdHTKTVendor {
  id varchar [pk] // Mã nhà cung cấp
  "vendor.type" varchar // Loại nhà cung cấp (cá nhân, tổ chức…)
  "vendor.name" varchar // Tên nhà cung cấp
  "vendor.number" varchar // Mã số thuế đối với tổ chức/cccd đối với cá nhân
  "ogl.country" varchar // VN
  // ogl.vendor.id varchar // mã nhà cung cấp trên ogl - SID: vendorId (bỏ do OGL ko trả về nữa)
  username varchar // người nhập - SID
  address varchar // địa chỉ
  "supplier.id" varchar // id trên esdDMSupplier
  "ogl.sync.status" boolean // trạng thái đồng bộ
}

Ref: esdHTKTVendorSite."vendor.id" > esdHTKTVendor.id
// site nhà cung cấp
Table esdHTKTVendorSite {
  "vendor.id" varchar // Mã nhà cung cấp
  "ogl.entity" varchar // SID : entity
  "ogl.site.id" varchar // SID : vendorSiteId
  "ogl.site.code" varchar // SID : vendorSiteCode
  "credit.account" varchar // Tài khoản có - SID : creditAccount
  "debit.account" varchar // Tài khoản nợ - SID : debitAccount
}


// Bảng hồ sơ đính kèm 
Ref: esdHTKTpaymentAttachment."payment.id" > esdHTKTpayment.id
Table esdHTKTpaymentAttachment {
  id varchar [pk]
  "payment.id" varchar  // Mã đề nghị thanh toán
  "ecm.doc.id" varchar // Mã tài liệu trên ecm
  "ecm.object.id" varchar // Mã tài liệu trên ecm
  name varchar // Tên tập tin
  "uploaded.by" varchar // Người tải
  size number // Kích thước
  "doc.code" varchar // Mã tập tin
  "group.code" varchar // mã nhóm
}


// Bảng hóa đơn - thanh toán / TT + lấy từ nhà CC <-> Hóa đơn
Table esdHTKTpaymentInvoice {
  "payment.id" varchar  // Mã đề nghị thanh toán
  "invoice.id" varchar // Mã hóa đơn liên quan
  "deduction.amount" decimal // số tiền khấu trừ
  "deduction.rate" decimal // tỷ lệ khấu trừ
  "deduction.type" varchar // loại khấu trừ
}


// Bảng dữ liệu hạch toán 
Table esdHTKTaccountingInformation {
  "request.id" varchar [pk] // mã yêu cầu hạch toán, tự sinh, check trùng
  "payment.id" varchar  // Mã đề nghị thanh toán
  "payment.entry.id" varchar // mã bảng entry
  "vendor.id" varchar // mã nhà cung cấp
  type varchar // loại hạch toán (OGL/Core)
  data varchar // dữ liệu hạch toán
  status varchar // trạng thái hạch toán (Khởi tạo/Hạch toán thành công/Hạch toán lỗi)
  message varchar // chi tiết trạng thái
  response varchar // dữ liệu trả về - có thể cần bóc tách mã AP bút toán
}


// Bảng Liên Kết/ Tham Chiếu 
// vì nghiệp vụ phực tạp nên ae đánh giá có thể tách riêng phần này
Ref: esdHTKTpaymentVendor."payment.id" > esdHTKTpayment.id
Ref: esdHTKTpaymentVendor."vendor.id" > esdHTKTVendor.id

// Bảng nhà cung cấp - thanh toán
Table esdHTKTpaymentVendor {
  // logic record
  id varchar // id bảng
  "payment.id" varchar // Mã đề nghị thanh toán
  "vendor.id" varchar  // Mã nhà cung cấp
  "vendor.site.id" varchar // Mã site nhà cung cấp
  "vendor.type" varchar // Loại nhà CC (DN/CN)
  amount decimal // Số tiền thanh toán
  "approved.invoice.amount" decimal // Số tiền hóa đơn chấp nhận
  "refund.amount" decimal // Số tiền hoàn ứng lần này
  currency varchar // Loại tiền (VND, USD…)
  "payment.method" varchar // Phương thức thanh toán (chuyển khoản, tiền mặt…)
  "beneficiary.account" varchar // Số tài khoản thụ hưởng
  "beneficiary.name" varchar // Tên tài khoản thụ hưởng/Họ tên người thụ hưởng
  "beneficiary.bank" varchar // Ngân hàng thụ hưởng
  "transaction.des" varchar // Nội dung giao dịch
  "identity.number" varchar // Số giấy tờ tùy thân
  "issued.date" date // ngày cấp
  "issued.place" varchar // nơi cấp
  phone varchar // số điện thoại
  // Thông tin giá trị 
  // remaining.contract.amount varchar // số tiền còn lại HĐ
}

Ref: esdHTKTpaymentInvoice."payment.id" > esdHTKTpayment.id
 // Ref: PrepaymentInvoice.invoice.id > invoice.id

Ref: esdHTKTpaymentEntry."payment.id" > esdHTKTpayment.id
Ref: esdHTKTpaymentEntry."vendor.id" > esdHTKTVendor.id




// bảng dữ liệu hạch toán dự kiến - thanh toán
Table esdHTKTpaymentEntry {
  id varchar [pk] // mã
  "payment.id" varchar  // Mã đề nghị thanh toán
  "entry.type" varchar // Loại tài khoản (ví dụ: TK chi phí, TK KH, TK Thuế, TK TƯ, TK phải trả )
  "ledger.type" varchar // Loại hạch toán (Prepayment, Standard…)
  "account.type" varchar // (Nợ, Có)
  "account.number" varchar // Số tài khoản
  "account.name" varchar // Tên tài khoản
  branch varchar // Phòng giao dịch
  department varchar // Phòng ban liên quan
  amount decimal // Số tiền hạch toán
  currency varchar // Loại tiền
  "description" text // Diễn giải chi tiết
  "vendor.id" varchar  // Mã nhà cung cấp liên quan
  "vendor.site.code" varchar // mã site nhà cung cấp
  "type" varchar // loại bút toán (AP, GL)
  "order" number // số thứ tự
  "ref.id" varchar // mã tham chiếu (VD:  Nếu entry.type là TƯ thì ref.id là mã ĐNTƯ, ...)
  "accounting.request.id" varchar // mã request Hạch toán
}

Ref: esdHTKTaccountingInformation."payment.id" > esdHTKTpayment.id
Ref: esdHTKTaccountingInformation."vendor.id" > esdHTKTVendor.id
Ref: esdHTKTpaymentEntry."accounting.request.id" > esdHTKTaccountingInformation."request.id"
// Ref: esdHTKTaccountingInformation.prepayment.entry.id > PrepaymentEntry.id


// Bảng phân chia chi phí
Table esdHTKTpaymentCostDivision {
  "id" varchar [pk] // mã
  "payment.id" varchar  // Mã đề nghị thanh toán
  "type" varchar  // Loại chi phí
  "account.type" varchar // Loại tài khoản (tài sản, nợ phải trả…)
  "account.number" varchar // Số tài khoản
  "account.name" varchar // Tên tài khoản
  "department" varchar // Mãphòng ban liên quan
  "department.name" varchar //Tên phòng ban liên quan
  "amount.before.tax" decimal // Số tiền trước thuế
  "amount.after.tax" decimal // Số tiền sau thuế
  "description" text // Diễn giải chi tiết
  "vendor.id" varchar  // Mã nhà cung cấp liên quan
}





