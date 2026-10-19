// ================================================================
// CẤU HÌNH SLA CHO PHIẾU TẠM ỨNG / THANH TOÁN / DỰ CHI
// SLA được tính theo giờ làm việc 08:00-12:00 và 13:00-17:00,
// từ thứ 2 đến thứ 6, loại trừ ngày nghỉ/lễ lấy từ bảng ngày lễ đã có.
// ================================================================


// Bảng cấu hình SLA
// Mỗi bản ghi đại diện cho một bộ SLA áp dụng theo loại giao dịch và nghiệp vụ/sản phẩm.
Table esdHTKTSlaConfig {
  id varchar [pk] // Mã cấu hình SLA
  "transaction.type" varchar // Loại giao dịch (Tạm ứng/Thanh toán/Dự chi)
  "product.type" varchar // Nghiệp vụ/Sản phẩm (Mua sắm HHDV/Xây dựng cơ bản/...)
  "effective.from" datetime // Thời điểm bắt đầu áp dụng
  "effective.to" datetime // Thời điểm kết thúc áp dụng; null nếu đang áp dụng
  status varchar // Trạng thái cấu hình (Chờ hiệu lực/Đang hoạt động/Không hoạt động)
  description text // Ghi chú cho bộ cấu hình
  "created.by" varchar // Người tạo cấu hình
  "created.at" datetime // Thời điểm tạo cấu hình
  "updated.by" varchar // Người cập nhật gần nhất
  "updated.at" datetime // Thời điểm cập nhật gần nhất
}


Ref: esdHTKTSlaConfigDetail."sla.config.id" > esdHTKTSlaConfig.id

// Bảng chi tiết SLA theo vai trò xử lý
// Một bộ cấu hình có nhiều dòng tương ứng với các vai trò trong quy trình.
Table esdHTKTSlaConfigDetail {
  id varchar [pk] // Khóa kỹ thuật chi tiết cấu hình SLA
  "sla.config.id" varchar // Mã cấu hình SLA
  "role.code" varchar // Mã vai trò xử lý (CB_DE_NGHI/RA_SOAT_1/PHE_DUYET_DM/CB_KTTC/...)
  "role.name" varchar // Tên vai trò hiển thị
  "step.order" number // Thứ tự xử lý của vai trò trong luồng
  "sla.hours" decimal // Số giờ làm việc cam kết của vai trò
  "alert.stage1.rate" decimal // Tỷ lệ cảnh báo mức 1; mặc định 0.7
  "alert.stage2.rate" decimal // Tỷ lệ cảnh báo mức 2; mặc định 0.9
  "is.active" bool // Có áp dụng SLA cho vai trò này hay không
  note text // Ghi chú cấu hình
}


Ref: esdHTKTSlaTracking."payment.id" > esdHTKTpayment.id
Ref: esdHTKTSlaTracking."sla.config.id" > esdHTKTSlaConfig.id
Ref: esdHTKTSlaTracking."sla.config.detail.id" > esdHTKTSlaConfigDetail.id

// Bảng theo dõi SLA của từng vai trò trên phiếu
// Mỗi lần SLA bị đo lại từ đầu sẽ sinh một attempt.no mới.
Table esdHTKTSlaTracking {
  id varchar [pk] // Khóa kỹ thuật lần theo dõi SLA
  "payment.id" varchar // Mã phiếu tạm ứng/thanh toán/dự chi
  "sla.config.id" varchar // Bộ cấu hình SLA được áp dụng tại thời điểm bắt đầu đo
  "sla.config.detail.id" varchar // Chi tiết SLA của vai trò được áp dụng
  "role.code" varchar // Mã vai trò đang được đo SLA
  "attempt.no" number // Lần đo SLA; tăng khi phiếu bị yêu cầu chỉnh sửa và phải đo lại từ đầu
  "started.at" datetime // Thời điểm bắt đầu đo SLA của lần hiện tại
  "ended.at" datetime // Thời điểm kết thúc đo SLA; null nếu chưa kết thúc
  "due.at" datetime // Hạn xử lý dự kiến sau khi loại trừ ngoài giờ và ngày nghỉ/lễ
  "sla.minutes" number // Tổng số phút làm việc cam kết, quy đổi từ sla.hours
  "elapsed.minutes" number // Số phút làm việc đã sử dụng
  "remaining.minutes" number // Số phút làm việc còn lại
  "current.assignee" varchar // Người đang được giao xử lý
  status varchar // Trạng thái SLA (Chưa tính/Trong thời gian/Vi phạm/Đã kết thúc)
  "alert.status" varchar // Trạng thái cảnh báo (NONE/STAGE_1/STAGE_2/STAGE_3)
  "last.calculated.at" datetime // Thời điểm gần nhất hệ thống tính lại SLA
  "created.at" datetime // Thời điểm tạo bản ghi theo dõi
  "updated.at" datetime // Thời điểm cập nhật gần nhất
}


