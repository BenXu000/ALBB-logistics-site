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
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  const resp = await fetch(CFG.API_BASE + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
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

// ---------- 外箱唛头 LABEL（10×10cm，每箱一张，仓库凭此收货） ----------
// 内容：唛头 LQYT+年月+序号 / 订单号 CKA-xxxxx(空运) SEA-xxxxx(海运) / 箱号 1/N…N/N / Made in China
function printLabels(order) {
  const n = Math.max(1, Number(order.pieces) || 1);
  const marking = order.markingNo || "";
  const orderNo = order.orderNo || "";
  const labels = [];
  for (let i = 1; i <= n; i++) {
    labels.push(
      `<div class="lbl">
        <div class="row1">唛头：${esc(marking)}</div>
        <div class="row2">订单号：${esc(orderNo)}</div>
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
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>外箱唛头 ${esc(marking)}（共${n}张）</title>
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
      .row2 { font-size: 16pt; font-weight: 600; }
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
async function uploadOne(file, onStep = () => {}) {
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
    body: { name, dataBase64: await blobToBase64(blob) },
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
    <div class="user-box">
      ${isAdmin ? '<span class="badge orange">管理员</span>' : ""}
      <span>客户代码 <b>${esc(user ? user.code : "")}</b></span>
      <button class="btn ghost sm" onclick="logout()">退出</button>
    </div>`;
  return user;
}
