"use strict";
const SK = "sout_v1_";
const PAGE_ID = (location.pathname.split("/").pop() || "index").replace(
  ".html",
  "",
);
const IDB_NAME = "sout_handles_v1";
const IDB_STORE = "fh";
const GH_KEY = "gh_cfg_v1";

/* ── localStorage auto-save ──────────────────────────────────────── */
function saveT(el) {
  localStorage.setItem(SK + el.id, el.value);
  el.classList.toggle("filled", !!el.value);
  const pv = el.parentElement.querySelector(".print-val");
  if (pv) pv.textContent = el.value || "";
}

function loadAll() {
  document.querySelectorAll(".tselect").forEach((el) => {
    const v = localStorage.getItem(SK + el.id);
    if (v !== null) {
      el.value = v;
      el.classList.toggle("filled", !!v);
    }
    const pv = el.parentElement.querySelector(".print-val");
    if (pv) pv.textContent = el.value || "";
  });
}

/* ── JSON helpers ─────────────────────────────────────────────────── */
function buildJSON() {
  // S'assure que les sélections actuelles de la page sont bien dans le localStorage
  document.querySelectorAll(".tselect").forEach((el) => {
    if (el.value) {
      localStorage.setItem(SK + el.id, el.value);
    } else {
      localStorage.removeItem(SK + el.id);
    }
  });

  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(SK)) {
      data[key.replace(SK, "")] = localStorage.getItem(key);
    }
  }
  return JSON.stringify(data, null, 2);
}

function applyJSON(text) {
  try {
    const data = JSON.parse(text);
    for (const [id, val] of Object.entries(data)) {
      localStorage.setItem(SK + id, val);
      const el = document.getElementById(id);
      if (el) {
        el.value = val;
        el.classList.toggle("filled", !!val);
        const pv = el.parentElement.querySelector(".print-val");
        if (pv) pv.textContent = val || "";
      }
    }
  } catch (e) {
    console.error("Erreur de lecture JSON", e);
  }
}

/* ── IndexedDB – persist FileSystemFileHandle ────────────────────── */
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = (e) => e.target.result.createObjectStore(IDB_STORE);
    r.onsuccess = (e) => res(e.target.result);
    r.onerror = (e) => rej(e.target.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    return new Promise((res) => {
      const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
      r.onsuccess = (e) => res(e.target.result ?? null);
      r.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}
async function idbPut(key, val) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = res;
      tx.onerror = rej;
    });
  } catch {
    /* ignore */
  }
}

/* ── File System Access API helpers ──────────────────────────────── */
async function getWritableHandle() {
  let handle = await idbGet("donnees_json");
  if (handle) {
    let perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted")
      perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm === "granted") return handle;
  }
  handle = await window.showSaveFilePicker({
    id: "sout_save",
    suggestedName: "donnees.json",
    types: [
      {
        description: "Fichier JSON",
        accept: { "application/json": [".json"] },
      },
    ],
  });
  await idbPut("donnees_json", handle);
  return handle;
}

/* ── GitHub API ──────────────────────────────────────────────────── */
function getGHConfig() {
  try {
    return JSON.parse(localStorage.getItem(GH_KEY)) || null;
  } catch {
    return null;
  }
}

function isGHConfigured() {
  const c = getGHConfig();
  return !!(c && c.token && c.owner && c.repo);
}

function ghFilePath() {
  return `donnees.json`;
}

async function loadFromGitHub() {
  const cfg = getGHConfig();
  if (!cfg || !cfg.token || !cfg.owner || !cfg.repo) return false;
  const branch = cfg.branch || "main";
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${ghFilePath()}?ref=${branch}`;
  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `token ${cfg.token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!resp.ok) return false;
    const json = await resp.json();
    const text = decodeURIComponent(
      escape(atob(json.content.replace(/\n/g, ""))),
    );
    applyJSON(text);
    showToast("↺ Sélections restaurées depuis GitHub");
    return true;
  } catch {
    return false;
  }
}

