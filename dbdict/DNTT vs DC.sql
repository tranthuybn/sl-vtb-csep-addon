// ================================================================
// DỰ CHI (EXPENSE)
// Một dự chi có nhiều hợp đồng; mỗi hợp đồng có nhiều nhà cung cấp.
// ================================================================

Table esdHTKTexpense {
  // Thông tin chung
  "id" varchar [pk] // Mã dự chi, prefix DC
  "id.activity.vj" varchar // Mã activity trên VJ
  "status" varchar // Trạng thái phiếu dự chi
  "current.phase" varchar // Phase/step trong workflow dự chi
  "created.by" varchar // Người tạo dự chi
  "created.at" datetime // Ngày tạo dự chi
  "department" varchar // Phòng ban thực hiện
  "description" text // Nội dung dự chi

  // Thông tin người duyệt
  "initial.role" varchar // Role khởi tạo (dmms/kttc)
  "require.check.level1" bool // Yêu cầu rà soát 1
  "require.check.level2" bool // Yêu cầu rà soát 2
  "user.checker.kttc" varchar // KTTC tiếp nhận
  "user.checker.dmms" varchar // User DMMS rà soát
  "user.approver.dmms" varchar // User DMMS phê duyệt
  "user.approver.kttc" varchar // User KTTC phê duyệt
  "user.checker.final" varchar // User rà soát cấp có thẩm quyền
  "user.approver.final" varchar // User phê duyệt cấp có thẩm quyền
  "return.reason" text // Lý do trả lại
  "completed.date" datetime // Ngày hoàn thành

  // Thông tin tổng hợp; chi tiết hợp đồng nằm ở esdHTKTexpenseContract
  "unit.lv1" varchar // Mã đơn vị Khối/CN/ĐVSN
  "unit.lv2" varchar // Mã đơn vị PB thuộc Khối/CN/ĐVSN
  "executor" varchar // Người đang xử lý dự chi
  "total.expense.amount" decimal // Tổng số tiền dự chi của tất cả hợp đồng
  "total.expense" number // Tổng số món dự chi 
  "total.contract" number // Tổng số hợp đồng/KMS
  "total.vendor" number // Tổng số nhà cung cấp trên tất cả hợp đồng

}

Ref: esdHTKTexpenseContract."expense.id" > esdHTKTexpense.id

// Danh sách hợp đồng thuộc một phiếu dự chi
Table esdHTKTexpenseContract {
  "id" varchar [pk] // ID bản ghi liên kết dự chi - hợp đồng
  "expense.id" varchar // Mã dự chi
  "contract.id" varchar // Mã hợp đồng/KMS
  "contract.name" varchar // Tên hợp đồng/KMS
  "currency" varchar // Loại tiền của hợp đồng
  "contract.amount" decimal // Giá trị hợp đồng
  "expense.amount" decimal // Tổng số tiền dự chi cho hợp đồng
  "total.vendor" number // Tổng số nhà cung cấp thuộc hợp đồng
  "order" number // Thứ tự hợp đồng trên phiếu dự chi
}


// ================================================================
// DANH MỤC NHÀ CUNG CẤP
// ================================================================

Table esdHTKTVendor {
  "id" varchar [pk] // Mã nhà cung cấp
  "vendor.type" varchar // Loại nhà cung cấp (cá nhân, tổ chức...)
  "vendor.name" varchar // Tên nhà cung cấp
  "vendor.number" varchar // MST đối với tổ chức/CCCD đối với cá nhân
  "ogl.country" varchar // Quốc gia trên OGL, ví dụ VN
  "username" varchar // Người nhập - SID
  "address" varchar // Địa chỉ
  "supplier.id" varchar // ID trên esdDMSupplier
  "ogl.sync.status" bool // Trạng thái đồng bộ OGL
}

Ref: esdHTKTVendorSite."vendor.id" > esdHTKTVendor.id

Table esdHTKTVendorSite {
  "vendor.id" varchar // Mã nhà cung cấp
  "ogl.entity" varchar // SID: entity
  "ogl.site.id" varchar // SID: vendorSiteId
  "ogl.site.code" varchar // SID: vendorSiteCode
  "credit.account" varchar // Tài khoản có
  "debit.account" varchar // Tài khoản nợ
}


// ================================================================
// NHÀ CUNG CẤP - DỰ CHI
// Quan hệ: expense -> expenseContract -> expenseVendor.
// expense.contract.id là khóa kỹ thuật của esdHTKTexpenseContract.
// ================================================================

