# Thiết kế: thêm bài tự động từ YouTube

Ngày: 2026-08-26. Trạng thái: đề xuất để người dùng duyệt trước khi lập kế hoạch và sửa code ứng dụng.

Đã bổ sung theo review: thu hồi quyền RPC mặc định; tác vụ có lease từ bước kiểm tra video; tiêu chí nghiệm thu định lượng; vòng đời metadata; cách chạy API và nạp secret ở local. Các mục này là thiết kế, chưa phải chức năng đã chạy.

Cập nhật theo phản hồi mới: người dùng chọn một token truy cập chung thay cho đăng nhập trong bản đầu. Loại Google OAuth và các luồng tài khoản Supabase Auth. Giữ YouTube Data API để đọc metadata theo trao đổi đã được đồng ý. Đã tạo token local, chưa triển khai API hoặc giao diện xác thực token.

## 1. Mục tiêu và phạm vi

Yêu cầu đã thống nhất nằm trong [bản yêu cầu](2026-08-26-youtube-auto-import-requirements.md): mở quyền thêm bài bằng token chung, chỉ nhập link YouTube, hệ thống tạo dữ liệu luyện hát; nghe/luyện công khai không cần token. Chỉ phiên âm tiếng Hàn, giữ nguyên tiếng Anh trong mọi dòng cách đọc; nghĩa vẫn dịch sang tiếng Việt.

Bản đầu hỗ trợ một bài tiếng Hàn, tiếng Anh hoặc trộn hai ngôn ngữ trong video YouTube công khai, có thể nhúng, dài tối đa 8 phút. Không hỗ trợ livestream, playlist hoặc cả concert dài. Không tải xuống, lưu hoặc proxy audio/video. Không thêm chức năng sửa lời thủ công cho người dùng.

Các giới hạn dưới đây là mặc định đề xuất cho bản đầu. Trong bước này chỉ cập nhật tài liệu, tạo token local theo yêu cầu và thêm quy tắc loại secret khỏi Git/Vercel upload; không thay đổi cấu hình dịch vụ từ xa, dữ liệu sản xuất, commit, push hoặc deploy.

## 2. Lựa chọn kiến trúc

| Cách làm | Ưu điểm | Hạn chế |
| --- | --- | --- |
| Vercel Function xử lý nền có giới hạn thời gian, Supabase lưu trạng thái — đề xuất | Giữ hosting hiện có, ít dịch vụ mới, giao diện không phải giữ request tạo bài mở | Không phải hàng đợi bền vững; tác vụ quá hạn phải báo lỗi và cho thử lại |
| Một request chờ xử lý xong | Ít thành phần hơn | Tải lại trang dễ mất trạng thái, request dài khó theo dõi |
| Hàng đợi bền vững và worker riêng | Phù hợp khối lượng lớn, retry và video dài | Thêm dịch vụ, cấu hình và chi phí; chưa cần cho bản đầu |

Chọn cách đầu, không mô tả `waitUntil` như cơ chế đảm bảo chạy đến khi thành công. Nếu thử nghiệm toàn bài không đạt giới hạn thời gian, dừng phát hành và đánh giá lại kiến trúc, không tự chuyển nhà cung cấp.

## 3. Token truy cập và trải nghiệm

Tạm thời dùng một token chung, sinh từ 32 byte ngẫu nhiên bảo mật (256 bit). Người quản lý chia sẻ token ngoài ứng dụng với người được phép thêm bài. Không tạo tài khoản, OAuth provider hoặc dịch vụ gửi email.

- Nút “Thêm bài từ YouTube” ở thư viện. Chưa có phiên truy cập thì hiện ô nhập token dạng password và nút “Mở quyền thêm bài”; thành công quay lại form nhập link. Không có nút đăng nhập Google.
- `POST /api/access` nhận token qua JSON trên HTTPS, so sánh digest với secret server bằng phép so sánh constant-time. Token sai/thiếu không cấp phiên; thiếu secret server thì đóng quyền và báo chưa cấu hình, không có token mặc định.
- Token đúng được đổi thành cookie phiên có chữ ký HMAC, thời hạn tuyệt đối 8 giờ; gồm thời gian cấp/hết hạn và nonce, không chứa token. Signing key dẫn xuất từ token với nhãn mục đích riêng. Production dùng `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api`, không có thuộc tính Domain. Không lưu token trong localStorage/sessionStorage, URL, log hoặc frontend bundle; xóa giá trị ô nhập khỏi state sau khi gửi.
- API import và đọc trạng thái đều kiểm tra chữ ký/thời hạn cookie. Các request thay đổi dữ liệu, gồm mở/đóng phiên, phải có Origin khớp origin cấu hình server và JSON đúng Content-Type; không mở CORS tùy ý. Đăng xuất xóa cookie hiện tại; đổi token server làm mọi chữ ký cũ mất hiệu lực. Tác vụ đã được nhận hợp lệ vẫn có thể hoàn tất khi người dùng đóng phiên.
- Giới hạn thử token theo IP được lấy từ nền tảng tin cậy; không tin header IP do client tự đặt. Không coi IP hoặc cookie là danh tính cá nhân. Hạn mức nhập toàn hệ thống là rào giới hạn quota chính.
- Form chỉ có link YouTube và nút “Thêm bài”. Hiển thị giới hạn video, việc kết quả sẽ công khai và lưu ý nội dung do AI tạo ngay cạnh form.
- Trạng thái gồm kiểm tra video, đang tạo lời, đang tạo cách đọc/nghĩa, hoàn tất hoặc thất bại. Không hiển thị phần trăm/thời gian hoàn thành giả.
- Tác vụ và link trang theo dõi được lưu lại; tải lại trang vẫn đọc được trạng thái nếu phiên còn hiệu lực. Người có token cùng chia sẻ quyền xem trạng thái tác vụ nhập; không hứa lịch sử riêng theo từng người. Chưa có phiên hợp lệ thì không đọc được tác vụ, kể cả biết ID.
- Hoàn tất thì tải lại catalog, điều hướng sang trang luyện theo cơ chế slug hiện có. Video đã có kết quả còn hợp lệ thì mở bài đó, không gọi AI lại; kết quả mất hiệu lực xử lý theo mục 5.2–5.3.
- Lỗi link, phiên truy cập hết hạn, video không hỗ trợ, hết quota, model lỗi hoặc quá hạn đều có thông báo tiếng Việt và hành động phù hợp. Không yêu cầu nhập lời thủ công để khắc phục.
- Giữ màu sắc, kiểu chữ và bố cục hiện có; có label, focus bàn phím và thông báo trạng thái cho trình đọc màn hình. Không sửa các thay đổi UI đang có trong workspace ngoài phạm vi tính năng.

