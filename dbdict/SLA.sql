// ================================================================
// CẤU HÌNH SLA CHO PHIẾU TẠM ỨNG / THANH TOÁN / DỰ CHI
// ================================================================


// LỊCH TÍNH SLA
// Mặc định: Asia/Ho_Chi_Minh; thứ Hai-thứ Sáu, 08:00-12:00 và 13:00-17:00.
// Chỉ cộng phần giao của khoảng đo với các ca làm việc, loại trừ ngày nghỉ.
// Một ngày nghỉ áp dụng toàn ngày theo múi giờ của lịch; không cần khai báo cuối tuần.
// Lịch đã được Tracking tham chiếu phải giữ nguyên để đối soát; thay đổi lịch/ngày nghỉ
// bằng cách tạo phiên bản lịch mới và gắn vào phiên bản Config mới.
Table esdHTKTslaCalendar {
  id varchar [pk] // Mã phiên bản lịch
  name varchar // Tên lịch, ví dụ VTB 2027 phiên bản 1
  timezone varchar // IANA timezone; mặc định Asia/Ho_Chi_Minh
  description text
  "created.by" varchar
  "created.at" datetime
  "updated.by" varchar
  "updated.at" datetime
}

Ref: esdHTKTslaWorkingHour."calendar.id" > esdHTKTslaCalendar.id

// Mỗi dòng là một ca làm việc lặp lại theo tuần; các ca cùng ngày không chồng lấn.
// Lịch chuẩn có 10 dòng: 2 ca/ngày x 5 ngày; không có dòng cho thứ Bảy/Chủ nhật.
Table esdHTKTslaWorkingHour {
  id varchar [pk]
  "calendar.id" varchar [not null]
  "day.of.week" number [not null] // ISO: 1=thứ Hai ... 7=Chủ nhật
  "start.time" time [not null] // Giờ địa phương, ví dụ 08:00 hoặc 13:00
  "end.time" time [not null] // Phải lớn hơn start.time, ví dụ 12:00 hoặc 17:00

  indexes {
    ("calendar.id", "day.of.week", "start.time") [unique]
  }
}

Ref: esdHTKTslaHoliday."calendar.id" > esdHTKTslaCalendar.id

// Mỗi dòng là một ngày không tính SLA (lễ, Tết, nghỉ bù hoặc ngày nghỉ đặc biệt).
// Kỳ nghỉ nhiều ngày tạo từng dòng theo ngày thực tế; không tự suy diễn nghỉ bù.
Table esdHTKTslaHoliday {
  id varchar [pk]
  "calendar.id" varchar [not null]
  "holiday.date" date [not null] // Ngày theo timezone của Calendar
  "holiday.name" varchar // Tên ngày nghỉ
  "holiday.type" varchar // PUBLIC_HOLIDAY/TET/COMPENSATORY_LEAVE/OTHER
  note text
  "created.by" varchar
  "created.at" datetime

  indexes {
    ("calendar.id", "holiday.date") [unique]
  }
}

Ref: esdHTKTslaConfig."calendar.id" > esdHTKTslaCalendar.id

// Bảng cấu hình SLA
// Mỗi bản ghi đại diện cho một bộ SLA áp dụng theo loại giao dịch và nghiệp vụ/sản phẩm.
Table esdHTKTslaConfig {
  id varchar [pk] // Mã cấu hình SLA
  "transaction.type" varchar // Loại giao dịch (Tạm ứng/Thanh toán/Dự chi)
  "product.type" varchar // Nghiệp vụ/Sản phẩm (Mua sắm HHDV/Xây dựng cơ bản/...)
  "calendar.id" varchar [not null] // Phiên bản lịch dùng để tính SLA
  "effective.from" datetime // Thời điểm bắt đầu áp dụng
  "effective.to" datetime // Thời điểm kết thúc áp dụng; null nếu đang áp dụng
  status varchar // Trạng thái cấu hình (Chờ hiệu lực/Đang hoạt động/Không hoạt động)
  description text // Ghi chú cho bộ cấu hình
  "created.by" varchar // Người tạo cấu hình
  "created.at" datetime // Thời điểm tạo cấu hình
  "updated.by" varchar // Người cập nhật gần nhất
  "updated.at" datetime // Thời điểm cập nhật gần nhất
}


