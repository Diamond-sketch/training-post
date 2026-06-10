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
// ตัวแปร / ค่าคงที่
// ============================================
const STORAGE_BUCKET = "post-images";
const MAX_IMAGES = 3;
const MAX_FILE_MB = 5;

const selectedFiles = [null, null, null]; // เก็บไฟล์ที่ผู้ใช้เลือก

// ============================================
// จัดการ Image slots
// ============================================
document.querySelectorAll(".image-slot").forEach((slot) => {
  const slotIndex = parseInt(slot.dataset.slot, 10);
  const fileInput = slot.querySelector('input[type="file"]');
  const removeBtn = slot.querySelector(".remove-btn");

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      showAlert("error", `รูปใหญ่เกิน ${MAX_FILE_MB}MB กรุณาเลือกรูปเล็กกว่านี้`);
      fileInput.value = "";
      return;
    }

    selectedFiles[slotIndex] = file;

    // แสดงภาพ preview
    const reader = new FileReader();
    reader.onload = (ev) => {
      // ลบ preview เก่า (ถ้ามี)
      const oldPreview = slot.querySelector("img.preview");
      if (oldPreview) oldPreview.remove();

      const img = document.createElement("img");
      img.className = "preview";
      img.src = ev.target.result;
      slot.appendChild(img);
      slot.classList.add("has-image");
    };
    reader.readAsDataURL(file);
  });

  removeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectedFiles[slotIndex] = null;
    fileInput.value = "";
    const preview = slot.querySelector("img.preview");
    if (preview) preview.remove();
    slot.classList.remove("has-image");
  });
});

// ============================================
// อัปโหลดรูปขึ้น Supabase Storage
// ============================================
async function uploadImage(file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  const { data, error } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;

  const { data: urlData } = db.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}

// ============================================
// Submit ฟอร์ม
// ============================================
const form = document.getElementById("postForm");
const submitBtn = document.getElementById("submitBtn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!db) {
    showAlert("error", "ยังไม่ได้ตั้งค่า Supabase กรุณาเปิด config.js");
    return;
  }

  const studentName = document.getElementById("studentName").value.trim();
  const promptUsed = document.getElementById("promptUsed").value.trim();
  const content = document.getElementById("content").value.trim();

  if (!studentName || !content) {
    showAlert("error", "กรุณากรอกชื่อและเนื้อหา");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "กำลังโพสต์...";

  try {
    // 1) อัปโหลดรูปทุกรูป
    const filesToUpload = selectedFiles.filter((f) => f !== null);
    const imageUrls = [];
    for (let i = 0; i < filesToUpload.length; i++) {
      submitBtn.textContent = `กำลังอัปโหลดรูป ${i + 1}/${filesToUpload.length}...`;
      const url = await uploadImage(filesToUpload[i]);
      imageUrls.push(url);
    }

    // 2) บันทึกโพสต์ลงตาราง
    submitBtn.textContent = "กำลังบันทึก...";
    const { error: insertError } = await db.from("posts").insert({
      student_name: studentName,
      prompt_used: promptUsed || null,
      content: content,
      image_urls: imageUrls,
    });

    if (insertError) throw insertError;

    // 3) เคลียร์ฟอร์ม + โหลดใหม่
    resetForm();
    showAlert("success", "โพสต์สำเร็จ!");
    loadPosts();
  } catch (err) {
    console.error(err);
    showAlert("error", "โพสต์ไม่สำเร็จ: " + (err.message || err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "โพสต์";
  }
});

function resetForm() {
  form.reset();
  for (let i = 0; i < MAX_IMAGES; i++) {
    selectedFiles[i] = null;
    const slot = document.querySelector(`.image-slot[data-slot="${i}"]`);
    const preview = slot.querySelector("img.preview");
    if (preview) preview.remove();
    slot.classList.remove("has-image");
  }
}

// ============================================
// โหลดและแสดงโพสต์
// ============================================
const postsCache = new Map(); // id -> post

async function loadPosts() {
  const feed = document.getElementById("feed");

  if (!db) {
    feed.innerHTML = '<div class="status">ตั้งค่า Supabase ก่อนเพื่อดูโพสต์</div>';
    return;
  }

  feed.innerHTML = '<div class="status">กำลังโหลดโพสต์...</div>';

  const { data, error } = await db
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    feed.innerHTML = `<div class="status error">โหลดโพสต์ไม่สำเร็จ: ${error.message}</div>`;
    return;
  }

  if (!data || data.length === 0) {
    postsCache.clear();
    feed.innerHTML = '<div class="status">ยังไม่มีโพสต์ มาเป็นคนแรกกัน!</div>';
    return;
  }

  postsCache.clear();
  data.forEach((p) => postsCache.set(p.id, p));

  feed.innerHTML = data.map(renderPost).join("");
  attachLightboxListeners();
}