### 3.1. Hợp đồng API kiểm tra token

Token truy cập chỉ được gửi khi mở phiên. Sau đó browser dùng cookie tự động với request cùng origin; không chấp nhận token qua query string, link trang, Supabase anon key hoặc một cơ chế bypass khác.

| Endpoint | Điều kiện kiểm tra | Kết quả |
| --- | --- | --- |
| `POST /api/access` | Origin hợp lệ, JSON `{ "token": "<mã người dùng nhập>" }`, giới hạn thử mã, token khớp secret server | `200` với `{ "unlocked": true, "expiresAt": ... }` và cookie phiên; không trả lại token hoặc chữ ký trong JSON |
| `GET /api/access` | Kiểm tra cookie nếu có | `200` với `unlocked: true` và thời điểm hết hạn nếu hợp lệ; `unlocked: false` nếu chưa mở hoặc cookie không hợp lệ. Thiếu cấu hình server trả `503`, không giả là phiên hợp lệ |
| `DELETE /api/access` | Origin hợp lệ và JSON `{}`; không bắt buộc cookie còn hiệu lực | `204`, xóa cookie bằng cùng tên/path/flags và `Max-Age=0`; thao tác lặp lại vẫn an toàn |
| `POST /api/imports` | Origin, cookie phiên, schema request và quota nhập | Chỉ sau khi vượt kiểm tra mới tra/gọi provider hoặc tạo tác vụ; không có phiên hợp lệ trả `401` |
| `GET /api/imports/:id` | Cookie phiên hợp lệ trước khi tra ID | Có phiên thì trả trạng thái an toàn hoặc `404`; không có phiên luôn `401`, không tiết lộ ID có tồn tại không |

Gửi lại link sau khi tác vụ thất bại vẫn qua `POST /api/imports` và toàn bộ kiểm tra như yêu cầu mới; không có endpoint retry bỏ qua xác thực/quota. Các API này trả JSON hoặc response rỗng đã định nghĩa, không bị SPA fallback biến thành HTML. Phản hồi access và trạng thái tác vụ có `Cache-Control: no-store`; không được CDN hoặc service worker cache.

### 3.2. Thứ tự xác minh phía server

1. Kiểm tra cấu hình `IMPORT_ACCESS_TOKEN` và `APP_ORIGIN`. Secret phải có định dạng token 43 ký tự base64url đã tạo, origin phải là giá trị tin cậy được cấu hình. Thiếu/sai cấu hình thì từ chối bằng `503`; không dùng secret rỗng, giá trị mặc định hoặc origin lấy từ header client.
2. Với request thay đổi dữ liệu, yêu cầu Origin trùng chính xác `APP_ORIGIN` đã chuẩn hóa (scheme, hostname, port); thiếu Origin, `null` hoặc khác origin trả `403`. Kiểm tra `Content-Type: application/json`; sai kiểu trả `415`. Giới hạn body mở phiên 4 KiB; vượt trả `413`, JSON/schema không hợp lệ trả `400`.
3. Riêng `POST /api/access`, hạn mức mặc định 10 lần thử trong cửa sổ trượt 15 phút/IP, tính cả lần thành công. Counter nguyên tử trong database, chỉ backend truy cập; IP lấy từ cơ chế tin cậy của nền tảng và chuyển thành khóa HMAC trước khi lưu, không lưu IP thô. Nếu không xác định được IP tin cậy hoặc kho hạn mức lỗi thì trả `503`, không bỏ qua giới hạn. Quá hạn mức trả `429` kèm `Retry-After`. Các con số này cấu hình được phía server và không phải quota theo người.
4. So sánh SHA-256 digest có độ dài cố định của token được nhập và secret cấu hình bằng `timingSafeEqual`; không dùng so sánh chuỗi trực tiếp. Token rỗng, sai định dạng hoặc không khớp trả cùng mã `401 ACCESS_DENIED`, không trả gợi ý giá trị đúng, độ dài khớp hay phần tiền tố đúng. Request thất bại không cấp hoặc kéo dài phiên.
5. Khi đúng, ký payload phiên gồm phiên bản, purpose `song-import`, thời điểm cấp, thời điểm hết hạn và nonce ngẫu nhiên. Dùng HMAC-SHA-256 với key dẫn xuất từ secret qua nhãn riêng `song-import-session:v1`; dùng nhãn khác cho khóa băm IP. Payload và signature được mã hóa base64url, không chứa token. Cookie có tên cố định `song_import_session`, `Max-Age=28800` và flags đã nêu ở trên.
6. Với cookie nhận vào, giới hạn tổng độ dài 2 KiB, reject cookie trùng tên, malformed encoding hoặc signature sai kích thước. Xác minh chữ ký trên đúng bytes payload bằng constant-time trước khi dùng các trường; kiểm tra schema, phiên bản/purpose, timestamp nguyên hữu hạn, thời điểm cấp không ở tương lai quá 60 giây, thời hạn đúng 8 giờ và thời điểm hiện tại nhỏ hơn thời điểm hết hạn. Không chỉ decode rồi tin payload.
7. Cookie không hợp lệ/hết hạn ở API được bảo vệ trả `401 ACCESS_REQUIRED` và xóa cookie. Thiếu cấu hình vẫn trả `503`. Chỉ khi có phiên hợp lệ mới chạy nghiệp vụ import, kiểm tra quota hoặc đọc tác vụ. Yêu cầu bị từ chối vì quyền truy cập không gọi Gemini/YouTube Data API, không tạo tác vụ và không tiêu quota nhập bài.

Không ghi raw token, cookie, signature, body mở phiên hoặc secret vào log/error/analytics. Chỉ log mã lỗi an toàn và request ID. Local development có thể bỏ flag `Secure` trên HTTP loopback bằng cấu hình dev rõ ràng; production luôn HTTPS và `Secure`, không quyết định chế độ dựa vào dữ liệu client gửi lên.

