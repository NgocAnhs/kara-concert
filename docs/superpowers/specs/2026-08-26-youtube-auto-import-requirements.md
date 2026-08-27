# Yêu cầu đã chốt: thêm bài từ link YouTube

Ngày: 2026-08-26.

Đây là bản ghi yêu cầu đã thống nhất, chưa phải thiết kế triển khai hoàn chỉnh. Tính năng chưa được tích hợp hoặc triển khai lên Vercel.

## Thao tác của người dùng

- Chỉ nhập link YouTube để thêm bài; không yêu cầu nhập tên, lời, phiên âm, nghĩa hoặc mốc thời gian thủ công.
- Hệ thống tự xử lý, thông báo trạng thái và mở bài để luyện khi có kết quả hợp lệ.
- Khi không xử lý được, báo lỗi rõ ràng; không chuyển việc nhập lời hoặc căn giờ sang người dùng.
- Tạm thời dùng một token truy cập chung để mở chức năng thêm bài theo yêu cầu mới nhất. Không dùng Google OAuth, email/mật khẩu hoặc Supabase Auth trong bản đầu; nghe/luyện công khai không cần token.
- Token phải được kiểm tra phía server. Bất kỳ ai có token đều có cùng quyền; không coi token chung là danh tính người dùng và không hứa hạn mức riêng từng người.
- Token đúng mở phiên cookie bảo mật tối đa 8 giờ; API thêm bài và xem trạng thái phải kiểm tra phiên ở mọi request. Sai/thiếu/hết hạn thì từ chối trước khi gọi AI hoặc tạo tác vụ. Chi tiết endpoint, mã lỗi, giới hạn thử token, thu hồi và kiểm thử được ghi trong [thiết kế, mục 3.1–3.3](2026-08-26-youtube-auto-import-design.md#31-hợp-đồng-api-kiểm-tra-token).

## Quy tắc ngôn ngữ

- Giữ nguyên lời tiếng Anh, bao gồm cách viết hoa và dấu câu; không tạo cách đọc bằng chữ tiếng Việt cho phần này.
- Chỉ tạo cách đọc tiếng Việt cho phần tiếng Hàn.
- Với câu trộn Hàn–Anh, chỉ phiên âm phần Hàn, giữ nguyên phần Anh tại đúng vị trí. Quy tắc này áp dụng cả dòng cách đọc tiếng Việt và romanization.
- Câu hoàn toàn bằng tiếng Anh vẫn có nội dung tiếng Anh trong dòng dùng để hát theo, không được để trống khiến câu biến mất. Giao diện hiện tại không hiển thị trường lời gốc riêng.
- Phần nghĩa tiếng Việt vẫn có thể dịch cả tiếng Hàn lẫn tiếng Anh; yêu cầu giữ nguyên tiếng Anh áp dụng cho lời/cách đọc, không phải phần giải nghĩa.
- Quy tắc áp dụng cho luồng nhập tự động mới. Không tự sửa dữ liệu bài hát hiện có trong Supabase.

### Ví dụ nghiệm thu

| Lời gốc | Cách đọc hiển thị mong muốn |
| --- | --- |
| `I'm coming home` | `I'm coming home` |
| `LOSER` | `LOSER` |
| `난 멀리 와버렸어 I'm coming home` | Phần Hàn được phiên âm, theo sau bằng nguyên văn `I'm coming home` |

Không được biến `I'm coming home` thành `Ai-m câm-ming hôm`. Cần kiểm thử riêng câu thuần Anh, thuần Hàn và câu trộn hai ngôn ngữ. Ví dụ không khẳng định cách phiên âm tiếng Hàn cụ thể đã được kiểm chứng.

## Bằng chứng và giới hạn từ lần thử trước

- Gemini 3.6 Flash đã xử lý hai đoạn của video LOSER (`1CTced9CMMk`) chỉ từ link, trả về các trường cần thiết.
- Hai đoạn 0–45 giây và 85–107 giây trả lần lượt 15 và 8 đoạn lời trong khoảng 25 và 23 giây.
- Một số từ khác dữ liệu tham chiếu trong repo. Sáu câu trùng lời có mốc bắt đầu chênh 0,55–1,72 giây so với repo; chưa nghe kiểm chứng độc lập để xác định độ đúng.
- Có một mốc kết thúc vượt phạm vi đoạn yêu cầu mà model không tự cảnh báo.
- Vì vậy dữ liệu có cấu trúc hoặc không có cảnh báo từ AI chưa đủ để chứng minh lời/căn giờ chính xác. Cần kiểm tra độc lập trước khi coi kết quả là đáng tin cậy.
- Chưa thử quy tắc giữ nguyên tiếng Anh mới bằng một lần gọi API riêng.

## Ràng buộc triển khai

- Giữ Vercel và Supabase hiện có; không đổi nhà cung cấp hosting.
- Gọi Gemini phía server, không đưa key vào frontend hoặc biến `VITE_*`.
- Tránh xử lý trùng video, giới hạn yêu cầu/quota và kiểm tra đầu ra phía server.
- Không tự commit, push hoặc triển khai tính năng chỉ vì đã chốt yêu cầu này.
- Quyền yêu cầu nhập bài đã chốt: người có token truy cập chung. Thay token để thu hồi các phiên truy cập đã cấp; không đặt token trong Git, frontend bundle, URL hoặc log.
- Giữ YouTube Data API để đọc metadata sau khi người dùng đồng ý hướng đề xuất và chọn token làm phương thức truy cập tạm thời. Thử nghiệm Gemini trước đó không dùng Data API; cấu hình key Data API là bước riêng chưa thực hiện.
- Token local đã được tạo trong `.secrets/song-import.env`, biến `IMPORT_ACCESS_TOKEN`, quyền file `600`. Thư mục `.secrets` bị loại khỏi Git và Vercel upload. Việc tạo token không có nghĩa API kiểm tra token đã được triển khai.

## Bổ sung sau review thiết kế

Các biện pháp sau đã được bổ sung vào [bản thiết kế](2026-08-26-youtube-auto-import-design.md), chưa được triển khai hoặc kiểm thử trên ứng dụng:

- RPC quản trị/tác vụ phải thu hồi quyền thực thi mặc định từ `PUBLIC`, `anon`, `authenticated`; chỉ backend được gọi. Kiểm tra quyền thực tế trên PostgreSQL, không chỉ đọc migration.
- Tạo job có lease/deadline và giữ quota trong cùng transaction trước khi gọi YouTube Data API. Mặc định đề xuất 20 lượt xử lý/24 giờ toàn hệ thống và 2 job đồng thời; lượt đã tiếp nhận vẫn tính khi lỗi. Server bị ngắt không được làm kẹt slot vô thời hạn.
- Trước khi mở tính năng, kiểm chứng ít nhất 5 bài đầy đủ, mỗi bài hai lần: lỗi ký tự tối đa 5%; ít nhất 90% câu mẫu lệch cả đầu/cuối không quá 0,5 giây, không câu mẫu nào quá 1 giây; hoàn tất trong 240 giây. Đây là mục tiêu nghiệm thu đề xuất, chưa phải kết quả đạt được; chi tiết cách đo ở mục 6.1 của thiết kế.
- Metadata YouTube phải được làm mới/xóa trong hạn chính sách; có bảo trì hằng ngày, xác thực cron riêng và cảnh báo khi bảo trì lỗi. Bài AI thiếu metadata hợp lệ hoặc mất hiệu lực căn giờ phải ẩn; refresh metadata không tự làm mốc lời cũ hợp lệ trở lại. Bài thủ công hiện có không bị áp dụng ngược quy tắc này.
- Bổ sung quy trình local chạy cả frontend/API trên loopback, nạp secret phía server và kiểm tra database local. Các script mới trong mục 7.1 là kế hoạch triển khai, chưa có sẵn; `npm run dev` hiện chỉ chạy Vite.
