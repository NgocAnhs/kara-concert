# Concert Practice — K-pop Vibrant UI

## Quyết định thiết kế

Ngày 26/08/2026, người dùng chọn **K-pop Vibrant** sau khi xem hai mockup Light Minimal và K-pop Vibrant. Tài liệu này ghi lại hướng đã chọn và phạm vi triển khai để người dùng duyệt trước khi lập kế hoạch thực hiện.

Tham chiếu trực quan: phương án 03 trong mockup cục bộ `.superpowers/brainstorm/33852-1787716215/content/light-vs-vibrant.html`. Mockup chỉ minh họa hướng thiết kế, không phải mã ứng dụng, không phát video thật và không thay thế các chức năng hiện có.

UI/UX Pro Max định hướng phong cách Vibrant & Block-based: tiêu đề đậm, mảng màu rõ, hình học đơn giản. Áp dụng có chọn lọc cho công cụ luyện hát: phần thư viện giàu cá tính; phần lời hát sáng, ít trang trí để đọc liên tục. Không thêm hiệu ứng chuyển động liên tục.

## Mục tiêu và phạm vi

- Viết lại giao diện của toàn bộ ứng dụng công khai: thư viện, luyện hát, trạng thái tải/rỗng/lỗi và trình phát nhúng.
- Giữ React, TypeScript, Vite, Supabase, YouTube và mô hình dữ liệu hiện có.
- Giữ tìm kiếm theo tên bài, mở/quay lại thư viện, chọn một câu hoặc nhiều câu liền nhau, nhảy đến câu, phát một lần, lặp đoạn, tốc độ 0.75×/1×/1.25× và làm nổi bật câu đang phát.
- Dùng tiếng Việt cho nhãn, hướng dẫn, thông báo và tên truy cập của điều khiển; giữ thương hiệu Concert Practice, tên bài và nội dung lời/phiên âm/nghĩa từ dữ liệu.
- Không thêm tài khoản, quản trị, chỉnh sửa bài, playlist cá nhân, thống kê, lưu tiến độ, dark mode hoặc dịch vụ bên ngoài.
- Không sửa schema, migrations, chính sách truy cập hay dữ liệu Supabase. Không sửa thuật toán thời gian/lặp nhạc ngoài các điều chỉnh trình bày cần thiết.

## Hệ thống hình ảnh

| Vai trò | Quyết định |
| --- | --- |
| Nền ứng dụng | Lilac rất nhạt `#F7F3FF` |
| Bề mặt nội dung | Trắng `#FFFFFF` |
| Màu chính | Tím `#6933D4`, chữ trắng |
| Nhấn phụ | Lime `#E3FF78`, chữ tối; dùng tiết chế trên nhãn/trang trí |
| Chữ chính | Tím đen `#231538` |
| Chữ phụ | `#6E5D7F` |
| Vùng được chọn | Lilac `#ECE2FF`, viền tím và nhãn trạng thái |
| Đường phân cách | `#E4D9F0`; không dùng riêng màu này để nhận diện điều khiển |

Khai báo màu dưới dạng CSS semantic tokens dùng chung. Đo tương phản khi triển khai: chữ thường tối thiểu 4.5:1, trạng thái điều khiển quan trọng tối thiểu 3:1. Điều chỉnh sắc độ nếu tổ hợp thực tế chưa đạt.

Font dùng system sans-serif với fallback cho tiếng Việt và tiếng Hàn; không phụ thuộc tải font từ bên ngoài. Tiêu đề trang 32–56px tùy kích thước, tên bài 24–36px, lời Hàn 18–22px, nội dung chính khoảng 16px, chú thích ít nhất 12px. Không sao chép cỡ chữ nhỏ của khung điện thoại thu nhỏ trong mockup vào sản phẩm.

Khoảng cách theo thang 4/8px. Bo góc điều khiển 12–16px, panel 20–24px. Ưu tiên viền nhẹ; hạn chế bóng đổ lớn. Các vòng tròn/mảng hình học dùng CSS, không đặt trang trí đè lên nội dung hoặc điều khiển.

## Thư viện bài hát