Ref: esdHTKTSlaTimeSegment."sla.tracking.id" > esdHTKTSlaTracking.id

// Bảng các khoảng thời gian dùng để tính SLA
// Lưu chi tiết thời gian bắt đầu/kết thúc của từng role để đối soát kết quả tính.
Table esdHTKTSlaTimeSegment {
  id varchar [pk] // Khóa kỹ thuật khoảng thời gian
  "sla.tracking.id" varchar // Mã theo dõi SLA
  "segment.no" number // Số thứ tự khoảng thời gian trong một lần đo
  "started.at" datetime // Thời điểm bắt đầu khoảng tính
  "ended.at" datetime // Thời điểm kết thúc khoảng tính; null nếu đang chạy
  "working.minutes" number // Số phút làm việc hợp lệ trong khoảng
  "start.event" varchar // Sự kiện bắt đầu (Đến lượt xử lý/Đo lại/Phân công lại/Tiếp tục)
  "end.event" varchar // Sự kiện kết thúc (Hoàn thành/Yêu cầu chỉnh sửa/Tạm dừng/Kết thúc SLA)
  "assignee" varchar // Người xử lý trong khoảng thời gian
  "created.at" datetime // Thời điểm tạo bản ghi
}


Ref: esdHTKTSlaAssignmentHistory."sla.tracking.id" > esdHTKTSlaTracking.id

// Bảng lịch sử phân công xử lý SLA
// Khi tái phân công, SLA tiếp tục chạy và không tính lại từ đầu.
Table esdHTKTSlaAssignmentHistory {
  id varchar [pk] // Khóa kỹ thuật lịch sử phân công
  "sla.tracking.id" varchar // Mã theo dõi SLA
  "assigned.from" varchar // Người xử lý trước khi tái phân công
  "assigned.to" varchar // Người được giao xử lý mới
  "assigned.by" varchar // Người thực hiện phân công
  "assigned.at" datetime // Thời điểm phân công
  reason text // Lý do phân công lại
}


Ref: esdHTKTSlaAlertHistory."sla.tracking.id" > esdHTKTSlaTracking.id

// Bảng lịch sử cảnh báo SLA
// Mỗi tracking chỉ gửi một lần cho mỗi stage; cần kiểm tra trùng theo
// sla.tracking.id + alert.stage trước khi tạo yêu cầu gửi mail.
Table esdHTKTSlaAlertHistory {
  id varchar [pk] // Khóa kỹ thuật cảnh báo
  "sla.tracking.id" varchar // Mã theo dõi SLA
  "alert.stage" varchar // Mức cảnh báo (STAGE_1_70/STAGE_2_90/STAGE_3_BREACH)
  "threshold.rate" decimal // Tỷ lệ thời gian SLA tại lúc phát sinh cảnh báo (0.7/0.9/1.0)
  "recipient.user" varchar // Người đang xử lý nhận cảnh báo
  "recipient.email" varchar // Địa chỉ email nhận cảnh báo
  "triggered.at" datetime // Thời điểm đạt ngưỡng cảnh báo
  "sent.at" datetime // Thời điểm gửi email thành công
  "send.status" varchar // Trạng thái gửi (Chờ gửi/Đã gửi/Gửi lỗi)
  "retry.count" number // Số lần gửi lại
  "error.message" text // Nội dung lỗi gửi mail gần nhất
  "created.at" datetime // Thời điểm tạo cảnh báo
  "updated.at" datetime // Thời điểm cập nhật gần nhất
}


Ref: esdHTKTSlaEventLog."sla.tracking.id" > esdHTKTSlaTracking.id

// Bảng nhật ký sự kiện SLA
// Dùng để truy vết các thay đổi trạng thái và phục vụ tính toán/đối soát SLA.
Table esdHTKTSlaEventLog {
  id varchar [pk] // Khóa kỹ thuật sự kiện
  "sla.tracking.id" varchar // Mã theo dõi SLA
  "payment.id" varchar // Mã phiếu để tra cứu nhanh lịch sử
  "event.type" varchar // Loại sự kiện (START/COMPLETE/RETURN/REASSIGN/RESET/PAUSE/RESUME)
  "event.at" datetime // Thời điểm nghiệp vụ phát sinh
  "from.status" varchar // Trạng thái phiếu trước sự kiện
  "to.status" varchar // Trạng thái phiếu sau sự kiện
  "performed.by" varchar // Người hoặc service phát sinh sự kiện
  "assignee" varchar // Người xử lý tại thời điểm sự kiện
  data text // Dữ liệu bổ sung của sự kiện
  "created.at" datetime // Thời điểm hệ thống ghi nhận sự kiện
}