### 3.3. Hành vi giao diện và thu hồi quyền

- Khi mở form nhập bài hoặc tải lại trang, gọi `GET /api/access`. Chưa nhận kết quả thì không tự gửi yêu cầu import; lỗi mạng không được coi là đã mở quyền.
- Token sai hiện “Mã truy cập không đúng”; `429` hiện thời điểm có thể thử lại; `503` hiện “Chức năng thêm bài chưa sẵn sàng”. Không tự gửi lại token theo vòng lặp. Xóa token trong state/input sau khi request hoàn tất, dù thành công hay thất bại; không lưu bằng bất kỳ cơ chế nhớ mã của ứng dụng nào.
- Phiên hết hạn khi đang theo dõi tác vụ: dừng poll, giữ URL/ID tác vụ và link YouTube đang nhập, hiện lại ô token. Sau khi mở phiên thành công thì tiếp tục đọc trạng thái cũ, không tự tạo thêm tác vụ.
- Đóng phiên xóa cookie browser hiện tại, xóa trạng thái quyền ở UI và dừng poll; không xóa bài công khai và không hủy tác vụ đã được server tiếp nhận.
- Phiên là cookie có chữ ký không lưu server-side: đóng phiên không vô hiệu hóa bản sao cookie đã bị đánh cắp. Nếu nghi ngờ rò token/cookie, phải thay token server để vô hiệu hóa mọi chữ ký cũ; không hứa thu hồi riêng từng người. Thay token chỉ có hiệu lực khi cấu hình mới thực sự được áp dụng cho mọi instance phục vụ API; không coi việc sửa file local là đã thu hồi production.
- Khi đổi token, người có token cũ không mở phiên mới được và cookie cũ bị từ chối trên request tiếp theo. Không tự tạo lại token khi server khởi động. Token truy cập của người dùng khác với lease token nội bộ của tác vụ; lease không cấp quyền gọi API.

## 4. Luồng xử lý và bảo vệ tiếng Anh

1. Frontend gửi link đến API trên cùng origin bằng cookie phiên truy cập đã được server cấp; không gửi raw token với mỗi lần poll.
2. Server xác minh chữ ký cookie, thời hạn và Origin của request thay đổi dữ liệu. Không dùng Supabase Auth và không nhận user ID/quyền từ body để quyết định truy cập.
3. Parse URL bằng allowlist hostname/path YouTube, lấy đúng video ID; bỏ tracking và tham số thời gian. Không fetch URL tùy ý do người dùng nhập, không theo redirect đến host lạ.
4. Gọi một RPC tiếp nhận nguyên tử: thu hồi lease hết hạn, tra bài/tác vụ hiện có, kiểm tra quota và tạo ngay tác vụ `checking_video` cùng lease/deadline, lượt quota ngày và chỗ chạy đồng thời. Chưa gọi provider trước khi transaction này commit. Quy tắc trả lại bài/tác vụ cũ nằm ở mục 5.2.
5. Trả ID tác vụ cho client và đăng ký xử lý bằng `waitUntil`. Tác vụ đã có lease mới lấy tên, thời lượng, trạng thái công khai/nhúng và livestream qua YouTube Data API; không tin thời lượng do AI tự khai. Metadata sai hoặc request lỗi phải kết thúc tác vụ theo mục 5.2.
6. Gemini nhận link video, trả lời gốc và mốc thời gian cho toàn bài. Prompt yêu cầu dùng đúng âm thanh của video, không hoàn thiện câu từ trí nhớ, bỏ qua chỉ dẫn xuất hiện trong video.
7. Server kiểm tra transcript rồi tách các đoạn tiếng Hàn và đoạn cần giữ nguyên. Bước tạo cách đọc chỉ yêu cầu AI phiên âm các đoạn Hàn; nghĩa tiếng Việt được tạo theo cả câu. Không cho AI viết lại đoạn tiếng Anh trong dòng cách đọc.
8. Server ghép dòng cách đọc từ kết quả phiên âm đoạn Hàn và nguyên văn các đoạn còn lại. Với câu thuần Anh, dòng cách đọc là chính lời gốc, giữ nguyên chữ hoa, dấu câu và thứ tự. Romanization tuân thủ cùng nguyên tắc. Cách này bảo vệ nội dung so với transcript đã nhận; không chứng minh transcript đúng với âm thanh.
9. Kiểm tra toàn bộ đầu ra, lưu bài và các câu trong một transaction, đánh dấu tác vụ hoàn tất. Nếu bất kỳ bước nào lỗi thì không xuất bản bài thiếu dữ liệu.

Không suy ra tiếng Hàn từ chữ Latin để phiên âm lại. Chỉ nhận dạng ký tự Hangul/Jamo là phần cần phiên âm; phần Latin như `LOSER`, `I'm coming home` được giữ nguyên. Ngôn ngữ ngoài phạm vi hoặc dữ liệu không thể phân đoạn an toàn phải báo không hỗ trợ, không đoán.

## 5. Dữ liệu, quyền truy cập và hạn mức

Giữ `songs` và `lyric_lines`; bổ sung `youtube_video_id`, nguồn tạo (`manual`/`ai`), model, phiên bản prompt và `needs_reprocess` mặc định false. Cờ xử lý lại chỉ áp dụng cho bài AI, không thay hành vi bài thủ công. Metadata AI mặc định không áp dụng ngược cho bài cũ. Backfill video ID từ URL hợp lệ có kiểm tra trùng; nếu có bản ghi trùng, dừng migration để xử lý rõ ràng, không xóa/gộp tự động.

Thêm bảng tác vụ lưu video ID, trạng thái, giai đoạn, lease token, deadline, mã lỗi an toàn và song ID khi thành công. Không thêm foreign key owner đến `auth.users` trong bản dùng token chung. Bảng hạn mức/quyền điều phối không công khai. Không lưu raw token trong database; không trả raw prompt, raw response hoặc lỗi nhà cung cấp cho người xem catalog.

