// ================================================================
// DASHBOARD HẠCH TOÁN KẾ TOÁN
// Nguồn: esdHTKTprepayment và esdHTKTpayment
// ================================================================
//
// Quy ước phạm vi dữ liệu dùng chung cho cả ba phần Dashboard:
// - Tất cả số liệu được tổng hợp và lọc theo entity.code.
// - entity.code phải được xác định từ đơn vị của đề nghị tại thời điểm đồng bộ.
// - Lưu trực tiếp entity.code trong bảng Dashboard để kết quả lịch sử không thay đổi
//   khi quan hệ đơn vị - pháp nhân trong danh mục được cập nhật sau này.


// ================================================================
// PHẦN 1 - THỐNG KÊ ĐỀ NGHỊ ĐANG XỬ LÝ
// ================================================================
// Số liệu lũy kế toàn bộ, KHÔNG lọc theo ngày tháng.
// Một dòng là tổng số đề nghị của một nhóm:
// transaction.type + entity.code + status.

Table esdHTKTdashboardStatusSummary {
  "id" varchar [pk] // Khóa kỹ thuật, cấp tự động: esdHTKTdashboardStatusSummary
  "transaction.type" varchar [not null] // Tạm ứng/Thanh toán/Dự chi
  "entity.code" varchar [not null] // Mã pháp nhân/phạm vi dùng để lọc Dashboard
  "status" varchar [not null] // NEW/PENDING_KTTC/PENDING_APPROVAL/REQUEST_EDIT/APPROVED
  "request.count" number [not null] // Tổng số đề nghị hiện thuộc nhóm
  sysmodtime datetime // OpenText SM tự cập nhật khi bản ghi được tạo hoặc sửa

  indexes {
    ("transaction.type", "entity.code", "status") [unique]
  }
}

// Mã trạng thái nghiệp vụ gốc chỉ dùng để mapping khi đồng bộ, không lưu vào bảng:
// - dmms_created       (Tạo mới)                      -> NEW
// - kttc_created       (Tạo mới)                      -> NEW
// - dmms_initiated     (Chờ KTTC xử lý)               -> PENDING_KTTC
// - kttc_checked       (Chờ KTTC rà soát)              -> PENDING_APPROVAL
// - dmms_checked       (Chờ DMMS rà soát)              -> PENDING_APPROVAL
// - dmms_approved      (Chờ DMMS phê duyệt)            -> PENDING_APPROVAL
// - kttc_approved      (Chờ KTTC phê duyệt)            -> PENDING_APPROVAL
// - checked            (Chờ KTTC rà soát)              -> PENDING_APPROVAL
// - request_edit       (Chờ chỉnh sửa)                 -> REQUEST_EDIT
// - approved           (Đã phê duyệt)                  -> APPROVED
// - accounted          (Đã hạch toán)                  -> không hiển thị ở phần 1
// - cancelled          (Đã xóa)                        -> không hiển thị ở phần 1
//

//
// Khi đề nghị đổi transaction.type/entity.code/status:
// 1. Giảm request.count của nhóm cũ đi 1.
// 2. Tăng request.count của nhóm mới lên 1 (upsert).
// Hai thao tác phải chạy cùng transaction/critical section để không lệch số liệu.
// Không xóa nhóm có request.count = 0; giữ lại để API trả đủ trạng thái với giá trị 0.


// ================================================================
// PHẦN 2 - THỐNG KÊ GIAO DỊCH THEO KHOẢNG NGÀY
// PHẦN 3 - GIAO DỊCH THEO THÁNG
// ================================================================
// Hai phần này có chiều thời gian nên dùng chung bảng tổng hợp theo ngày.
// Phần 2 SUM theo khoảng ngày; phần 3 GROUP BY tháng/năm từ statistic.date.

Table esdHTKTdashboardTransactionDaily {
  "id" varchar [pk] // Khóa kỹ thuật, cấp tự động: esdHTKTdashboardTransactionDaily
  "statistic.date" date [not null] // Ngày tạo giao dịch (VD: 01/11/2026, 02/11/2026)
  "transaction.type" varchar [not null] // Tạm ứng/Thanh toán/Dự chi
  "entity.code" varchar [not null] // Mã pháp nhân/phạm vi dùng để lọc Dashboard
  "total.transaction" number [not null] // Tổng số giao dịch trong ngày
  "total.amount" decimal [not null] // Tổng số tiền trong ngày
  sysmodtime datetime // OpenText SM tự cập nhật khi bản ghi được tạo hoặc sửa

  indexes {
    ("statistic.date", "transaction.type", "entity.code") [unique]
  }
}

// Quy tắc số tiền:
// - Tạm ứng: esdHTKTprepayment.amount.
// - Thanh toán: esdHTKTpayment.total.amount.paid.
// - Dự chi: esdHTKTpayment.total.amount.paid.
// Chỉ cộng giao dịch hợp lệ theo quy tắc nghiệp vụ đã chốt; cancelled không tính.
// Với ngoại tệ phải quy đổi theo tỷ giá gắn với giao dịch. Thiếu tỷ giá thì ghi lỗi
// đồng bộ, không tự lấy một trường tiền khác để thay thế.
//
