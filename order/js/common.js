// ===== 公共脚本：登录态、接口封装、侧边栏 =====

const CFG = window.ALBB_CONFIG;
const AUTH_TOKEN_KEY = "albb_order_token";
const AUTH_USER_KEY = "albb_order_user";

const CHANNELS = [
  { key: "saudi-air", name: "沙特空运" },
  { key: "saudi-sea", name: "沙特海运" },
  { key: "uae-sea", name: "阿联酋海运" },
  { key: "uae-air", name: "阿联酋空运" },
];

function channelName(key) {
  const c = CHANNELS.find((x) => x.key === key);
  return c ? c.name : key || "-";
}

// ---------- 登录态 ----------
function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}
function getLoginUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || "null");
  } catch {
    return null;
  }
}
function saveLogin(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}
function logout() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  location.href = "login.html";
}
// 客户页面守卫：未登录跳登录页（admin.html 自己处理）
function requireLogin() {
  if (!getToken()) location.href = "login.html";
  return getLoginUser();
}

// ---------- 接口封装 ----------
/** 统一的网络故障提示（含自检办法），避免用户看到生硬的「Failed to fetch」 */
function netErrorMsg(extra) {
  return (
    "网络连接失败，无法访问 ALBB 服务器" +
    (extra || "") +
    "。请检查本机网络、关闭 VPN/代理后重试；也可新开标签页打开 " +
    (window.ALBB_CONFIG ? window.ALBB_CONFIG.API_BASE : "") +
    "/health 测试连通（显示 ok 即网络正常）。"
  );
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  const method = options.method || "GET";
  const timeoutMs = options.timeout || 60000; // 大文件上传可传 timeout 覆盖
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(CFG.API_BASE + path, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("请求超时（" + Math.round(timeoutMs / 1000) + " 秒），网络较慢或不稳定，请重试");
    // GET 幂等，网络抖动时自动重试一次；写操作不自动重试（防止重复下单）
    if (method === "GET" && !options._retried) {
      await new Promise((r) => setTimeout(r, 800));
      return api(path, { ...options, _retried: true });
    }
    throw new Error(netErrorMsg());
  }
  clearTimeout(timer);
  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error("服务器响应异常（" + resp.status + "），请检查 Worker 是否已部署");
  }
  if (resp.status === 401) {
    logout();
    throw new Error("登录已过期");
  }
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || "请求失败（" + resp.status + "）");
  }
  return data;
}

// ---------- 通用 UI ----------
function toast(msg, type = "") {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), type === "err" ? 4000 : 2200);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtPrice(n) {
  const v = Number(n) || 0;
  return v ? v.toFixed(2) : "";
}

/** 附件下载链接：浏览器 <a> 直接打开不带登录头，统一追加 token 查询参数 */
function fileUrl(key) {
  return `${CFG.API_BASE}/api/file/${encodeURIComponent(key)}?token=${encodeURIComponent(getToken())}`;
}