1. Header thương hiệu gọn, không thêm menu hoặc điều hướng giả.
2. Hero tím, tiêu đề “Thuộc từng câu. Cháy hết mình.”, lời dẫn ngắn và điểm nhấn lime giống phương án đã chọn.
3. Ô tìm bài có nhãn rõ, vùng nhập thoải mái, tìm kiếm theo tên như hiện tại.
4. Danh sách “Setlist của bạn” hiển thị đúng tổng số kết quả đang thấy.
5. Mỗi bài có tên đầy đủ, phần minh họa kiểu bìa chữ/hình học và nút mở luyện hát. Trên mobile dùng hàng gọn; trên desktop dùng lưới các card đồng nhất.
6. Hướng dẫn ngắn cách luyện từng câu, không thêm các khối quảng cáo dài.

Hiển thị tên bài đúng nguyên văn `song.title`. Model chưa có trường nghệ sĩ hoặc ảnh bìa, nên không tách nghệ sĩ bằng suy đoán, không gán ảnh/metadata giả và không thêm dữ liệu mẫu khi catalog đang rỗng. Bìa hình học là trang trí, không giả làm ảnh bìa chính thức. Số lượng bài/câu, nếu hiển thị, phải lấy từ dữ liệu thực.

## Màn hình luyện hát

Header có “Về thư viện”, tên bài và ngữ cảnh luyện hát. Không lặp lại hero lớn của thư viện.

### Trình phát và điều khiển

- Giữ nguyên iframe YouTube thật và các điều khiển gốc; không thay bằng hình minh họa trong mockup.
- Video giữ tỉ lệ 16:9 khi không xung đột với kích thước tối thiểu của trình phát. Không ép video vào dải cao cố định gây méo hoặc che điều khiển.
- Hiển thị đoạn đang chọn bằng thời gian bắt đầu/kết thúc; nếu chưa chọn, hiển thị hướng dẫn chọn câu.
- Tốc độ là nhóm radio có nhãn “Tốc độ phát”, trạng thái chọn rõ bằng màu, viền và focus bàn phím.
- Giữ cả hai thao tác “Phát một lần” và “Lặp đoạn”. Mockup gộp thành một nút chỉ để minh họa, không phải quyết định bỏ chức năng.
- Khi chưa có đoạn hợp lệ, hai thao tác bị vô hiệu hóa với giải thích gần điều khiển. Khi lặp, trạng thái chỉ được hiển thị như đang lặp nếu có đoạn đã chọn.

### Lời hát

- Thứ tự nội dung: thời gian/thứ tự câu, lời Hàn, phiên âm Việt–Hàn nếu có, romanization nếu có, nghĩa nếu có.
- Không bỏ trường `vietHan` dù mockup không minh họa đầy đủ trường này.
- Cả hàng là nút chọn câu; giữ quy tắc chỉ chọn các câu liền nhau và `aria-pressed`.
- Câu được chọn dùng nền lilac, viền tím và nhãn “Đã chọn”. Câu đang phát có dấu nhấn riêng và nhãn “Đang phát”. Hai trạng thái có thể cùng xuất hiện, không ghi đè lẫn nhau.
- Giữ tự cuộn đến câu đang phát; chỉ vùng lời cuộn khi đang dùng bố cục vùng lời độc lập. Tôn trọng `prefers-reduced-motion`, không cuộn mượt cưỡng bức khi người dùng giảm chuyển động.
- Nội dung dài xuống dòng tự nhiên; không cắt mất lời, phiên âm hoặc nghĩa.

## Responsive và khả năng truy cập

- Desktop từ 1024px: nội dung tối đa khoảng 1200px; luyện hát chia hai cột, player bên trái, lời bên phải. Vùng lời có thể cuộn độc lập; player không che focus hoặc thông báo.
- Tablet dưới 1024px: bố cục một cột hoặc hai cột chỉ khi còn đủ chiều rộng để đọc. Không giữ hai cột bằng cách thu nhỏ chữ.
- Mobile dưới 640px: header gọn, video và điều khiển phía trên, ưu tiên không gian cho lời ở dưới. Trên viewport đủ cao, vùng lời cuộn độc lập; trên viewport thấp hoặc chữ phóng lớn, cho phép cuộn trang thay vì cắt nội dung bằng `overflow: hidden`.
- Không cuộn ngang ở 375px; tên bài dài, thông báo lỗi và điều khiển được phép xuống dòng.
- Điều khiển chạm tối thiểu 44×44px, có focus nhìn thấy, hoạt động bằng bàn phím và tên truy cập rõ. Icon trang trí không được đọc lặp bởi trình đọc màn hình.
- Màu không phải tín hiệu duy nhất cho lựa chọn, đang phát hoặc lỗi.
- Hiệu ứng hover/focus nhẹ 150–200ms; không nhảy bố cục. Không nhấp nháy, parallax hoặc animation sân khấu liên tục.

