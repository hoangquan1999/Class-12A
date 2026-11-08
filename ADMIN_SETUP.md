# Cấu hình Admin cho website 12A

Admin dùng mật khẩu riêng được kiểm tra tại API phía máy chủ. Không đặt mật khẩu trong `index.html`, GitHub, hoặc biến môi trường có tiền tố `VITE_` / `NEXT_PUBLIC_`.

## 1. Tạo khóa dịch vụ Firebase

1. Mở Firebase Console và chọn dự án `class12a-d4eb3`.
2. Vào **Project settings → Service accounts**.
3. Tạo khóa riêng cho service account dùng bởi website. Cấp quyền IAM tối thiểu để đọc/ghi/xóa dữ liệu Firestore (Cloud Datastore User / `roles/datastore.user`).
4. Tải JSON key về máy cá nhân. Không commit tệp JSON này lên GitHub, không gửi khóa trong chat.

## 2. Thêm Environment Variables trên Vercel

Vào Vercel → project website → **Settings → Environment Variables**. Tạo đủ ba biến dưới đây cho Production (và Preview nếu cần):

- `ADMIN_PASSWORD`: mật khẩu Admin dài tối thiểu 16 ký tự, khó đoán, không dùng lại mật khẩu ở nơi khác.
- `ADMIN_SESSION_SECRET`: chuỗi ngẫu nhiên bí mật tối thiểu 32 ký tự. Có thể tạo bằng lệnh:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- `FIREBASE_SERVICE_ACCOUNT_JSON`: toàn bộ nội dung JSON key tải ở bước 1, dán thành một giá trị duy nhất.

Chỉ lưu các giá trị này trong Vercel Environment Variables. Không đưa chúng vào mã nguồn, commit, issue, hoặc ảnh chụp màn hình.

## 3. Deploy và kiểm tra

1. Merge pull request này vào `main`; Vercel sẽ triển khai bản mới.
2. Nếu đã thêm biến môi trường sau khi deploy, chạy **Redeploy** để Function nhận biến mới.
3. Mở website, nhấn biểu tượng bánh răng ở góc dưới phải, đăng nhập bằng `ADMIN_PASSWORD`.
4. Kiểm tra cả hai tab **Sổ lưu bút** và **Danh sách RSVP**; thử tạo, sửa, xóa một bản ghi kiểm thử.

## Phạm vi quyền

Admin API cho phép xem tối đa 500 bản ghi mới nhất của mỗi collection, thêm/sửa/xóa tài liệu trong `luubuot` và `rsvps`, và xuất CSV từ dữ liệu đang tải. Mỗi thao tác đọc/ghi/xóa đều được xác thực ở server bằng cookie phiên `HttpOnly; Secure; SameSite=Strict`.

Firebase Admin SDK truy cập Firestore bằng service account và không phụ thuộc quyền client-side Firestore Rules. Không chia sẻ khóa service account. Khi nghi ngờ lộ mật khẩu hoặc khóa, hãy thay ngay trong Vercel / Google Cloud và redeploy.

Lưu ý: giới hạn thử mật khẩu trong API là lớp bảo vệ cơ bản theo từng instance serverless; nên bật thêm Vercel Firewall / rate limiting cho `/api/admin` nếu website được công khai rộng rãi.