// ---------- 外箱标签 LABEL（10×10cm，每箱一张，仓库凭此收货） ----------
// 内容：沙特 唛头 LQYT+年月+序号 + 入仓号 固定 CKA-42210/CKS-42210；阿联酋 只有「入仓号 ALBBWL+年月+序号」（无固定入仓号行）
// 阿联酋订单：唛头号在系统与 LABEL 上均称为「入仓号」
function isUAEOrder(o) {
  return !!(o && ((o.channel || "").startsWith("uae") || /^ALBBWL/i.test(o.markingNo || "")));
}
/** 唛头号在界面上的称谓：阿联酋=入仓号，沙特=唛头 */
function markTerm(o) {
  return isUAEOrder(o) ? "入仓号" : "唛头";
}
function printLabels(order) {
  const n = Math.max(1, Number(order.pieces) || 1);
  const marking = order.markingNo || "";
  const isUAE = isUAEOrder(order);
  // 固定入仓号仅沙特使用：空运 CKA-42210 / 海运 CKS-42210（不随订单号递增）
  const isAir = (order.channel || "").endsWith("-air") || /^CKA/i.test(order.orderNo || "");
  const asnNo = isAir ? "CKA-42210" : "CKS-42210";
  const labels = [];
  for (let i = 1; i <= n; i++) {
    labels.push(
      `<div class="lbl">
        <div class="row1">${markTerm(order)}：${esc(marking)}</div>
        ${isUAE ? "" : `<div class="row2">入仓号：${asnNo}</div>`}
        <div class="boxno">${i}/${n}</div>
        <div class="mic">Made in China</div>
      </div>`
    );
  }
  const w = window.open("", "_blank");
  if (!w) {
    toast("浏览器拦截了打印窗口，请允许弹出窗口后重试", "err");
    return;
  }
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>外箱${markTerm(order)} ${esc(marking)}（共${n}张）</title>
    <style>
      @page { size: 100mm 100mm; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: "Microsoft YaHei", "SimHei", Arial, sans-serif; }
      .lbl {
        width: 100mm; height: 100mm; padding: 7mm;
        border: 0.6mm solid #000;
        display: flex; flex-direction: column; justify-content: space-between;
        page-break-after: always;
      }
      .lbl:last-child { page-break-after: auto; }
      .row1 { font-size: 24pt; font-weight: 700; letter-spacing: 0.5mm; }
      .row2 { font-size: 20pt; font-weight: 700; letter-spacing: 0.3mm; white-space: nowrap; }
      .boxno { font-size: 34pt; font-weight: 800; text-align: center; }
      .mic { font-size: 15pt; font-weight: 600; text-align: center; letter-spacing: 1.5mm; }
      .print-tip { padding: 20px; font: 14px "Microsoft YaHei"; color: #555; }
      @media screen { .lbl { border: 1px dashed #999; margin: 10px auto; } }
      @media print { .print-tip { display: none; } }
    </style></head><body>
    <div class="print-tip">共 ${n} 张（规格 10×10cm，A4 纸打印时每页 2 张可裁切）。浏览器打印对话框中请选择"无边距/实际大小"。</div>
    ${labels.join("")}
    <script>window.onload = function () { setTimeout(function () { window.print(); }, 300); };<\/script>
    </body></html>`
  );
  w.document.close();
}

// ---------- 附件上传：图片自动压缩 ----------
const IMG_MAX_SIDE = 1920;              // 压缩后长边像素
const IMG_QUALITY = 0.82;               // JPEG 质量
const MAX_IMG_RAW_MB = 60;              // 原始图片（压缩前）单张上限
const MAX_DOC_MB = 18;                  // Excel/PDF/CSV 等不可压缩文件单张上限（KV 单值 25MB 的硬顶）
const MAX_FILES = 20;                   // 单次最多选择文件数

function isImageFile(f) {
  return /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp|heic|heif)$/i.test(f.name);
}

/** 图片压缩：统一缩到长边 1920、转 JPEG。压完更大就保留原图 */
function compressImage(file, maxSide = IMG_MAX_SIDE, quality = IMG_QUALITY) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error("图片压缩失败：" + file.name));
            resolve(blob.size < file.size ? blob : file);
          },
          "image/jpeg",
          quality
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片：" + file.name + "（HEIC 格式请先转成 JPG）"));
    };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("读取文件失败"));
    r.readAsDataURL(blob);
  });
}

function fmtSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}

/**
 * 上传单个文件（图片自动压缩），返回 {key, name, size}
 * @param {(msg:string)=>void} onStep 进度提示
 */
async function uploadOne(file, onStep = () => {}, opts = {}) {
  let blob = file;
  let name = file.name;
  if (isImageFile(file)) {
    if (file.size > MAX_IMG_RAW_MB * 1024 * 1024) {
      throw new Error(`图片「${file.name}」${fmtSize(file.size)}，超过 ${MAX_IMG_RAW_MB}MB，请先在手机/电脑上导出为 JPG`);
    }
    onStep(`压缩中：${file.name}`);
    blob = await compressImage(file);
    name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    onStep(`上传中：${file.name}（${fmtSize(file.size)} → ${fmtSize(blob.size)}）`);
  } else {
    if (file.size > MAX_DOC_MB * 1024 * 1024) {
      throw new Error(`文件「${file.name}」${fmtSize(file.size)}，超过 ${MAX_DOC_MB}MB 上限，请拆分或改用压缩包`);
    }
    onStep(`上传中：${file.name}（${fmtSize(file.size)}）`);
  }
  const up = await api("/api/upload", {
    method: "POST",
    timeout: 300000, // 大文件 base64 上传在慢网络下需要更长时间
    body: { name, dataBase64: await blobToBase64(blob), ...(opts.code ? { code: opts.code } : {}) },
  });
  return { key: up.key, name: up.name || name, size: up.size || blob.size };
}

/** 批量上传，返回 [{key,name,size}]；遇到超大文件直接抛出，提示用户 */
async function uploadFiles(fileList, onStep = () => {}) {
  const files = Array.from(fileList || []);
  if (files.length > MAX_FILES) throw new Error(`一次最多上传 ${MAX_FILES} 个文件`);
  const out = [];
  for (let i = 0; i < files.length; i++) {
    onStep(`（${i + 1}/${files.length}）${files[i].name}`);
    out.push(await uploadOne(files[i], onStep));
  }
  return out;
}

// ---------- 侧边栏 / 顶栏 ----------
// page: 当前页标识，用于高亮
function renderShell(page, title) {
  const user = requireLogin();
  const isAdmin = user && user.role === "admin";
  const links = [
    { key: "new", href: "index.html", ico: "⊕", name: "新建订单" },
    ...CHANNELS.map((c) => ({
      key: c.key,
      href: "list.html?channel=" + c.key,
      ico: "◉",
      name: c.name,
    })),
    { key: "tracking", href: "tracking.html", ico: "◉", name: "货件查询" },
    { key: "profile", href: "profile.html", ico: "◎", name: "公司资料" },
  ];
  const sideHtml = links
    .map((l) => `<a class="side-link${page === l.key ? " active" : ""}" href="${l.href}"><span class="ico">${l.ico}</span>${l.name}</a>`)
    .join("");

  document.getElementById("sidebar").innerHTML = `
    <div class="side-logo">
      <div class="brand">ALBB LOGISTICS</div>
      <div class="sub">客户下单系统</div>
    </div>
    <div class="side-group bar">☰ 订单管理</div>
    ${sideHtml}
    <div class="side-bottom">© ALBB LOGISTICS<br>深圳阿联比伯国际物流</div>`;

  document.getElementById("topbar").innerHTML = `
    <div class="page-title">${esc(title)}</div>
    <div class="user-box" style="position: relative">
      ${isAdmin ? '<span class="badge orange">管理员</span>' : ""}
      <button class="btn ghost sm" id="userMenuBtn" style="border: none">👤 客户代码 <b>${esc(user ? user.code : "")}</b> ▾</button>
      <div class="user-menu" id="userMenu" style="display: none">
        <a href="profile.html">个人资料 / Profile</a>
        <button type="button" onclick="openChangePwd()">修改密码 / Password</button>
        <button type="button" onclick="openWechatBind()">绑定/解绑微信 Wechat</button>
        <button type="button" class="danger" onclick="logout()">退出 / Logout</button>
      </div>
    </div>`;

  const menuBtn = document.getElementById("userMenuBtn");
  const menu = document.getElementById("userMenu");
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", () => (menu.style.display = "none"));
  menu.addEventListener("click", (e) => e.stopPropagation());
  return user;
}

// ---------- 个人中心：修改密码 / 绑定解绑微信（全局弹窗） ----------
function openUserModalBox(innerHtml, width = "460px") {
  document.querySelectorAll(".modal-mask[data-usermodal]").forEach((m) => m.remove());
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.setAttribute("data-usermodal", "1");
  mask.style.display = "flex";
  mask.innerHTML = `<div class="modal" style="width:${width}">${innerHtml}</div>`;
  // 注意：不绑定「点击遮罩关闭」——避免切换窗口复制资料回来误点导致填写内容全部丢失，只能通过「取消」按钮关闭
  document.body.appendChild(mask);
  return mask;
}

/** 修改密码弹窗 */
function openChangePwd() {
  const mask = openUserModalBox(`
    <h3>修改密码 / Change Password</h3>
    <div class="field" style="margin-bottom:12px"><label style="width:88px" class="req">原密码</label><input id="upw_old" type="password" /></div>
    <div class="field" style="margin-bottom:12px"><label style="width:88px" class="req">新密码</label><input id="upw_new" type="password" placeholder="至少 6 位" /></div>
    <div class="field" style="margin-bottom:12px"><label style="width:88px" class="req">确认新密码</label><input id="upw_new2" type="password" /></div>
    <div class="modal-foot">
      <button class="btn ghost" onclick="this.closest('.modal-mask').remove()">取消</button>
      <button class="btn orange" id="upwSave">✔ 确认修改</button>
    </div>`);
  mask.querySelector("#upwSave").addEventListener("click", async () => {
    const oldPwd = mask.querySelector("#upw_old").value;
    const newPwd = mask.querySelector("#upw_new").value;
    const newPwd2 = mask.querySelector("#upw_new2").value;
    if (!oldPwd) return toast("请输入原密码", "err");
    if (newPwd.length < 6) return toast("新密码至少 6 位", "err");
    if (newPwd !== newPwd2) return toast("两次输入的新密码不一致", "err");
    const btn = mask.querySelector("#upwSave");
    btn.disabled = true;
    try {
      await api("/api/password", { method: "PUT", body: { oldPassword: oldPwd, newPassword: newPwd } });
      toast("密码修改成功，下次登录请使用新密码", "ok");
      mask.remove();
    } catch (e) {
      toast(e.message, "err");
      btn.disabled = false;
    }
  });
  mask.querySelector("#upw_old").focus();
}

/** 绑定 / 解绑微信弹窗 */
async function openWechatBind() {
  let current = (getLoginUser() || {}).wechat || "";
  // 拉最新资料，避免 localStorage 里的旧数据
  try {
    const { profile } = await api("/api/profile");
    current = profile.wechat || "";
    const u = getLoginUser();
    if (u) {
      u.wechat = current;
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(u));
    }
  } catch (e) {
    /* 静默：用本地值 */
  }
  const bound = !!current;
  const mask = openUserModalBox(`
    <h3>绑定/解绑微信 / Wechat</h3>
    <p style="font-size:12.5px;color:#6b7280;margin-bottom:12px">
      当前状态：${bound ? `已绑定 <b style="color:#2e7d32">${esc(current)}</b>` : '<span style="color:#dc2626">未绑定</span>'}
    </p>
    <div class="field" style="margin-bottom:12px">
      <label style="width:88px" class="req">微信号</label>
      <input id="uwc_input" placeholder="${bound ? "输入新微信号可更换绑定" : "请输入您的微信号"}" />
    </div>
    <div class="modal-foot">
      ${bound ? '<button class="btn ghost" id="uwcUnbind" style="color:#dc2626;border-color:#dc2626">解绑微信</button>' : ""}
      <button class="btn ghost" onclick="this.closest('.modal-mask').remove()">取消</button>
      <button class="btn orange" id="uwcSave">✔ ${bound ? "更换绑定" : "绑定"}</button>
    </div>`);
  mask.querySelector("#uwcSave").addEventListener("click", async () => {
    const wechat = mask.querySelector("#uwc_input").value.trim();
    if (!wechat) return toast("请输入微信号", "err");
    try {
      const r = await api("/api/wechat", { method: "PUT", body: { action: "bind", wechat } });
      const u = getLoginUser();
      if (u) {
        u.wechat = r.wechat;
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(u));
      }
      toast("微信绑定成功", "ok");
      mask.remove();
    } catch (e) {
      toast(e.message, "err");
    }
  });
  const unbindBtn = mask.querySelector("#uwcUnbind");
  if (unbindBtn)
    unbindBtn.addEventListener("click", async () => {
      if (!confirm("确定解绑微信吗？")) return;
      try {
        const r = await api("/api/wechat", { method: "PUT", body: { action: "unbind" } });
        const u = getLoginUser();
        if (u) {
          u.wechat = r.wechat;
          localStorage.setItem(AUTH_USER_KEY, JSON.stringify(u));
        }
        toast("微信已解绑", "ok");
        mask.remove();
      } catch (e) {
        toast(e.message, "err");
      }
    });
}

// ---------- 导出 Excel（.xlsx，纯前端生成，零依赖） ----------
/** 无压缩 ZIP 打包（仅 STORE 方式，Office 可正常打开） */
function zipStore(files) {
  const table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = (c >>> 8) ^ table[(c ^ b[i]) & 0xff];
    return (c ^ -1) >>> 0;
  };
  const parts = [];
  const central = [];
  let offset = 0;
  files.forEach((f) => {
    const name = new TextEncoder().encode(f.name);
    const crc = crc32(f.data);
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 33, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    lh.set(name, 30);
    parts.push(lh, f.data);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + f.data.length;
  });
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

/** 生成并下载 .xlsx。rows = [[表头...],[数据...],...]，首行加粗；colWidths 为各列宽度（字符数） */
function downloadXlsx(filename, sheetName, rows, colWidths) {
  const enc = new TextEncoder();
  const xesc = (v) =>
    String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const colName = (i) => {
    let s = "";
    let n = i + 1;
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  let sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  if (colWidths && colWidths.length) {
    sheet +=
      "<cols>" +
      colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") +
      "</cols>";
  }
  sheet += "<sheetData>";
  rows.forEach((row, r) => {
    sheet += `<row r="${r + 1}">`;
    row.forEach((v, c) => {
      sheet += `<c r="${colName(c)}${r + 1}"${r === 0 ? ' s="1"' : ""} t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    });
    sheet += "</row>";
  });
  sheet += "</sheetData></worksheet>";

  const nm = (xesc(sheetName || "Sheet1").replace(/[\\\/\?\*\[\]:]/g, " ") || "Sheet1").slice(0, 31);
  const ct =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const wb =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' +
    nm +
    '" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="微软雅黑"/></font><font><b/><sz val="11"/><name val="微软雅黑"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const files = [
    ["[Content_Types].xml", ct],
    ["_rels/.rels", rootRels],
    ["xl/workbook.xml", wb],
    ["xl/_rels/workbook.xml.rels", wbRels],
    ["xl/styles.xml", styles],
    ["xl/worksheets/sheet1.xml", sheet],
  ].map(([name, txt]) => ({ name, data: enc.encode(txt) }));

  const blob = new Blob([zipStore(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename || "export.xlsx";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
