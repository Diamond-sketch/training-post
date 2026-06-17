// ============================================
// เชื่อมต่อ Supabase
// ============================================
const cfg = window.SUPABASE_CONFIG || {};
const isConfigured =
  cfg.url &&
  cfg.anonKey &&
  !cfg.url.includes("YOUR_SUPABASE") &&
  !cfg.anonKey.includes("YOUR_SUPABASE");

let db = null;
if (isConfigured) {
  db = window.supabase.createClient(cfg.url, cfg.anonKey);
} else {
  document.getElementById("configWarning").style.display = "block";
}

// ============================================
// ค่าคงที่
// ============================================
const VIDEO_BUCKET = "post-videos";

let selectedVideo = null;     // File ที่ผู้ใช้เลือก
let selectedDuration = 0;     // วินาที

// ============================================
// องค์ประกอบ DOM
// ============================================
const videoSlot = document.getElementById("videoSlot");
const videoFileInput = document.getElementById("videoFile");
const previewVideo = videoSlot.querySelector("video.preview");
const removeVideoBtn = document.getElementById("removeVideoBtn");
const durationBadge = document.getElementById("durationBadge");
const form = document.getElementById("videoForm");
const submitBtn = document.getElementById("submitBtn");

// ============================================
// เลือกวิดีโอ + ตรวจ duration
// ============================================
videoFileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const { duration, url } = await loadVideoMetadata(file);

    selectedVideo = file;
    selectedDuration = duration;
    previewVideo.src = url;
    videoSlot.classList.add("has-video");
    durationBadge.textContent = formatDuration(duration);
    durationBadge.classList.remove("invalid");
    clearAlert();
  } catch (err) {
    console.error(err);
    // ถ้าอ่าน metadata ไม่ได้ ก็ยังให้โพสต์ได้อยู่ดี
    selectedVideo = file;
    selectedDuration = 0;
    previewVideo.src = URL.createObjectURL(file);
    videoSlot.classList.add("has-video");
    durationBadge.textContent = "";
    durationBadge.classList.remove("invalid");
    clearAlert();
  }
});

removeVideoBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetVideoSlot();
});

function resetVideoSlot() {
  selectedVideo = null;
  selectedDuration = 0;
  videoFileInput.value = "";
  if (previewVideo.src) {
    try { URL.revokeObjectURL(previewVideo.src); } catch (_) {}
  }
  previewVideo.removeAttribute("src");
  previewVideo.load();
  videoSlot.classList.remove("has-video");
  durationBadge.textContent = "";
  durationBadge.classList.remove("invalid");
}

function loadVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;

    const cleanup = () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("error", onErr);
    };
    const onMeta = () => {
      const duration = v.duration;
      cleanup();
      if (!isFinite(duration) || duration <= 0) {
        reject(new Error("ไม่สามารถอ่าน duration ได้"));
        return;
      }
      resolve({ duration, url });
    };
    const onErr = () => {
      cleanup();
      reject(new Error("โหลดวิดีโอไม่สำเร็จ"));
    };

    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("error", onErr);
    v.src = url;
  });
}