Ref: esdHTKTslaConfigDetail."sla.config.id" > esdHTKTslaConfig.id

// Bảng chi tiết SLA theo vai trò xử lý
// Một bộ cấu hình có nhiều dòng tương ứng với các vai trò trong quy trình.
// Phase nghiệp vụ: initial_dmms/initial_kttc/check_dmms/approval_dmms/
// approval_kttc/check_final/approval_final. Không suy ra vai trò chỉ từ nhãn trạng thái.
// Mốc RS2 do nghiệp vụ chốt: bắt đầu khi Phê duyệt ĐMMS chuyển thành công;
// kết thúc khi RS2 xác nhận chuyển sang Phê duyệt cấp có thẩm quyền.
// Mốc bắt đầu RS2 không chờ đến khi Phê duyệt KTTC hoàn thành. Vì vậy khoảng đo
// RS2 có thể bao gồm thời gian phase approval_kttc; không ép mỗi phiếu chỉ có 1 Tracking đang mở.
// Chỉ tạo RS2 nếu luồng có RS2. Không dùng step.order để tự suy ra mốc bắt đầu SLA.
Table esdHTKTslaConfigDetail {
  id varchar [pk] // Khóa kỹ thuật chi tiết cấu hình SLA
  "sla.config.id" varchar // Mã cấu hình SLA
  "role.code" varchar // Mã vai trò xử lý (CB_DE_NGHI/RA_SOAT_1/PHE_DUYET_DM/CB_KTTC/...)
  "role.name" varchar // Tên vai trò hiển thị
  "step.order" number // Thứ tự xử lý của vai trò trong luồng
  "sla.hours" decimal // Số giờ làm việc cam kết của vai trò
  "alert.stage1.rate" decimal // Tỷ lệ cảnh báo mức 1; mặc định 0.7
  "alert.stage2.rate" decimal // Tỷ lệ cảnh báo mức 2; mặc định 0.9
  "is.active" bool // Có áp dụng SLA cho vai trò này hay không (mặc định là true)
  note text // Ghi chú cấu hình
}


Ref: esdHTKTslaTracking."calendar.id" > esdHTKTslaCalendar.id
Ref: esdHTKTslaTracking."payment.id" > esdHTKTpayment.id
Ref: esdHTKTslaTracking."sla.config.id" > esdHTKTslaConfig.id
Ref: esdHTKTslaTracking."sla.config.detail.id" > esdHTKTslaConfigDetail.id