function renderPost(post) {
  const initial = (post.student_name || "?").charAt(0).toUpperCase();
  const timeAgo = formatTimeAgo(post.created_at);
  const edited = post.updated_at && post.updated_at !== post.created_at;
  const images = Array.isArray(post.image_urls) ? post.image_urls : [];
  const imageCount = Math.min(images.length, 3);

  const imagesHtml =
    imageCount > 0
      ? `<div class="post-images count-${imageCount}">
          ${images
            .slice(0, 3)
            .map(
              (url) =>
                `<img src="${escapeHtml(url)}" alt="รูปประกอบ" loading="lazy" data-full="${escapeHtml(url)}" />`
            )
            .join("")}
        </div>`
      : "";

  const promptHtml = post.prompt_used
    ? `<div class="post-prompt">
        <div class="post-prompt-label">Prompt ที่ใช้</div>
        ${escapeHtml(post.prompt_used)}
      </div>`
    : "";

  return `
    <article class="card" data-post-id="${escapeHtml(post.id)}">
      <div class="post-header">
        <div class="avatar">${escapeHtml(initial)}</div>
        <div style="flex:1;">
          <div class="post-name">${escapeHtml(post.student_name || "ไม่ระบุชื่อ")}</div>
          <div class="post-time">${timeAgo}${edited ? " · แก้ไขแล้ว" : ""}</div>
        </div>
        <div class="post-actions">
          <button type="button" class="icon-btn edit-btn" data-action="edit" title="แก้ไข">✏️</button>
          <button type="button" class="icon-btn delete-btn" data-action="delete" title="ลบ">🗑️</button>
        </div>
      </div>
      <div class="post-body">
        <div class="post-content">${escapeHtml(post.content || "")}</div>
        ${promptHtml}
        ${imagesHtml}
      </div>
    </article>
  `;
}

function renderEditForm(post) {
  return `
    <div class="edit-form">
      <div class="field">
        <label>ชื่อ-นามสกุล / เลขที่</label>
        <input type="text" data-edit="student_name" value="${escapeHtml(post.student_name || "")}" maxlength="100" />
      </div>
      <div class="field">
        <label>Prompt ที่ใช้</label>
        <input type="text" data-edit="prompt_used" value="${escapeHtml(post.prompt_used || "")}" maxlength="300" />
      </div>
      <div class="field">
        <label>เนื้อหา</label>
        <textarea data-edit="content" maxlength="2000">${escapeHtml(post.content || "")}</textarea>
      </div>
      <div class="edit-actions">
        <button type="button" class="btn-secondary" data-action="cancel-edit">ยกเลิก</button>
        <button type="button" class="btn-primary" data-action="save-edit">บันทึก</button>
      </div>
    </div>
  `;
}

// ============================================
// Edit / Delete handlers (event delegation)
// ============================================
document.getElementById("feed").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const article = btn.closest("[data-post-id]");
  if (!article) return;
  const postId = article.dataset.postId;
  const action = btn.dataset.action;

  if (action === "edit") {
    enterEditMode(article, postId);
  } else if (action === "cancel-edit") {
    exitEditMode(article, postId);
  } else if (action === "save-edit") {
    await saveEdit(article, postId, btn);
  } else if (action === "delete") {
    await deletePost(article, postId, btn);
  }
});

function enterEditMode(article, postId) {
  const post = postsCache.get(postId);
  if (!post) return;
  const body = article.querySelector(".post-body");
  body.innerHTML = renderEditForm(post);
  // hide edit/delete buttons during edit
  article.querySelector(".post-actions").style.display = "none";
  body.querySelector('[data-edit="content"]').focus();
}