async function saveToGitHub() {
  const cfg = getGHConfig();
  if (!cfg || !cfg.token || !cfg.owner || !cfg.repo) return false;
  const branch = cfg.branch || "main";
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${ghFilePath()}`;
  const jsonStr = buildJSON();
  const content = btoa(unescape(encodeURIComponent(jsonStr)));

  let sha = null;
  try {
    const getResp = await fetch(`${url}?ref=${branch}`, {
      headers: {
        Authorization: `token ${cfg.token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (getResp.ok) sha = (await getResp.json()).sha;
  } catch {
    /* fichier inexistant */
  }

  const body = {
    message: `Mise à jour ${PAGE_ID} — ${new Date().toLocaleString("fr-FR")}`,
    content,
    branch,
  };
  if (sha) body.sha = sha;

  try {
    const putResp = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `token ${cfg.token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!putResp.ok) {
      const err = await putResp.json();
      throw new Error(err.message || putResp.status);
    }
    showToast("✓ Sauvegarde sur GitHub réussie");
    return true;
  } catch (e) {
    showToast("✗ GitHub : " + e.message);
    return false;
  }
}

async function testGHConnection(cfg) {
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`,
      {
        headers: {
          Authorization: `token ${cfg.token}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

/* ── GitHub settings modal ───────────────────────────────────────── */
function injectGHUI() {
  const footer = document.createElement("div");
  footer.className = "gh-footer";
  footer.innerHTML = `<button class="gh-footer-link${isGHConfigured() ? " gh-footer-link--active" : ""}" id="gh-config-btn" title="Configuration sauvegarde GitHub"><svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>${isGHConfigured() ? "● GitHub configuré" : "Configurer sauvegarde GitHub"}</button>`;
  document.body.appendChild(footer);
  document
    .getElementById("gh-config-btn")
    .addEventListener("click", openGHModal);

  const modal = document.createElement("div");
  modal.id = "gh-modal";
  modal.className = "gh-modal-overlay";
  modal.innerHTML = `
<div class="gh-modal">
  <div class="gh-modal-hdr">
    <span>⚙ Configuration GitHub</span>
    <button class="gh-modal-close" onclick="closeGHModal()">✕</button>
  </div>
  <div class="gh-modal-body">
    <p class="gh-modal-desc">Les sélections seront sauvegardées dans votre dépôt GitHub et accessibles depuis n'importe quel poste. Un <strong>Personal Access Token</strong> avec le scope <code>repo</code> est requis.</p>
    <div class="gh-form-group">
      <label class="gh-label" for="gh-token">Token <span class="gh-hint">(GitHub → Settings → Developer settings → PAT)</span></label>
      <input id="gh-token" class="gh-input" type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" autocomplete="off">
    </div>
    <div class="gh-form-row">
      <div class="gh-form-group">
        <label class="gh-label" for="gh-owner">Propriétaire</label>
        <input id="gh-owner" class="gh-input" type="text" placeholder="votre-login">
      </div>
      <div class="gh-form-group">
        <label class="gh-label" for="gh-repo">Dépôt (repo)</label>
        <input id="gh-repo" class="gh-input" type="text" placeholder="soutenances-portfolio">
      </div>
    </div>
    <div class="gh-form-group">
      <label class="gh-label" for="gh-branch">Branche</label>
      <input id="gh-branch" class="gh-input" type="text" placeholder="main">
    </div>
    <div id="gh-status" class="gh-status" style="display:none"></div>
  </div>
  <div class="gh-modal-footer">
    <button class="gh-btn-test" onclick="testGHFromModal()">Tester la connexion</button>
    <span style="flex:1"></span>
    <button class="gh-btn-clear" onclick="clearGHConfig()">Effacer</button>
    <button class="gh-btn-save" onclick="saveGHFromModal()">Enregistrer</button>
  </div>
</div>`;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeGHModal();
  });
  document.body.appendChild(modal);

  const cfg = getGHConfig();
  if (cfg) {
    if (cfg.token) document.getElementById("gh-token").value = cfg.token;
    if (cfg.owner) document.getElementById("gh-owner").value = cfg.owner;
    if (cfg.repo) document.getElementById("gh-repo").value = cfg.repo;
    document.getElementById("gh-branch").value = cfg.branch || "main";
  } else {
    document.getElementById("gh-branch").value = "main";
  }
}

function openGHModal() {
  document.getElementById("gh-modal").classList.add("open");
}
function closeGHModal() {
  document.getElementById("gh-modal").classList.remove("open");
}

function saveGHFromModal() {
  const cfg = {
    token: document.getElementById("gh-token").value.trim(),
    owner: document.getElementById("gh-owner").value.trim(),
    repo: document.getElementById("gh-repo").value.trim(),
    branch: document.getElementById("gh-branch").value.trim() || "main",
  };
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    showGHStatus("Veuillez remplir Token, Propriétaire et Dépôt.", "error");
    return;
  }
  localStorage.setItem(GH_KEY, JSON.stringify(cfg));
  const btn = document.getElementById("gh-config-btn");
  if (btn) btn.classList.add("gh-btn--active");
  showGHStatus("Configuration enregistrée !", "success");
  setTimeout(closeGHModal, 900);
}

function clearGHConfig() {
  localStorage.removeItem(GH_KEY);
  const btn = document.getElementById("gh-config-btn");
  if (btn) btn.classList.remove("gh-btn--active");
  ["gh-token", "gh-owner", "gh-repo"].forEach((id) => {
    document.getElementById(id).value = "";
  });
  document.getElementById("gh-branch").value = "main";
  showGHStatus("Configuration effacée.", "info");
}

async function testGHFromModal() {
  const cfg = {
    token: document.getElementById("gh-token").value.trim(),
    owner: document.getElementById("gh-owner").value.trim(),
    repo: document.getElementById("gh-repo").value.trim(),
    branch: document.getElementById("gh-branch").value.trim() || "main",
  };
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    showGHStatus("Remplissez d'abord tous les champs.", "error");
    return;
  }
  showGHStatus("Connexion en cours…", "info");
  const ok = await testGHConnection(cfg);
  showGHStatus(
    ok
      ? "✓ Connexion réussie !"
      : "✗ Échec — vérifiez le token et les noms (owner/repo).",
    ok ? "success" : "error",
  );
}

function showGHStatus(msg, type) {
  const s = document.getElementById("gh-status");
  if (!s) return;
  s.textContent = msg;
  s.className = "gh-status gh-status--" + type;
  s.style.display = "block";
}

/* ── Sauvegarder (GitHub prioritaire, sinon File System API) ─────── */
async function saveSelectionsToFile() {
  if (isGHConfigured()) {
    await saveToGitHub();
    return;
  }
  const jsonStr = buildJSON();
  if (window.showSaveFilePicker) {
    try {
      const handle = await getWritableHandle();
      const w = await handle.createWritable();
      await w.write(jsonStr);
      await w.close();
      showToast("✓ Sauvegarde réussie");
    } catch (e) {
      if (e.name !== "AbortError") downloadJSON(jsonStr);
    }
  } else {
    downloadJSON(jsonStr);
  }
}

function downloadJSON(jsonStr) {
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "donnees.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showToast("✓ Fichier téléchargé");
}

/* ── Auto-load depuis fichier local ──────────────────────────────── */
async function autoLoadFromFile() {
  if (!window.FileSystemFileHandle) return;
  const handle = await idbGet("donnees_json");
  if (!handle) return;
  try {
    const perm = await handle.queryPermission({ mode: "read" });
    if (perm !== "granted") return;
    const file = await handle.getFile();
    const text = await file.text();
    applyJSON(text);
    showToast("↺ Sélections restaurées depuis le fichier");
  } catch {
    /* fichier inaccessible */
  }
}

/* ── Auto-load depuis le dossier courant (serveur local) ─────────── */
async function loadFromServer() {
  try {
    // Tente de récupérer donnees.json s'il est accessible à la racine
    const resp = await fetch("donnees.json", { cache: "no-store" });
    if (resp.ok) {
      const text = await resp.text();
      applyJSON(text);
      console.log("Sélections chargées depuis donnees.json (dossier courant)");
    }
  } catch (e) {
    /* Ignore (échouera si ouvert en file:// sans serveur) */
  }
}

/* ── Toast ───────────────────────────────────────────────────────── */
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

/* ── PDF export ──────────────────────────────────────────────────── */
function exportPDF() {
  document.querySelectorAll(".tselect").forEach((el) => {
    const pv = el.parentElement.querySelector(".print-val");
    if (pv) pv.textContent = el.value || "";
  });
  showToast("Ouverture de la boîte de dialogue impression…");
  setTimeout(() => window.print(), 300);
}

/* ── Init ────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  injectGHUI();
  await loadFromServer();
  loadAll();
  if (isGHConfigured()) {
    await loadFromGitHub();
  } else {
    await autoLoadFromFile();
  }
});