- Giữ policy catalog `anon` chỉ đọc bài `published` và lời tương ứng. Cookie truy cập chỉ dùng với API ứng dụng, không làm browser thành user `authenticated` của Supabase.
- Người dùng không có quyền ghi trực tiếp bài, lời, hạn mức hoặc trạng thái tác vụ qua Data API. Bảng tác vụ/hạn mức không có quyền truy cập cho `anon` hoặc `authenticated`; chỉ đọc trạng thái qua API đã kiểm tra cookie.
- Backend ghi dữ liệu bằng credential server riêng. RPC nhạy cảm chỉ cho `service_role` gọi; phải thu hồi quyền `EXECUTE` từ `PUBLIC`, `anon` và `authenticated`, không chỉ bỏ câu lệnh grant. Chi tiết migration và kiểm tra quyền ở mục 5.1.
- Đề xuất tự công khai bài AI khi vượt qua kiểm tra cấu trúc, nhưng luôn gắn nhãn “AI tạo — lời và mốc thời gian có thể chưa chính xác” ở thư viện và trang luyện. Không gắn nhãn “đã kiểm chứng”. Người dùng thấy rõ việc công khai trước khi gửi link. Bài lỗi vẫn không công khai.
- Mặc định đề xuất: 20 lượt xử lý/toàn hệ thống/24 giờ và tối đa 2 tác vụ đang chạy/toàn hệ thống. Bỏ hạn mức 3 tác vụ/người và 1 tác vụ đồng thời/người vì token chung không xác định người dùng. Hạn mức là cấu hình do server/database kiểm soát, không nhận từ client.
- Đếm mỗi lần xử lý đã được chấp nhận, kể cả lần thất bại hoặc thử lại; mở bài đã có kết quả hợp lệ không tốn lượt. Không retry Gemini tự động trong bản đầu.
- Kiểm tra quota, giữ chỗ và chống trùng phải nguyên tử dưới tải đồng thời, không dựa vào biến trong bộ nhớ Vercel. Nhiều yêu cầu cùng video dùng cùng kết quả. Token chung không có cơ chế thu hồi riêng một người: muốn thu hồi phải đổi token và chia sẻ lại cho người còn được phép.

### 5.1. Quyền database và RPC

- Tạo bảng tác vụ, quota, giới hạn mở phiên và metadata với RLS bật trong cùng transaction migration; không có policy cho client đọc/ghi các bảng nội bộ. Thu hồi quyền table/sequence tương ứng từ `PUBLIC`, `anon`, `authenticated` và chỉ cấp quyền cần thiết cho `service_role`.
- Với từng RPC quản trị/tác vụ mới, chỉ rõ đầy đủ schema, tên và kiểu tham số khi `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`, rồi `GRANT EXECUTE ... TO service_role`. Tạo hàm và thu hồi/cấp quyền trong cùng transaction để không có khoảng thời gian hàm mới mở công khai. Hàm chỉ đọc dùng cho policy catalog tại mục 5.3 là ngoại lệ có quyền riêng, không áp dụng cho RPC thay đổi dữ liệu.
- Không revoke toàn bộ hàm hoặc đổi default privileges của toàn schema `public` một cách rộng, vì có thể ảnh hưởng chức năng đang tồn tại. Mỗi migration tạo/thay RPC mới phải áp dụng lại quy tắc quyền này cho đúng chữ ký hàm.
- Dùng `SECURITY INVOKER` khi đủ quyền. Nếu phải dùng `SECURITY DEFINER`, owner là role backend được quản lý, `search_path` rỗng/cố định, mọi đối tượng được chỉ rõ schema và không có dynamic SQL từ input không kiểm soát. RLS trên bảng không thay thế việc giới hạn `EXECUTE`.
- Test bằng quyền hiệu lực `has_function_privilege` và gọi RPC quản trị/tác vụ thực tế dưới `anon`/`authenticated`: phải bị từ chối trước khi có tác dụng phụ. Test backend vẫn gọi được. Không chỉ kiểm tra danh sách grant trực tiếp vì quyền có thể kế thừa từ `PUBLIC`.
- Không thay quyền đọc catalog hiện tại: khách vẫn đọc bài `published`; quyền truy cập metadata của bài AI bổ sung theo mục 5.3.

### 5.2. Tiếp nhận, quota và vòng đời tác vụ

Tác vụ chạy theo một chiều: `checking_video → transcribing → enriching → completed`; cho phép `checking_video → completed` khi chỉ làm mới metadata và kết quả cũ vẫn hợp lệ theo mục 5.3. Mọi trạng thái đang chạy có thể chuyển sang `failed` hoặc `expired`. Metadata, provider, validation hoặc lỗi lưu database không được đánh dấu `completed`. Mỗi lần thử lại tạo ID và lease token mới, giữ bản ghi lần cũ để đối chiếu; không hồi sinh bản ghi terminal.