function exitEditMode(article, postId) {
  const post = postsCache.get(postId);
  if (!post) return;
  const body = article.querySelector(".post-body");
  const images = Array.isArray(post.image_urls) ? post.image_urls : [];
  const imageCount = Math.min(images.length, 3);
  const imagesHtml =
    imageCount > 0
      ? `<div class="post-images count-${imageCount}">
          ${images
            .slice(0, 3)
            .map(
              (url) =>
                `<img src="${escapeHtml(url)}" alt="รูปประกอบ" loading="lazy" data-full="${escapeHtml(url)}" />`
            )
            .join("")}
        </div>`
      : "";
  const promptHtml = post.prompt_used
    ? `<div class="post-prompt">
        <div class="post-prompt-label">Prompt ที่ใช้</div>
        ${escapeHtml(post.prompt_used)}
      </div>`
    : "";
  body.innerHTML = `
    <div class="post-content">${escapeHtml(post.content || "")}</div>
    ${promptHtml}
    ${imagesHtml}
  `;
  article.querySelector(".post-actions").style.display = "";
  attachLightboxListeners();
}

async function saveEdit(article, postId, btn) {
  const body = article.querySelector(".post-body");
  const newName = body.querySelector('[data-edit="student_name"]').value.trim();
  const newPrompt = body.querySelector('[data-edit="prompt_used"]').value.trim();
  const newContent = body.querySelector('[data-edit="content"]').value.trim();

  if (!newName || !newContent) {
    showAlert("error", "ชื่อและเนื้อหาห้ามว่าง");
    return;
  }

  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  const updates = {
    student_name: newName,
    prompt_used: newPrompt || null,
    content: newContent,
  };

  // ลองเซ็ต updated_at ถ้ามี column นี้ (จะ fallback ถ้า column ไม่มี)
  const { data, error } = await db
    .from("posts")
    .update(updates)
    .eq("id", postId)
    .select()
    .single();

  if (error) {
    showAlert("error", "บันทึกไม่สำเร็จ: " + error.message);
    btn.disabled = false;
    btn.textContent = "บันทึก";
    return;
  }

  // อัปเดต cache + re-render ทั้ง article
  postsCache.set(postId, data);
  const newHtml = renderPost(data);
  const tmp = document.createElement("div");
  tmp.innerHTML = newHtml.trim();
  article.replaceWith(tmp.firstChild);
  attachLightboxListeners();
  showAlert("success", "แก้ไขสำเร็จ");
}

async function deletePost(article, postId, btn) {
  if (!confirm("ลบโพสต์นี้แน่นะ?")) return;

  btn.disabled = true;

  // ลบรูปออกจาก storage ก่อน (ถ้ามี)
  const post = postsCache.get(postId);
  if (post && Array.isArray(post.image_urls) && post.image_urls.length > 0) {
    const paths = post.image_urls
      .map((url) => {
        const m = url.match(/\/post-images\/(.+)$/);
        return m ? m[1] : null;
      })
      .filter(Boolean);
    if (paths.length > 0) {
      await db.storage.from(STORAGE_BUCKET).remove(paths);
    }
  }

  const { error } = await db.from("posts").delete().eq("id", postId);

  if (error) {
    showAlert("error", "ลบไม่สำเร็จ: " + error.message);
    btn.disabled = false;
    return;
  }

  postsCache.delete(postId);
  article.remove();
  showAlert("success", "ลบโพสต์แล้ว");

  // ถ้าไม่เหลือโพสต์เลย แสดงข้อความ
  const feed = document.getElementById("feed");
  if (feed.querySelectorAll("[data-post-id]").length === 0) {
    feed.innerHTML = '<div class="status">ยังไม่มีโพสต์ มาเป็นคนแรกกัน!</div>';
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

// ============================================
// Lightbox
// ============================================
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");

lightbox.addEventListener("click", () => {
  lightbox.classList.remove("active");
});

function attachLightboxListeners() {
  document.querySelectorAll(".post-images img").forEach((img) => {
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      lightboxImg.src = img.dataset.full || img.src;
      lightbox.classList.add("active");
    });
  });
}

// ============================================
// เริ่มทำงาน
// ============================================
loadPosts();