// Bảng theo dõi SLA của từng vai trò trên phiếu
// Mỗi lần SLA bị đo lại từ đầu sẽ sinh một attempt.no mới.
Table esdHTKTslaTracking {
  id varchar [pk] 
  "payment.id" varchar // Mã phiếu tạm ứng/thanh toán/dự chi
  "sla.config.id" varchar // Bộ cấu hình SLA được áp dụng tại thời điểm bắt đầu đo
  "sla.config.detail.id" varchar // Chi tiết SLA của vai trò được áp dụng
  "calendar.id" varchar [not null] // Chốt từ Config khi bắt đầu lần đo, dùng cho elapsed và due
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


Ref: esdHTKTslaTimeSegment."sla.tracking.id" > esdHTKTslaTracking.id

// Bảng các khoảng thời gian dùng để tính SLA
// Lưu chi tiết thời gian bắt đầu/kết thúc của từng role để đối soát kết quả tính.
// REASSIGN: đóng segment cũ và mở segment mới cùng thời điểm; giữ nguyên Tracking,
// attempt.no, started.at và due.at của Tracking, không dừng hay cấp lại thời gian SLA.
// CANCEL: đóng tất cả segment và Tracking đang mở của phiếu tại cùng thời điểm;
// chốt số phút, ngừng phát sinh cảnh báo mới, giữ nguyên lịch sử đã có.
Table esdHTKTslaTimeSegment {
  id varchar [pk] 
  "sla.tracking.id" varchar // Mã theo dõi SLA
  "segment.no" number // Số thứ tự khoảng thời gian trong một lần đo
  "started.at" datetime // Thời điểm bắt đầu khoảng tính
  "ended.at" datetime // Thời điểm kết thúc khoảng tính; null nếu đang chạy
  "working.minutes" number // Số phút làm việc hợp lệ trong khoảng
  "start.event" varchar // START/RESET/REASSIGN/RESUME (Bắt đầu đo/Đo lại/Tái phân công/Tiếp tục)
  "end.event" varchar // COMPLETE/RETURN/REASSIGN/PAUSE/CANCEL/END (Hoàn thành/Trả sửa/Tái phân công/Tạm dừng/Xóa phiếu/Kết thúc SLA)
  "assignee" varchar // Người xử lý trong khoảng thời gian
  "created.at" datetime // Thời điểm tạo bản ghi
}



Ref: esdHTKTslaAlertHistory."sla.tracking.id" > esdHTKTslaTracking.id

// Bảng lịch sử cảnh báo SLA
// Mỗi tracking chỉ gửi một lần cho mỗi stage; cần kiểm tra trùng theo
// sla.tracking.id + alert.stage trước khi tạo yêu cầu gửi mail.
Table esdHTKTslaAlertHistory {
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


Ref: esdHTKTslaEventLog."sla.tracking.id" > esdHTKTslaTracking.id

// Bảng nhật ký sự kiện SLA
// Dùng để truy vết các thay đổi trạng thái và phục vụ tính toán/đối soát SLA.
Table esdHTKTslaEventLog {
  id varchar [pk] 
  "sla.tracking.id" varchar // Mã theo dõi SLA; có thể null nếu bước đích chưa bắt đầu đo
  "payment.id" varchar // Mã phiếu để tra cứu nhanh lịch sử
  "event.type" varchar // Loại sự kiện (START/COMPLETE/RETURN/REASSIGN/RESET/PAUSE/RESUME/CANCEL)
  "event.at" datetime // Thời điểm nghiệp vụ phát sinh
  "from.status" varchar // Trạng thái phiếu trước sự kiện
  "to.status" varchar // Trạng thái phiếu sau sự kiện
  "from.phase" varchar // Current phase trước sự kiện
  "to.phase" varchar // Current phase sau sự kiện; có thể giữ nguyên khi REASSIGN
  "role.code" varchar // Vai trò đích của sự kiện, kể cả khi chưa có Tracking
  "performed.by" varchar // Người hoặc service phát sinh sự kiện
  "assignee" varchar // Người xử lý tại thời điểm sự kiện
  data text // Dữ liệu bổ sung của sự kiện
  "created.at" datetime // Thời điểm hệ thống ghi nhận sự kiện
}

// TRẠNG THÁI PHIẾU VÀ PHASE
// Status: dmms_created/kttc_created (Tạo mới), dmms_initiated (Chờ KTTC xử lý),
// kttc_checked/dmms_checked/dmms_approved/kttc_approved/checked (Chờ phê duyệt),
// approved (Đã phê duyệt), cancelled (Đã xóa), request_edit (Chờ chỉnh sửa),
// accounted (Đã hạch toán).
// Phase: initial_dmms -> initial_kttc -> check_dmms -> approval_dmms ->
// approval_kttc -> check_final -> approval_final (bỏ các bước không thuộc luồng).
// Status và phase là hai thuộc tính riêng; EventLog lưu giá trị thực tế trước/sau,
// không ánh xạ cứng một status thành một phase chỉ dựa trên thứ tự hai danh sách.
// RETURN: kết thúc các lần đo đang mở và đo lại từ đầu kể cả maker, giữ lịch sử cũ.
// CANCEL phát sinh khi xóa nghiệp vụ thành công (to.status=cancelled), không xóa dữ liệu SLA.
// Lưu timestamp theo một chuẩn thống nhất (khuyến nghị UTC); quy đổi sang timezone
// của Calendar khi xác định thứ trong tuần, ca làm việc và ngày nghỉ.