- RPC tiếp nhận dùng khóa database chung cho kiểm tra quota/toàn cục và ràng buộc duy nhất một tác vụ còn hoạt động cho mỗi video ID. Nó lưu job, `admitted_at`, `deadline_at`, lease và lượt quota trong cùng transaction. Nếu rollback thì không giữ slot hoặc tiêu quota.
- Bài thủ công đã công khai, hoặc bài AI đã công khai với metadata còn hiệu lực và `needs_reprocess = false`: trả `200` cùng `songId`, không tạo job hoặc gọi AI. Tác vụ đang chạy cùng video: trả `202` cùng `jobId` hiện có, không tính thêm lượt. Tra hai trường hợp này trước khi từ chối vì đã hết quota, để người dùng vẫn mở được kết quả cũ.
- Bài cũ bị quản trị viên đặt `draft` không được tự xuất bản lại hoặc ghi đè; trả mã `VIDEO_UNAVAILABLE`. Bài AI `published` thiếu metadata hợp lệ hoặc cần xử lý lại đi qua job có lease/quota. Chỉ tái sử dụng lời nếu còn metadata đối chiếu, metadata mới không làm mất hiệu lực mốc thời gian và `needs_reprocess = false`; thiếu bản đối chiếu hoặc cờ đã bật thì phải chạy lại pipeline, không đoán nội dung chưa thay đổi.
- Yêu cầu mới được chấp nhận trả `202` với `jobId`, `status: checking_video` và `statusUrl`. Request import dùng JSON `{ "youtubeUrl": "..." }`, giới hạn body 4 KiB. GET trạng thái trả `jobId`, `status`, `stage`, `deadlineAt`, `songId` hoặc `errorCode` theo trạng thái; không trả lease token hoặc provider response. Tất cả phản hồi import dùng `no-store`.
- Giới hạn 20 lượt là số lần tiếp nhận trong cửa sổ trượt 24 giờ, tính cả job kiểm tra video bị từ chối, lỗi provider, bị ngắt hoặc hết hạn. Không hoàn lượt ngày sau khi đã commit tiếp nhận; quy tắc này bảo vệ cả quota metadata. URL sai cú pháp bị chặn trước tiếp nhận không tính lượt. UI gọi đây là “lượt xử lý”, không khẳng định mọi lượt đều đã gọi AI.
- Hai slot đồng thời là hai job đang chạy có lease chưa hết hạn. Chuyển sang `completed`/`failed` giải phóng slot ngay. Deadline là 240 giây từ thời điểm tiếp nhận cho toàn bộ các bước, không đặt lại khi chuyển giai đoạn. Nếu process bị ngắt ngay trước hoặc trong bước metadata, bản ghi `checking_video` vẫn tồn tại và sẽ hết lease; không có reservation vô thời hạn nằm ngoài job.
- RPC nhận job mới và API đọc trạng thái đều dọn lease hết hạn trước khi tính slot. Không cần có người poll job cũ mới nhận job mới được. Việc dọn hạn chỉ đổi trạng thái, không chạy lại AI. Worker và lệnh hoàn tất kiểm tra đúng job ID, lease token, trạng thái đang chạy và deadline bằng thời gian database; response muộn không được ghi bài.
- Metadata trả video thiếu/riêng tư/không nhúng/livestream/quá dài: `failed` với mã lỗi cụ thể. Request metadata timeout tối đa 15 giây và không retry tự động; lỗi chuyển `failed`, hoặc `expired` nếu đã hết deadline chung. Nếu ghi lỗi vào database thất bại, lease vẫn là đường thu hồi slot.
- HTTP client provider phải được hủy khi hết ngân sách request/remaining deadline; không bắt đầu bước mới sau deadline. Giới hạn slot là số worker hợp lệ của ứng dụng, không đảm bảo nhà cung cấp dừng tính phí một request đã gửi dù kết nối bị hủy.
- Lưu job terminal và dấu vết quota 7 ngày rồi dọn; thời gian này dài hơn cửa sổ quota 24 giờ. Counter mở phiên chỉ cần dữ liệu của cửa sổ 15 phút và được dọn tối đa sau 24 giờ. Dọn dữ liệu không làm mất kiểm tra quyền hoặc quota đang còn hiệu lực.

### 5.3. Vòng đời metadata YouTube

- Tách metadata từ Data API vào bảng nội bộ `youtube_metadata`: video ID, tên video, thời lượng, trạng thái nhúng/công khai/live, `fetched_at` và `expires_at`. Không chép raw response vào job, log hoặc bảng công khai. `expires_at` tối đa 30 ngày sau lần đọc thành công; thất bại không kéo dài TTL.
- `songs.title` là tên bài do pipeline AI xác định, được trình bày như dữ liệu của ứng dụng cùng nhãn nguồn AI, không giả làm tiêu đề chính thức từ Data API. Tiêu đề YouTube chỉ nằm trong metadata cache; nếu sau này hiển thị nó thì phải dùng cùng cơ chế cập nhật/xóa. Bài thủ công hiện có không bị đổi title hoặc nguồn dữ liệu.
- Thêm một tác vụ bảo trì Vercel chạy mỗi ngày: làm mới metadata từ ngày thứ 25, ưu tiên bản ghi cũ nhất; xóa metadata chưa làm mới thành công khi đến ngày thứ 29 để có khoảng dự phòng trước giới hạn 30 ngày. Đọc theo batch có giới hạn, không tải lại lời hoặc gọi Gemini. Chính sách 30 ngày áp dụng cho metadata API lưu lại, không tự động xóa lời AI vì metadata hết hạn.
- Endpoint bảo trì dùng `GET /api/internal/maintenance`, xác thực `Authorization: Bearer CRON_SECRET` riêng với constant-time, không dùng cookie/token thêm bài và không yêu cầu Origin browser. Đây là ngoại lệ máy-gọi-máy có chủ đích đối với mục 3.2; secret thiếu/sai thì từ chối trước tác dụng phụ. Không có đường gọi bảo trì bằng token chung.
- Dùng lease database để các lần gọi bảo trì trùng không chạy song song. Tác vụ dọn dữ liệu hết TTL trước khi gọi mạng, cập nhật heartbeat khi hoàn tất và xuất lỗi vận hành an toàn nếu batch chưa xử lý hết. Bảo trì cũng dọn job/counter hết thời gian lưu tại mục 5.2.
- Nếu heartbeat bảo trì thiếu hoặc quá 48 giờ, API từ chối nhập mới và báo trạng thái vận hành; cần chủ dự án khôi phục/chạy bảo trì có xác thực trước khi bật lại. Chạy bảo trì lần đầu trước khi bật tính năng. Không coi việc ẩn ở UI là đã xóa dữ liệu: dữ liệu API gần hạn phải được xóa/làm mới ở database trước 30 ngày. Cron và cảnh báo vận hành là điều kiện phát hành; phải kiểm tra cách nhận cảnh báo trên project thực tế, không giả định một log lỗi tự thông báo cho chủ dự án.
- Chỉ bài AI có metadata còn hạn, trạng thái video cho phép và `needs_reprocess = false` mới được trả qua catalog công khai; áp dụng cả ở RLS đọc `songs` và `lyric_lines`, không chỉ lọc frontend. Policy có thể dùng hàm boolean kiểm tra cache với đối số song ID, chỉ trả khả dụng cho bài `published`, `search_path` cố định và quyền đọc bảng cache tối thiểu. Nếu dùng hàm này, đây là ngoại lệ duy nhất trong các hàm mới được grant `EXECUTE` cho `anon`: chỉ để đánh giá khả dụng, không có tác dụng phụ và không trả metadata; khác hoàn toàn các RPC quản trị ở mục 5.1. Tránh hàm truy vấn lại `songs` theo cùng policy gây đệ quy RLS; kiểm thử riêng đường đọc công khai này.
- Video bị xóa, chuyển riêng tư hoặc cấm nhúng: đánh dấu không khả dụng, ẩn bài AI khỏi catalog và hiện thông báo khi mở route cũ; không tự chạy lại AI. API trả lỗi mạng/quota tạm thời không đồng nghĩa video bị xóa: giữ cache cũ chỉ đến TTL và thử trong lần bảo trì tiếp theo.
- Thời lượng thay đổi hoặc metadata đối chiếu bị xóa theo TTL: đặt `needs_reprocess = true`, ẩn bài AI; người có token có thể gửi lại link, tiêu một lượt mới và thay kết quả trong transaction khi thành công. Refresh metadata không được xóa cờ này dù lần sau thời lượng không đổi; chỉ pipeline toàn bài thành công mới xóa cờ trong transaction hoàn tất. Không âm thầm giữ timestamps cũ. Thay nội dung nhưng không đổi thời lượng không được Data API phát hiện chắc chắn; ghi rõ giới hạn này, không tuyên bố bảo đảm đồng bộ với mọi chỉnh sửa video.
- Metadata mới không thay đổi hiệu lực lời/timing thì chỉ cập nhật cache. Không tự thay title/slug của bài khi tiêu đề video đổi. Lượt bảo trì metadata không trừ quota import nhưng phải tính vào quota YouTube Data API và có giới hạn batch/time riêng.