Ref: esdHTKTexpenseVendor."expense.id" > esdHTKTexpense.id
Ref: esdHTKTexpenseVendor."expense.contract.id" > esdHTKTexpenseContract.id
Ref: esdHTKTexpenseVendor."vendor.id" > esdHTKTVendor.id

Table esdHTKTexpenseVendor {
  "id" varchar [pk] // ID bản ghi nhà cung cấp thuộc hợp đồng dự chi
  "expense.id" varchar // Mã dự chi
  "expense.contract.id" varchar // ID bản ghi esdHTKTexpenseContract
  "contract.id" varchar // Mã hợp đồng/KMS, lưu đối chiếu và truy vấn
  "vendor.id" varchar // Mã nhà cung cấp
  "vendor.site.id" varchar // Mã site nhà cung cấp
  "expense.method" varchar // Phương thức chi
  "beneficiary.account" varchar // Số tài khoản thụ hưởng
  "beneficiary.name" varchar // Tên tài khoản/Họ tên người thụ hưởng
  "beneficiary.bank" varchar // Ngân hàng thụ hưởng
  "bank.name" varchar // Tên ngân hàng
  "bank.branch.code" varchar // Mã chi nhánh ngân hàng
  "exchange.rate" decimal // Tỷ giá
  "transaction.des" varchar // Nội dung giao dịch
  "identity.number" varchar // Số giấy tờ tùy thân
  "issued.date" date // Ngày cấp
  "issued.place" varchar // Nơi cấp
  "phone" varchar // Số điện thoại
  "check.name.success" bool // Trạng thái kiểm tra tên người thụ hưởng
  "currency" varchar // Loại tiền
  "expense.rate" decimal // Tỷ lệ dự chi
  "vendor.type" varchar // Loại nhà cung cấp (DN/CN)
  "ogl.sync.status" bool // Trạng thái đồng bộ OGL
  "approved.invoice.amount" decimal // Số tiền hóa đơn chấp nhận
  "refund.amount" decimal // Số tiền hoàn ứng dự kiến
  "amount" decimal // Số tiền dự chi cho nhà cung cấp trong hợp đồng
  "contract.amount" decimal // Giá trị hợp đồng
  "payable.amount" decimal // Số tiền phải trả dự kiến
  "debt.amount" decimal // Số tiền công nợ
}


// ================================================================
// HỒ SƠ ĐÍNH KÈM
// ================================================================

Ref: esdHTKTexpenseAttachment."expense.id" > esdHTKTexpense.id
Ref: esdHTKTexpenseAttachment."expense.contract.id" > esdHTKTexpenseContract.id

Table esdHTKTexpenseAttachment {
  "id" varchar [pk]
  "expense.id" varchar // Mã dự chi
  "expense.contract.id" varchar // ID hợp đồng nếu tài liệu thuộc một hợp đồng cụ thể
  "ecm.doc.id" varchar // Mã tài liệu trên ECM
  "ecm.object.id" varchar // Mã object trên ECM
  "name" varchar // Tên tập tin
  "uploaded.by" varchar // Người tải
  "size" number // Kích thước
  "doc.code" varchar // Mã tập tin
  "group.code" varchar // Mã nhóm
  "uploaded.at" datetime // Ngày tải lên
  "status" varchar // Trạng thái
  "version.no" number // Số phiên bản
  "type" varchar // Loại tài liệu
  "transaction.id" varchar // Mã giao dịch ECM
}


// ================================================================
// HÓA ĐƠN
// ================================================================

Ref: esdHTKTexpenseInvoice."expense.id" > esdHTKTexpense.id
Ref: esdHTKTexpenseInvoice."expense.contract.id" > esdHTKTexpenseContract.id
Ref: esdHTKTexpenseInvoice."expense.vendor.id" > esdHTKTexpenseVendor.id
Ref: esdHTKTexpenseInvoice."vendor.id" > esdHTKTVendor.id

Table esdHTKTexpenseInvoice {
  "id" varchar [pk] // ID bản ghi liên kết
  "expense.id" varchar // Mã dự chi
  "expense.contract.id" varchar // ID hợp đồng thuộc dự chi
  "expense.vendor.id" varchar // ID nhà cung cấp thuộc hợp đồng dự chi
  "invoice.id" varchar // Mã hóa đơn liên quan
  "vendor.id" varchar // Mã nhà cung cấp
  "deduction.amount" decimal // Số tiền khấu trừ
  "deduction.rate" decimal // Tỷ lệ khấu trừ
  "deduction.type" varchar // Loại khấu trừ
}


