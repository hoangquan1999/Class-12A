const crypto = require("node:crypto");
const admin = require("firebase-admin");

const COOKIE = "12a_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;
const attempts = new Map();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, private");
  res.end(JSON.stringify(body));
}
function secret() {
  const value = process.env.ADMIN_SESSION_SECRET || "";
  if (value.length < 32) throw new Error("ADMIN_SESSION_SECRET phải có ít nhất 32 ký tự.");
  return value;
}
function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}
function cookieValue(req) {
  const raw = req.headers.cookie || "";
  const pair = raw.split(";").map(v => v.trim()).find(v => v.startsWith(COOKIE + "="));
  return pair ? decodeURIComponent(pair.slice(COOKIE.length + 1)) : "";
}
function validSession(req) {
  const token = cookieValue(req);
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expected = Buffer.from(sign(parts[0]));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch (_) { return false; }
}
function setSession(res) {
  const payload = Buffer.from(JSON.stringify({exp: Math.floor(Date.now()/1000) + SESSION_SECONDS})).toString("base64url");
  const token = payload + "." + sign(payload);
  res.setHeader("Set-Cookie", COOKIE + "=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_SECONDS);
}
function clearSession(res) {
  res.setHeader("Set-Cookie", COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
}
function db() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error("Thiếu FIREBASE_SERVICE_ACCOUNT_JSON trên Vercel.");
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({credential: admin.credential.cert(serviceAccount)});
  }
  return admin.firestore();
}
function collectionName(value) {
  if (value !== "luubuot" && value !== "rsvps") throw new Error("Collection không hợp lệ.");
  return value;
}
function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}
function serialize(doc) {
  const data = doc.data();
  const createdAt = data.createdAt && typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : "";
  return {id: doc.id, name: data.name || "", role: data.role || "", message: data.message || "", createdAt};
}
async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) throw new Error("Dữ liệu gửi lên quá lớn.");
  }
  return raw ? JSON.parse(raw) : {};
}
module.exports = async function handler(req, res) {
  const url = new URL(req.url, "https://" + (req.headers.host || "localhost"));
  const action = url.searchParams.get("action") || "";
  if (!checkOrigin(req)) return send(res, 403, {error:"Nguồn yêu cầu không hợp lệ."});
  if (req.method === "GET" && action === "me") {
    try { return validSession(req) ? send(res,200,{authenticated:true}) : send(res,401,{error:"Chưa đăng nhập."}); }
    catch (e) { return send(res,500,{error:"Máy chủ chưa được cấu hình đầy đủ."}); }
  }
  if (req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch (_) { return send(res,400,{error:"Dữ liệu không hợp lệ."}); }
    if (action === "login") {
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const state = attempts.get(ip) || {count:0, until:0};
      if (state.until > now) return send(res,429,{error:"Quá nhiều lần thử. Vui lòng chờ 15 phút."});
      const configured = process.env.ADMIN_PASSWORD || "";
      if (!configured || configured.length < 12) return send(res,503,{error:"Admin chưa được cấu hình mật khẩu đủ mạnh trên Vercel."});
      const provided = typeof body.password === "string" ? body.password : "";
      const a = Buffer.from(configured);
      const b = Buffer.from(provided);
      const ok = a.length === b.length && crypto.timingSafeEqual(a,b);
      if (!ok) {
        state.count += 1;
        if (state.count >= 8) { state.count = 0; state.until = now + 15*60*1000; }
        attempts.set(ip,state);
        return send(res,401,{error:"Mật khẩu không chính xác."});
      }
      attempts.delete(ip);
      try { secret(); } catch (_) { return send(res,503,{error:"Thiếu cấu hình bảo mật phiên Admin trên Vercel."}); }
      setSession(res);
      return send(res,200,{authenticated:true});
    }
    if (action === "logout") { clearSession(res); return send(res,200,{ok:true}); }
    if (!validSession(req)) return send(res,401,{error:"Phiên đăng nhập hết hạn. Hãy đăng nhập lại."});
    try {
      const store = db();
      if (action === "create") {
        const col = collectionName(body.collection);
        const name = clean(body.name,120), role = clean(body.role,80), message = clean(body.message,2000);
        if (!name || !role || (col === "luubuot" && !message)) return send(res,400,{error:"Vui lòng nhập đủ thông tin."});
        const data = {name,role,createdAt:admin.firestore.FieldValue.serverTimestamp()};
        if (col === "luubuot") data.message = message;
        const ref = await store.collection(col).add(data);
        return send(res,200,{ok:true,id:ref.id});
      }
      if (action === "update") {
        const col = collectionName(body.collection);
        const id = clean(body.id,150);
        const name = clean(body.name,120), role = clean(body.role,80);
        if (!id || !name || !role) return send(res,400,{error:"Thiếu ID, họ tên hoặc vai trò."});
        const patch = {name,role};
        if (col === "luubuot") patch.message = clean(body.message,2000);
        await store.collection(col).doc(id).update(patch);
        return send(res,200,{ok:true});
      }
      if (action === "delete") {
        const col = collectionName(body.collection);
        const id = clean(body.id,150);
        if (!id) return send(res,400,{error:"Thiếu ID bản ghi."});
        await store.collection(col).doc(id).delete();
        return send(res,200,{ok:true});
      }
      return send(res,404,{error:"Không tìm thấy thao tác."});
    } catch (error) {
      console.error("Admin API error:", error.message);
      return send(res,500,{error:"Không thể thực hiện thao tác. Hãy kiểm tra cấu hình Firebase trên Vercel."});
    }
  }
  if (req.method === "GET" && action === "data") {
    if (!validSession(req)) return send(res,401,{error:"Phiên đăng nhập hết hạn. Hãy đăng nhập lại."});
    try {
      const store = db();
      const [wishes, rsvps] = await Promise.all([
        store.collection("luubuot").orderBy("createdAt","desc").limit(500).get(),
        store.collection("rsvps").orderBy("createdAt","desc").limit(500).get()
      ]);
      return send(res,200,{luubuot:wishes.docs.map(serialize),rsvps:rsvps.docs.map(serialize)});
    } catch (error) {
      console.error("Admin data error:", error.message);
      return send(res,500,{error:"Không đọc được dữ liệu. Kiểm tra quyền truy cập Firestore."});
    }
  }
  return send(res,405,{error:"Phương thức hoặc thao tác không được hỗ trợ."});
};