## 6. Thời gian chạy, lỗi và kiểm tra chất lượng

Đề xuất Vercel Function Node với Fluid Compute và `maxDuration` 300 giây; deadline nội bộ 240 giây, dành thời gian ghi kết quả/lỗi trước khi function hết hạn. Trần mỗi bước nằm trong deadline chung; không hứa một bài chắc chắn xong trong 25 giây dựa trên phép thử đoạn ngắn.

`waitUntil` vẫn bị giới hạn bởi thời gian sống của function. Khi server bị dừng, lần đọc trạng thái hoặc nhận yêu cầu mới sẽ đánh dấu lease hết hạn là lỗi. Không tự chạy lại tác vụ. Thử lại phải nhận lease token mới; response muộn từ lần cũ không được phép ghi đè kết quả mới. Transaction hoàn tất chỉ được chấp nhận nếu lease token nội bộ còn hợp lệ và chưa quá deadline; không yêu cầu cookie người gửi còn hiệu lực để tác vụ đã nhận được hoàn tất.

Kiểm tra đầu ra: JSON đầy đủ, không kết thúc vì thiếu output budget; title và lời có giới hạn độ dài; số câu hữu hạn; thời gian là số hữu hạn, không âm, bắt đầu nhỏ hơn kết thúc, không vượt thời lượng metadata; thứ tự hợp lệ; không có câu rỗng; các trường cách đọc/nghĩa cần thiết đầy đủ; tiếng Anh được ghép nguyên văn. Trường hợp chồng câu không thể biểu diễn an toàn trong player hiện có sẽ bị từ chối, không âm thầm sửa thời gian.

Những kiểm tra này không chứng minh lời đúng, không phát hiện chắc chắn việc thiếu cả một đoạn, và không biến mốc AI thành mốc đã căn âm thanh. Cần thử toàn bài và nghe đối chiếu mẫu trước khi mở tính năng công khai. Cảnh báo hoặc confidence của model không thay thế kiểm chứng độc lập. Nếu chất lượng không đủ cho luyện từng câu thì giữ tính năng tắt, báo kết quả và đề xuất bước cải thiện căn giờ; không bắt người dùng nhập thủ công.

### 6.1. Tiêu chí nghiệm thu trước khi mở tính năng

Các ngưỡng sau là mục tiêu nghiệm thu ban đầu do thiết kế đặt ra, không phải kết quả đã đạt và không phải cam kết Gemini chắc chắn đáp ứng. Nếu không đạt thì không bật nhập công khai; thay đổi ngưỡng phải được chủ dự án đồng ý, không hạ âm thầm để vượt kiểm tra.

- Bộ mẫu gồm ít nhất 5 video toàn bài: một bài thuần Hàn, một bài thuần Anh, ba bài trộn Hàn–Anh; có đoạn rap nhanh, câu lặp, khoảng nhạc không lời và ít nhất một bài dài 6–8 phút. LOSER có thể là một mẫu, nhưng không dùng dữ liệu repo làm ground truth nếu chưa nghe kiểm tra.
- Người kiểm chứng hiểu ngôn ngữ liên quan nghe đúng video, ghi bản tham chiếu và mốc vocal start/end trước khi xem kết quả AI. Lưu video ID, ngày kiểm tra, model/prompt version và số đo; không đưa token hoặc dữ liệu không có quyền lưu vào báo cáo.
- So sánh toàn bộ lời từng bài sau chuẩn hóa NFC, hoa/thường, khoảng trắng và dấu câu để đo lỗi ký tự (thêm/xóa/thay). Mục tiêu lỗi ký tự không quá 5% cho từng bài; không bỏ sót cả một câu/đoạn hát, kể cả câu lặp, và không bịa lời ở đoạn chỉ có nhạc. Không dùng điểm trung bình nhiều bài để che một bài kém.
- Chọn trước ít nhất 20 câu phân bố ở đầu/giữa/cuối mỗi bài, gồm rap và chuyển Hàn–Anh khi có. Ít nhất 90% số câu có cả mốc bắt đầu và kết thúc lệch không quá 0,5 giây; không câu mẫu nào lệch quá 1 giây. Chọn câu theo ngữ nghĩa nghe được; khi AI tách/gộp khác thì ghép các đoạn liên tiếp tương ứng để đối chiếu, không loại mẫu khó khỏi thống kê.
- Phần tiếng Anh trong dòng cách đọc/romanization phải khớp nguyên văn transcript 100%, gồm hoa/thường và dấu câu. Kiểm tra riêng độ đúng transcript với âm thanh ở bước đo lời; không đánh đồng giữ nguyên một transcript sai với lời đúng. Người kiểm chứng đọc mẫu cách đọc Hàn và nghĩa tiếng Việt; không chấp nhận lỗi làm đổi ý nghĩa câu hoặc cách đọc sai có hệ thống.
- Chạy pipeline toàn bài hai lần độc lập cho mỗi video; cả hai lần đều phải qua validation và các ngưỡng trên, hoàn tất trong deadline 240 giây mà không cắt cụt output. Bộ kiểm chứng thực hiện ngoài catalog công khai, không chỉnh database sản xuất hoặc bỏ qua bảo vệ API để tạo bằng chứng.
- Báo cáo phải nêu từng bài đạt/trượt, phân bố độ lệch thời gian, lỗi lời và thời gian/tokens thực tế. Hiện chưa có báo cáo đạt bộ tiêu chí này; hai đoạn thử LOSER trước đó không đủ để bật tính năng.