## Trạng thái và lỗi

- Đang tải catalog: hiển thị trạng thái tải tiếng Việt với semantics phù hợp, giữ bố cục ổn định.
- Chưa cấu hình Supabase: thông báo thiết lập rõ, không đưa dữ liệu giả vào thay thế.
- Không tải được catalog: thông báo dễ hiểu, không làm mất khung giao diện.
- Chưa có bài được xuất bản: trạng thái rỗng riêng.
- Tìm kiếm không có kết quả: thông báo riêng, giữ ô tìm kiếm để sửa truy vấn.
- Bài không có câu hát: giải thích trong vùng lời; không cho tạo đoạn không hợp lệ.
- Chọn câu không liền nhau: thông báo gần vùng chọn, giữ lựa chọn hợp lệ trước đó.
- Video lỗi hoặc link không nhúng được: thông báo trong vùng player, không che nội dung lỗi hoặc làm mất lời hát.

## Kiến trúc triển khai

- `src/styles.css`: thay hệ thống giao diện nâu tối bằng tokens, thành phần và responsive K-pop Vibrant; tránh chồng thêm các lớp override cũ.
- `src/app/App.tsx`: khung thương hiệu/hero và trạng thái catalog; vẫn sở hữu tải dữ liệu và bài đang chọn.
- `src/components/SongLibrary.tsx`: tìm kiếm, số kết quả, danh sách bài và trạng thái rỗng.
- `src/components/PracticePanel.tsx`: bố cục luyện hát, điều khiển, lựa chọn câu và trạng thái trực quan; chỉ tách các thành phần trình bày nhỏ nếu thực sự giúp giảm độ phức tạp.
- `src/components/YouTubePracticePlayer.tsx`: giữ kết nối YouTube và hành vi nhạc; chỉ điều chỉnh wrapper/nhãn/thông báo cần cho UI.
- `index.html`: cập nhật ngôn ngữ và metadata phù hợp; giữ quy trình build/deploy đang có.
- Domain và repository giữ API hiện tại. Dòng dữ liệu vẫn là Supabase → repository → App → library/practice → player; không thêm nguồn dữ liệu hoặc client state bền vững.

## Kiểm chứng và bàn giao

1. Viết/cập nhật test cho yêu cầu giao diện trước phần triển khai tương ứng: nhãn tiếng Việt, tìm bài, kết quả rỗng, chọn câu liền nhau, từ chối câu không liền nhau, tốc độ, trạng thái đang phát + được chọn, giữ đủ trường lời và lỗi.
2. Chạy lại toàn bộ kiểm thử domain/repository/player hiện có để tránh thay đổi hành vi nhạc ngoài phạm vi.
3. Chạy production build bằng script hiện có.
4. Kiểm tra yêu cầu responsive ở 375/768/1024/1440px, chiều cao thấp, chữ lớn và reduced motion bằng các kiểm tra phù hợp. Browser visual QA chỉ thực hiện khi người dùng yêu cầu kiểm thử trình duyệt; không tuyên bố đã kiểm tra trực quan nếu chưa thực hiện.
5. Giữ cấu hình Sites hiện có. Sau khi hoàn thành và build đạt, đi theo quy trình hosting; cần người dùng xác nhận trước nếu bản cập nhật sẽ được xuất bản công khai hoặc đến nhóm đang chia sẻ.

Tiêu chí hoàn thành: hai màn hình cùng hệ thống K-pop Vibrant, đầy đủ chức năng cũ, các trạng thái và lời hát đọc được, không có chức năng giả từ mockup, test/build đạt và trạng thái bàn giao được báo đúng thực tế.

## Tự rà soát đặc tả

- Hướng màu và typography thống nhất giữa thư viện và luyện hát.
- Đã phân biệt minh họa mockup với dữ liệu/YouTube thật.
- Đã ghi rõ giữ “Phát một lần” và phiên âm Việt–Hàn.
- Đã xác định tình huống mobile thấp, trạng thái active + selected và không có dữ liệu.
- Phạm vi gói gọn trong UI công khai; không kéo theo schema, tài khoản hoặc chức năng quản trị.

**Trạng thái:** Hướng K-pop Vibrant đã được chọn; đặc tả này đang chờ người dùng duyệt trước khi lập kế hoạch triển khai.