// ================================================================
// THÔNG TIN YÊU CẦU HẠCH TOÁN
// ================================================================

Ref: esdHTKTexpenseAccountingInformation."expense.id" > esdHTKTexpense.id
Ref: esdHTKTexpenseAccountingInformation."expense.contract.id" > esdHTKTexpenseContract.id
Ref: esdHTKTexpenseAccountingInformation."expense.vendor.id" > esdHTKTexpenseVendor.id
Ref: esdHTKTexpenseAccountingInformation."vendor.id" > esdHTKTVendor.id

Table esdHTKTexpenseAccountingInformation {
  "request.id" varchar [pk] // Mã yêu cầu hạch toán, tự sinh và kiểm tra trùng
  "expense.id" varchar // Mã dự chi
  "expense.contract.id" varchar // ID hợp đồng thuộc dự chi
  "expense.vendor.id" varchar // ID nhà cung cấp thuộc hợp đồng dự chi
  "expense.entry.id" varchar // Mã bút toán dự chi
  "vendor.id" varchar // Mã nhà cung cấp
  "type" varchar // Loại hạch toán (OGL/Core)
  "data" varchar // Dữ liệu hạch toán
  "status" varchar // Trạng thái hạch toán
  "message" varchar // Chi tiết trạng thái
  "response" varchar // Dữ liệu trả về
}


// ================================================================
// BÚT TOÁN HẠCH TOÁN
// ================================================================

Ref: esdHTKTexpenseEntry."expense.id" > esdHTKTexpense.id
Ref: esdHTKTexpenseEntry."expense.contract.id" > esdHTKTexpenseContract.id
Ref: esdHTKTexpenseEntry."expense.vendor.id" > esdHTKTexpenseVendor.id
Ref: esdHTKTexpenseEntry."vendor.id" > esdHTKTVendor.id
Ref: esdHTKTexpenseEntry."accounting.request.id" > esdHTKTexpenseAccountingInformation."request.id"

Table esdHTKTexpenseEntry {
  "id" varchar [pk] // Mã bút toán
  "expense.id" varchar // Mã dự chi
  "expense.contract.id" varchar // ID hợp đồng thuộc dự chi
  "expense.vendor.id" varchar // ID nhà cung cấp thuộc hợp đồng dự chi
  "entry.type" varchar // Loại tài khoản
  "ledger.type" varchar // Loại hạch toán
  "account.type" varchar // Nợ/Có
  "account.number" varchar // Số tài khoản
  "account.name" varchar // Tên tài khoản
  "branch" varchar // Phòng giao dịch
  "department" varchar // Phòng ban liên quan
  "order" number // Số thứ tự
  "currency" varchar // Loại tiền
  "description" text // Diễn giải chi tiết
  "vendor.id" varchar // Mã nhà cung cấp
  "type" varchar // Loại bút toán (AP/GL)
  "accounting.request.id" varchar // Mã request hạch toán
  "transaction.code" varchar // Mã giao dịch
  "ref.id" varchar // Mã tham chiếu
  "ap.code" varchar // Mã AP
  "amount" decimal // Số tiền hạch toán
}


// ================================================================
// PHÂN CHIA CHI PHÍ
// ================================================================

Ref: esdHTKTexpenseCostDivision."expense.id" > esdHTKTexpense.id
Ref: esdHTKTexpenseCostDivision."expense.contract.id" > esdHTKTexpenseContract.id
Ref: esdHTKTexpenseCostDivision."expense.vendor.id" > esdHTKTexpenseVendor.id
Ref: esdHTKTexpenseCostDivision."vendor.id" > esdHTKTVendor.id

Table esdHTKTexpenseCostDivision {
  "id" varchar [pk] // Mã phân chia chi phí
  "expense.id" varchar // Mã dự chi
  "expense.contract.id" varchar // ID hợp đồng thuộc dự chi
  "expense.vendor.id" varchar // ID nhà cung cấp thuộc hợp đồng dự chi
  "entry.type" varchar // Loại chi phí
  "account.type" varchar // Loại tài khoản
  "account.number" varchar // Số tài khoản
  "account.name" varchar // Tên tài khoản
  "department" varchar // Mã phòng ban
  "department.name" varchar // Tên phòng ban
  "vendor.id" varchar // Mã nhà cung cấp
  "unit.id" varchar // Mã đơn vị
  "unit.name" varchar // Tên đơn vị
  "transaction.code" varchar // Mã giao dịch
  "transaction.name" varchar // Tên giao dịch
  "amount" decimal // Số tiền
}