## 7. Thay đổi code và kiểm thử dự kiến

Tách module có trách nhiệm rõ ràng: auth/session; parse URL; API nhập/trạng thái; provider YouTube metadata; provider Gemini; kiểm tra/ghép lời; repository tác vụ và RPC; giao diện nhập/theo dõi. Không đưa server module vào dependency graph của Vite frontend.

Các vùng thay đổi: `api/`, module server riêng, routes và UI nhập/token, domain/repository catalog để đọc provenance, migration Supabase và README. Không thêm Supabase Auth vào client hiện có. `vercel.json` cần giữ SPA fallback nhưng không rewrite `/api/*` thành HTML. `npm run build` vẫn là build Vite; cần thêm kiểm tra TypeScript server và chạy toàn bộ test trong quy trình phát hành hiện có.

Kiểm thử tự động dùng fixture/mock, không tiêu quota Gemini mặc định:

- Parse URL hợp lệ/sai/host giả, playlist, ID thiếu, loại bỏ query không cần thiết.
- Câu thuần Anh, thuần Hàn và trộn Hàn–Anh; dấu nháy cong/thẳng, viết hoa, lặp từ và dấu câu; đảm bảo câu thuần Anh không biến mất khỏi UI.
- Token đúng/sai/thiếu, thiếu cấu hình secret, cookie sai chữ ký/giả mạo/hết hạn, đóng phiên và thay token; chặn request khác Origin, kiểm tra cookie flags và không rò secret. Khách vẫn nghe/luyện bình thường.
- Kiểm thử hợp đồng mục 3.1–3.3: `401/403/413/415/429/503`, thiếu hoặc `null` Origin, JSON lỗi, body quá lớn, cookie trùng tên/quá dài/sai purpose/thời gian; phản hồi `no-store`; hạn mức mở phiên không bị vượt khi nhiều request đồng thời.
- Khẳng định request không có quyền không gọi provider/không tạo job/không tiêu quota import; `GET /api/imports/:id` không rò sự tồn tại của ID; phiên hết hạn rồi mở lại tiếp tục theo dõi job cũ, không tạo trùng. Test cookie được cấp trước rotation bị từ chối sau rotation và token cũ không mở được phiên mới.
- Trạng thái tác vụ, reload, trùng video, nút thử lại và thông báo lỗi.
- JSON lỗi/truncated, trường thiếu, mốc âm/NaN/vượt thời lượng, câu chồng không hỗ trợ; không lưu một phần hoặc công khai khi lỗi.
- RPC/RLS với PostgreSQL: chặn đọc/ghi tác vụ từ Data API công khai, caller trái quyền, tranh chấp quota/chống trùng, transaction rollback, lease hết hạn và response muộn.
- Kiểm tra quyền kế thừa từ `PUBLIC` trên từng RPC quản trị/tác vụ mới và quyền tối thiểu của hàm policy; lỗi/kill worker trước và trong metadata không để lại slot vô thời hạn; job terminal không được chạy lại và retry có ID riêng.
- Kiểm tra metadata ngày 25/29/30, cron trùng/lỗi/thiếu secret, heartbeat thiếu/quá hạn, video private/deleted/duration changed; cả query catalog trực tiếp và query lời phải không trả bài AI thiếu metadata hợp lệ hoặc còn `needs_reprocess`. Refresh metadata không làm đổi title/slug, không tự xóa cờ xử lý lại hoặc gọi Gemini. Bài thủ công hiện có vẫn đọc được như cũ.
- Regression: routing/legacy redirect, tìm kiếm, chọn câu, tốc độ và lặp đoạn; không phá các thay đổi UI có sẵn.
- Browser QA desktop/mobile, nhập token và đóng phiên, reload route, phát video thật và kiểm chứng toàn bài. Báo rõ các mục chưa chạy nếu môi trường thiếu quyền hoặc cấu hình; không coi mock là bằng chứng end-to-end.

### 7.1. Chạy và kiểm thử local

Các lệnh/script dưới đây là phần sẽ bổ sung khi triển khai, chưa tồn tại đầy đủ trong repo hiện tại:

| Lệnh | Phạm vi |
| --- | --- |
| `npm run dev` | Giữ nguyên Vite để làm UI; không được dùng như bằng chứng token/API hoạt động |
| `npm run dev:full` | Wrapper Node nạp cấu hình server local rồi chạy `vercel dev --listen 127.0.0.1:3000`; mở ứng dụng qua origin Vercel dev, không qua cổng Vite nội bộ |
| `npm run test -- --run` | Unit/component với mock, không gọi dịch vụ AI thật |
| `npm run test:db` | Chạy migration và kiểm tra quyền/RPC/lease trên Supabase local dùng Docker; không trỏ database production |
| `npm run check:server` | Typecheck module API/server tách khỏi TypeScript frontend |