// ============================================
// อัปโหลด + บันทึก
// ============================================
async function uploadVideo(file) {
  const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  const { data, error } = await db.storage
    .from(VIDEO_BUCKET)
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "video/mp4",
    });

  if (error) throw error;

  const { data: urlData } = db.storage
    .from(VIDEO_BUCKET)
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!db) {
    showAlert("error", "ยังไม่ได้ตั้งค่า Supabase กรุณาเปิด config.js");
    return;
  }

  const studentName = document.getElementById("studentName").value.trim();
  const caption = document.getElementById("caption").value.trim();

  if (!studentName) {
    showAlert("error", "กรุณากรอกชื่อ");
    return;
  }
  if (!selectedVideo) {
    showAlert("error", "กรุณาเลือกวิดีโอ");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "กำลังอัปโหลด...";

  try {
    const videoUrl = await uploadVideo(selectedVideo);

    submitBtn.textContent = "กำลังบันทึก...";
    const { error: insertError } = await db.from("videos").insert({
      student_name: studentName,
      caption: caption || null,
      video_url: videoUrl,
      duration_seconds: selectedDuration > 0 ? Math.round(selectedDuration * 10) / 10 : null,
    });

    if (insertError) throw insertError;

    form.reset();
    resetVideoSlot();
    showAlert("success", "โพสต์วิดีโอสำเร็จ!");
    loadVideos();
  } catch (err) {
    console.error(err);
    showAlert("error", "โพสต์ไม่สำเร็จ: " + (err.message || err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "โพสต์";
  }
});

// ============================================
// โหลด + แสดง feed
// ============================================
const videosCache = new Map();

async function loadVideos() {
  const feed = document.getElementById("feed");

  if (!db) {
    feed.innerHTML = '<div class="status">ตั้งค่า Supabase ก่อนเพื่อดูวิดีโอ</div>';
    return;
  }

  feed.innerHTML = '<div class="status">กำลังโหลดวิดีโอ...</div>';

  const { data, error } = await db
    .from("videos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    feed.innerHTML = `<div class="status error">โหลดวิดีโอไม่สำเร็จ: ${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!data || data.length === 0) {
    videosCache.clear();
    feed.innerHTML = '<div class="status">ยังไม่มีวิดีโอ มาเป็นคนแรกกัน!</div>';
    return;
  }

  videosCache.clear();
  data.forEach((v) => videosCache.set(v.id, v));
  feed.innerHTML = data.map(renderVideo).join("");
}

function renderVideo(v) {
  const initial = (v.student_name || "?").charAt(0).toUpperCase();
  const timeAgo = formatTimeAgo(v.created_at);
  const durationLabel = v.duration_seconds ? formatDuration(v.duration_seconds) : "";

  const captionHtml = v.caption
    ? `<div class="post-content">${escapeHtml(v.caption)}</div>`
    : "";

  return `
    <article class="card" data-video-id="${escapeHtml(v.id)}">
      <div class="post-header">
        <div class="avatar">${escapeHtml(initial)}</div>
        <div style="flex:1;">
          <div class="post-name">${escapeHtml(v.student_name || "ไม่ระบุชื่อ")}</div>
          <div class="post-time">${timeAgo}${durationLabel ? " · " + durationLabel : ""}</div>
        </div>
        <div class="post-actions">
          <button type="button" class="icon-btn delete-btn" data-action="delete" title="ลบ">🗑️</button>
        </div>
      </div>
      <div class="post-body">
        ${captionHtml}
        <video class="post-video" controls playsinline preload="metadata" src="${escapeHtml(v.video_url)}"></video>
      </div>
    </article>
  `;
}

// ============================================
// ลบ
// ============================================
document.getElementById("feed").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const article = btn.closest("[data-video-id]");
  if (!article) return;
  const videoId = article.dataset.videoId;

  if (btn.dataset.action === "delete") {
    await deleteVideo(article, videoId, btn);
  }
});

async function deleteVideo(article, videoId, btn) {
  if (!confirm("ลบวิดีโอนี้แน่นะ?")) return;
  btn.disabled = true;

  const v = videosCache.get(videoId);
  if (v && v.video_url) {
    const m = v.video_url.match(/\/post-videos\/(.+)$/);
    if (m) {
      await db.storage.from(VIDEO_BUCKET).remove([m[1]]);
    }
  }

  const { error } = await db.from("videos").delete().eq("id", videoId);
  if (error) {
    showAlert("error", "ลบไม่สำเร็จ: " + error.message);
    btn.disabled = false;
    return;
  }

  videosCache.delete(videoId);
  article.remove();
  showAlert("success", "ลบวิดีโอแล้ว");

  const feed = document.getElementById("feed");
  if (feed.querySelectorAll("[data-video-id]").length === 0) {
    feed.innerHTML = '<div class="status">ยังไม่มีวิดีโอ มาเป็นคนแรกกัน!</div>';
  }
}

// ============================================
// Helpers
// ============================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "เมื่อสักครู่";
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function showAlert(type, message) {
  const area = document.getElementById("alertArea");
  area.innerHTML = `<div class="${type}">${escapeHtml(message)}</div>`;
  if (type === "success") {
    setTimeout(() => (area.innerHTML = ""), 3000);
  }
}

function clearAlert() {
  document.getElementById("alertArea").innerHTML = "";
}

// ============================================
// Start
// ============================================
loadVideos();