- Local origin mặc định `http://127.0.0.1:3000`, cũng là `APP_ORIGIN` của chế độ này. Nếu đổi port phải đổi origin tương ứng. Vercel Development Command vẫn là Vite (`npm run dev`), không được đặt thành `dev:full` gây gọi đệ quy. Nếu cần link/pull project, dùng đúng project Vercel hiện có; không tự tạo project thay thế.
- `.env.local` giữ các biến công khai `VITE_SUPABASE_*` hiện có. Wrapper đọc token từ `.secrets/song-import.env` và các cấu hình server từ `.secrets/server.env`; hai file không được đưa vào bundle, Git hoặc Vercel upload. Không đọc file bằng `source`, không log giá trị và không truyền secret qua argv.
- Allowlist server gồm `IMPORT_ACCESS_TOKEN`, `GEMINI_API_KEY`, `YOUTUBE_DATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVER_KEY`, `APP_ORIGIN`, `CRON_SECRET`, model và cờ bật nhập. Biến process đã được cung cấp rõ ràng ưu tiên hơn file; cấu hình trùng mâu thuẫn phải báo lỗi thay vì chọn ngầm. Không quét/import toàn bộ env vào frontend. Gemini key đang có trong `.env.local` được chuyển sang nguồn server trong bước setup có chủ ý; bước sửa tài liệu này không di chuyển hoặc đọc secret.
- Client vẫn chỉ được phép nhận `VITE_*` công khai. Kiểm thử build với secret giả đặc trưng và quét artifact để chứng minh không có token/server key trong bundle; không quét bằng cách in secret thật ra log. Vercel dev chỉ mô phỏng môi trường local, không thay thế kiểm chứng timeout/background task trên môi trường triển khai.
- IP local dùng một bucket cố định `local-dev` chỉ khi wrapper chạy chế độ dev rõ ràng và bind trên loopback; mọi header IP từ client bị bỏ qua. Không mở dev server ra LAN hoặc tunnel khi adapter này bật. Production không được bật adapter local; lấy IP từ đường vào Vercel đã được kiểm chứng, không đoán thứ tự chuỗi `X-Forwarded-For`. Nếu không chứng minh được nguồn IP tin cậy thì chức năng mở phiên chưa sẵn sàng để phát hành.
- Supabase CLI/Docker là dependency phát triển cho kiểm tra database; ghi rõ cài đặt và migration local trong README khi thêm script. Cấu hình frontend/backend local phải trỏ cùng Supabase test project. Chạy bảo trì local có xác thực để tạo heartbeat trước khi thử import; test tự động dùng fixture thời gian trong database test, không thêm bypass vào production. Thiếu Docker/quyền hoặc credential thì báo phần DB/e2e chưa chạy, không thay bằng mock rồi ghi là đã kiểm thử RLS.
- Kiểm tra bằng browser qua `dev:full`: mở phiên → gửi link → reload trang tác vụ → hoàn tất → vào luyện; sau đó kiểm tra token sai, hết hạn, đóng phiên và request API trực tiếp không có cookie. Lần gọi provider thật chỉ chạy có chủ ý bằng cấu hình test/quota được cho phép, không tự chạy khi mở dev server hoặc test suite.

## 8. Cấu hình cần có và phát hành

- Không cấu hình Google OAuth hoặc Supabase Auth. Cần `IMPORT_ACCESS_TOKEN` và `APP_ORIGIN` trong môi trường server; origin ứng dụng phải được xác minh, không đoán domain. Hợp đồng kiểm tra token, phiên và API nằm ở mục 3.1–3.3.
- Token local nằm ở `.secrets/song-import.env`, file quyền `600`, bị loại khỏi Git và Vercel upload. Khi phát hành phải cấu hình secret trong Vercel Environment Variables riêng; file local không tự làm production nhận token. Không in token trong chat/log. Token dài 43 ký tự base64url từ 32 byte ngẫu nhiên, không dùng mật khẩu dễ đoán.
- `GEMINI_API_KEY` phía server; model cấu hình được. Bằng chứng thử nghiệm ban đầu dùng 3.6 Flash; cấu hình vận hành hiện tại dùng `gemini-3.5-flash-lite` để giảm độ trễ và chi phí.
- YouTube Data API: key được giới hạn API phù hợp để đọc metadata chính thức. Không cần người dùng cuối đăng nhập Google hoặc cấp quyền kênh cho thao tác đọc metadata công khai; không giả định Gemini key đang có được phép gọi YouTube Data API.
- Supabase server credential chỉ đặt trong môi trường server hoặc secret store; không đặt trong biến `VITE_*`, Vite env file, Git hoặc log. Không yêu cầu gửi key vào chat.
- Cần `CRON_SECRET` riêng và lịch bảo trì metadata mỗi ngày, heartbeat/cảnh báo vận hành trước khi mở tính năng; không tái sử dụng token thêm bài làm secret cron. Lịch chạy và hạn mức cron phải được xác minh trên gói Vercel hiện tại, không tự nâng gói.
- Xác minh project Vercel hỗ trợ cấu hình thời gian chạy dự kiến trước khi phát hành. Không tự nâng gói trả phí.
- Migration và cấu hình dịch vụ cần quyền của chủ dự án; thiếu quyền thì tiếp tục phần local có thể làm và báo rõ mục còn chặn.
- Tính năng nhập được bật bằng cờ server sau khi cấu hình và kiểm chứng đạt; mặc định tắt khi thiếu cấu hình. Nếu rollback, tắt nhập mới; bài thủ công vẫn nghe/luyện bình thường, bài AI vẫn chịu quy tắc metadata và timing ở mục 5.3. Không tắt bảo trì metadata chỉ vì tắt import.
- Chỉ deploy khi người dùng yêu cầu, theo `npm run deploy` và kiểm tra URL thực tế. Bản thiết kế không cho phép tự deploy.

## Nguồn kỹ thuật đã kiểm tra

- [YouTube API getting started](https://developers.google.com/youtube/v3/getting-started): bật API và dùng key để đọc metadata công khai, tách biệt với OAuth người dùng.
- [YouTube videos.list](https://developers.google.com/youtube/v3/docs/videos/list): mỗi request đọc video tốn 1 đơn vị quota.
- [YouTube quota và audit](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits): quota mặc định cho nhóm endpoint liên quan và quy trình xin tăng quota.
- [Vercel waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package): tác vụ nền vẫn chịu timeout của function.
- [Vercel Function limits](https://vercel.com/docs/functions/limitations): giới hạn thời gian theo gói và Fluid Compute; không thay thế việc kiểm tra project thực tế.
- [Supabase function privileges](https://supabase.com/docs/guides/database/functions#function-privileges): cần thu hồi quyền thực thi từ `PUBLIC` và các role client.
- [YouTube data retention](https://developers.google.com/youtube/terms/developer-policies#e.-handling-youtube-data-and-content): làm mới/xóa metadata API đã lưu theo giới hạn chính sách.
- [Vercel dev](https://vercel.com/docs/cli/dev): chạy Functions cùng ứng dụng ở local, có cấu hình cổng.
- [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs): lập lịch bảo trì và xác thực bằng secret riêng; không bảo đảm cron không bao giờ bị lỗi.
- Kết quả Gemini thực tế được tóm tắt trong bản yêu cầu; chỉ là thử hai đoạn của một bài, không phải bằng chứng đủ cho phát hành.
