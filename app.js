"use strict";
const SK = "sout_v1_";
const PAGE_ID = (location.pathname.split("/").pop() || "index").replace(
  ".html",
  "",
);
const GH_KEY = "gh_cfg_v1";
const GH_OWNER = "nico3807";
const GH_REPO = "soutenances_portfolio";
const GH_BRANCH = "main";
let APP_CONFIG = {
  enseignants: [],
  salles: [],
  horaires: {},
  etudiants: {},
};
let _cfgImportedNames = [];

/* ── Populators ─────────────────────────────────────────────────── */
function populateSelects() {
  document.querySelectorAll(".tselect").forEach((select) => {
    const lbl = select.previousElementSibling;
    let options = null;

    if (lbl && lbl.classList.contains("mlbl")) {
      const labelText = lbl.textContent.trim();
      if (labelText.startsWith("Enseignant")) {
        options = APP_CONFIG.enseignants;
      } else if (labelText === "Salle") {
        options = APP_CONFIG.salles;
      }
    }

    if (options && options.length > 0) {
      select.innerHTML = `<option value="">— Sélectionner —</option>`;
      options.forEach((opt) => {
        select.add(new Option(opt, opt));
      });
    }
  });
}

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

  const data = {
    _enseignants: APP_CONFIG.enseignants,
    _salles: APP_CONFIG.salles,
  };
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
    if (data._enseignants) {
      APP_CONFIG.enseignants = data._enseignants.sort((a, b) =>
        a.localeCompare(b, "fr"),
      );
    }
    if (data._salles) {
      APP_CONFIG.salles = data._salles.sort((a, b) => a.localeCompare(b, "fr"));
    }
    populateSelects();

    for (const [id, val] of Object.entries(data)) {
      if (id.startsWith("_")) continue;
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

/* ── GitHub API ──────────────────────────────────────────────────── */
function getGHConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(GH_KEY)) || {};
    return {
      token: stored.token || "",
      owner: GH_OWNER,
      repo: GH_REPO,
      branch: GH_BRANCH,
    };
  } catch {
    return { token: "", owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH };
  }
}

function isGHConfigured() {
  return !!getGHConfig().token;
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

async function saveJsonToGitHub(filename, jsonStr, message) {
  const cfg = getGHConfig();
  if (!cfg.token) throw new Error("Token non configuré");
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filename}`;
  const content = btoa(unescape(encodeURIComponent(jsonStr)));
  let sha = null;
  try {
    const r = await fetch(`${url}?ref=${GH_BRANCH}`, {
      headers: {
        Authorization: `token ${cfg.token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (r.ok) sha = (await r.json()).sha;
  } catch { /* fichier inexistant */ }
  const body = { message, content, branch: GH_BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json();
    throw new Error(err.message || r.status);
  }
}

async function saveToGitHub() {
  try {
    await saveJsonToGitHub(
      "donnees.json",
      buildJSON(),
      `Mise à jour ${PAGE_ID} — ${new Date().toLocaleString("fr-FR")}`,
    );
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
    <span>⚙ Token GitHub</span>
    <button class="gh-modal-close" onclick="closeGHModal()">✕</button>
  </div>
  <div class="gh-modal-body">
    <p class="gh-modal-desc">Les sélections sont sauvegardées dans <strong>${GH_OWNER}/${GH_REPO}</strong> (branche <code>${GH_BRANCH}</code>). Entrez votre <strong>Personal Access Token</strong> (scope <code>repo</code>) — à saisir une seule fois par poste.</p>
    <div class="gh-form-group">
      <label class="gh-label" for="gh-token">Token <span class="gh-hint">(GitHub → Settings → Developer settings → PAT)</span></label>
      <input id="gh-token" class="gh-input" type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" autocomplete="off">
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
  if (cfg.token) document.getElementById("gh-token").value = cfg.token;
}

function openGHModal() {
  document.getElementById("gh-modal").classList.add("open");
}
function closeGHModal() {
  document.getElementById("gh-modal").classList.remove("open");
}

function saveGHFromModal() {
  const token = document.getElementById("gh-token").value.trim();
  if (!token) {
    showGHStatus("Veuillez saisir le token.", "error");
    return;
  }
  localStorage.setItem(GH_KEY, JSON.stringify({ token }));
  const btn = document.getElementById("gh-config-btn");
  if (btn) btn.classList.add("gh-footer-link--active");
  showGHStatus("Token enregistré !", "success");
  setTimeout(closeGHModal, 900);
}

function clearGHConfig() {
  localStorage.removeItem(GH_KEY);
  const btn = document.getElementById("gh-config-btn");
  if (btn) btn.classList.remove("gh-footer-link--active");
  document.getElementById("gh-token").value = "";
  showGHStatus("Token effacé.", "info");
}

async function testGHFromModal() {
  const token = document.getElementById("gh-token").value.trim();
  if (!token) {
    showGHStatus("Saisissez d'abord le token.", "error");
    return;
  }
  showGHStatus("Connexion en cours…", "info");
  const ok = await testGHConnection({ token, owner: GH_OWNER, repo: GH_REPO });
  showGHStatus(
    ok ? "✓ Connexion réussie !" : "✗ Échec — vérifiez le token.",
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

/* ── Config modal ────────────────────────────────────────────────── */
const CFG_LEVELS = {
  mmi1:      "MMI 1",
  mmi2_init: "MMI 2 — Initiaux",
  mmi2_alt:  "MMI 2 — Alternants",
  mmi3_init: "MMI 3 — Initiaux",
  mmi3_alt:  "MMI 3 — Alternants",
};
const CFG_MAX_JURIES   = 8;
const CFG_MAX_CRENEAUX = 8;

function parseJuryDate(str) {
  str = (str || "").trim();
  if (/après[\s-]midi$/i.test(str)) {
    return { dateStr: str.replace(/\s*après[\s-]midi$/i, "").trim(), period: "après-midi" };
  }
  return { dateStr: str.replace(/\s*matin$/i, "").trim(), period: "matin" };
}

const FR_MONTHS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const FR_DAYS   = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];

function frenchToIso(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.trim().split(/\s+/);
  // "Lundi 22 juin 2026" → offset 1 ; "22 juin 2026" → offset 0
  const offset = parts.length >= 4 ? 1 : (parts.length === 3 ? 0 : -1);
  if (offset < 0) return "";
  const day      = parseInt(parts[offset], 10);
  const monthStr = (parts[offset + 1] || "").toLowerCase();
  const year     = parseInt(parts[offset + 2], 10);
  if (!day || !year) return "";
  const m = FR_MONTHS.findIndex(x => x.toLowerCase() === monthStr);
  if (m === -1) return "";
  return `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isoToFrench(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const date = new Date(y, m - 1, d);
  return `${FR_DAYS[date.getDay()]} ${d} ${FR_MONTHS[m - 1]} ${y}`;
}

function getJuryCount(level) {
  let n = 0;
  for (let i = 1; i <= CFG_MAX_JURIES; i++) {
    if (APP_CONFIG.horaires[`${level}_jury${i}_date`] !== undefined ||
        APP_CONFIG.horaires[`${level}_jury${i}_creneau1`] !== undefined) n = i;
  }
  return n || 1;
}

function injectCfgUI() {
  const levelOptions = Object.entries(CFG_LEVELS)
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  const modal = document.createElement("div");
  modal.id = "cfg-modal";
  modal.className = "gh-modal-overlay";
  modal.innerHTML = `
<div class="cfg-modal">
  <div class="gh-modal-hdr">
    <span>⚙ Configuration des soutenances</span>
    <button class="gh-modal-close" onclick="closeCfgModal()">✕</button>
  </div>
  <div class="cfg-modal-body">
    <div class="cfg-top-row">
      <div class="gh-form-group" style="margin:0">
        <label class="gh-label">Niveau</label>
        <select id="cfg-level" class="gh-input" onchange="cfgOnLevelChange()">${levelOptions}</select>
      </div>
      <div class="gh-form-group" style="margin:0">
        <label class="gh-label">Nombre de jurys</label>
        <input type="number" id="cfg-jury-count" class="gh-input" min="1" max="${CFG_MAX_JURIES}"
               style="width:70px" oninput="cfgUpdateJuryVisibility()">
      </div>
    </div>
    <div id="cfg-juries-container"></div>
    <div class="cfg-import-section">
      <div class="cfg-section-lbl">Importer les candidats</div>
      <div class="cfg-import-row">
        <label class="gh-label" style="white-space:nowrap;margin:0">Fichier .txt</label>
        <input type="file" id="cfg-import-file" accept=".txt"
               class="gh-input cfg-file-input" onchange="cfgImportFile(this)">
        <span class="gh-hint" style="white-space:nowrap">Un nom par ligne</span>
      </div>
      <div id="cfg-import-preview" class="cfg-import-preview"></div>
    </div>
    <div id="cfg-status" class="gh-status" style="display:none;margin-top:12px"></div>
  </div>
  <div class="gh-modal-footer">
    <span style="flex:1"></span>
    <button class="gh-btn-clear" onclick="closeCfgModal()">Annuler</button>
    <button class="gh-btn-save" onclick="saveCfgModal()">Valider</button>
  </div>
</div>`;
  modal.addEventListener("click", (e) => { if (e.target === modal) closeCfgModal(); });
  document.body.appendChild(modal);
}

function cfgResetImport() {
  _cfgImportedNames = [];
  const preview = document.getElementById("cfg-import-preview");
  if (preview) preview.innerHTML = "";
  const fileInput = document.getElementById("cfg-import-file");
  if (fileInput) fileInput.value = "";
}

function cfgGetSlotsPerJury() {
  const count = parseInt(document.getElementById("cfg-jury-count").value) || 1;
  const level = document.getElementById("cfg-level").value;
  const slots = [];
  for (let n = 1; n <= count; n++) {
    let s = 0;
    for (let m = 1; m <= CFG_MAX_CRENEAUX; m++) {
      const el = document.getElementById(`cfg-j${n}-c${m}`);
      if (el && el.value.trim()) s = m;
    }
    if (s === 0) {
      for (let m = 1; m <= CFG_MAX_CRENEAUX; m++) {
        if (APP_CONFIG.horaires[`${level}_jury${n}_creneau${m}`]) s = m;
      }
    }
    slots.push(s || 0);
  }
  return slots;
}

function cfgImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const names = e.target.result
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    _cfgImportedNames = names;
    cfgShowImportPreview(names);
  };
  reader.readAsText(file, "UTF-8");
}

function cfgShowImportPreview(names) {
  const preview = document.getElementById("cfg-import-preview");
  if (!preview) return;
  if (!names.length) { preview.innerHTML = ""; return; }
  const count = parseInt(document.getElementById("cfg-jury-count").value) || 1;
  const slots = cfgGetSlotsPerJury();
  let idx = 0;
  let html = `<div class="cfg-import-preview-list">`;
  for (let n = 1; n <= count; n++) {
    const s = slots[n - 1] || 0;
    html += `<div class="cfg-import-jury"><strong>Jury ${n}</strong><ol>`;
    for (let m = 1; m <= s; m++) {
      html += `<li>${idx < names.length ? names[idx++] : "<em>—</em>"}</li>`;
    }
    html += `</ol></div>`;
  }
  html += `</div>`;
  if (idx < names.length) {
    html += `<p class="cfg-import-warn">⚠ ${names.length - idx} nom(s) ignoré(s) — plus de noms que de créneaux</p>`;
  }
  preview.innerHTML = html;
}

function openCfgModal() {
  const pwd = prompt("Veuillez saisir le mot de passe pour accéder à la configuration :");
  if (pwd === null) return;
  const secret = [126, 110, 90, 94, 130, 34, 94, 96, 104, 105, 110, 42, 41, 44, 41];
  const isAuth =
    pwd.length === secret.length &&
    pwd.split("").every((c, i) => (c.charCodeAt(0) ^ 45) + i === secret[i]);
  if (!isAuth) {
    alert("Mot de passe incorrect. Accès refusé.");
    return;
  }
  cfgResetImport();
  const levelEl = document.getElementById("cfg-level");
  if (levelEl && PAGE_ID in CFG_LEVELS) levelEl.value = PAGE_ID;
  cfgOnLevelChange();
  document.getElementById("cfg-modal").classList.add("open");
}

function closeCfgModal() {
  document.getElementById("cfg-modal").classList.remove("open");
}

function cfgOnLevelChange() {
  const level = document.getElementById("cfg-level").value;
  const count = getJuryCount(level);
  document.getElementById("cfg-jury-count").value = count;
  buildCfgJuries(level, count);
  cfgResetImport();
}

function buildCfgJuries(level, count) {
  let html = "";
  for (let n = 1; n <= CFG_MAX_JURIES; n++) {
    const { dateStr, period } = parseJuryDate(APP_CONFIG.horaires[`${level}_jury${n}_date`] || "");
    const isoDate = frenchToIso(dateStr);
    let creneauxHtml = "";
    for (let m = 1; m <= CFG_MAX_CRENEAUX; m++) {
      const val = APP_CONFIG.horaires[`${level}_jury${n}_creneau${m}`] || "";
      creneauxHtml += `
        <div class="cfg-creneau-row">
          <span class="cfg-creneau-lbl">${m}</span>
          <input type="text" id="cfg-j${n}-c${m}" class="gh-input cfg-creneau-input"
                 value="${val}" placeholder="—">
        </div>`;
    }
    html += `
      <div class="cfg-jury-section" id="cfg-jury-${n}"${n > count ? ' style="display:none"' : ""}>
        <div class="cfg-jury-hdr">
          <span class="cfg-jury-num">Jury ${n}</span>
        </div>
        <div class="cfg-jury-date-row">
          <label class="gh-label" style="white-space:nowrap">Date</label>
          <input type="date" id="cfg-j${n}-date" class="gh-input cfg-date-input"
                 value="${isoDate}">
          <select id="cfg-j${n}-period" class="gh-input cfg-period-select">
            <option value="matin"${period === "matin" ? " selected" : ""}>matin</option>
            <option value="après-midi"${period === "après-midi" ? " selected" : ""}>après-midi</option>
          </select>
        </div>
        <div class="cfg-creneaux">${creneauxHtml}</div>
      </div>`;
  }
  document.getElementById("cfg-juries-container").innerHTML = html;
}

function cfgUpdateJuryVisibility() {
  const count = parseInt(document.getElementById("cfg-jury-count").value) || 1;
  for (let n = 1; n <= CFG_MAX_JURIES; n++) {
    const el = document.getElementById(`cfg-jury-${n}`);
    if (el) el.style.display = n <= count ? "" : "none";
  }
  if (_cfgImportedNames.length > 0) cfgShowImportPreview(_cfgImportedNames);
}

function showCfgStatus(msg, type) {
  const s = document.getElementById("cfg-status");
  if (!s) return;
  s.textContent = msg;
  s.className = `gh-status gh-status--${type}`;
  s.style.display = "block";
}

async function saveCfgModal() {
  if (!isGHConfigured()) {
    showCfgStatus("Configurez d'abord GitHub via le lien en bas de page.", "error");
    return;
  }
  const level = document.getElementById("cfg-level").value;
  const juryCount = parseInt(document.getElementById("cfg-jury-count").value) || 1;
  const newEntries = {};
  const uniqueDates = [];

  for (let n = 1; n <= juryCount; n++) {
    const isoDate  = (document.getElementById(`cfg-j${n}-date`)?.value  || "").trim();
    const period   =  document.getElementById(`cfg-j${n}-period`)?.value || "matin";
    const dateStr  = isoToFrench(isoDate);
    const fullDate = `${dateStr} ${period}`;
    newEntries[`${level}_jury${n}_date`] = fullDate;
    if (!uniqueDates.includes(fullDate)) uniqueDates.push(fullDate);
    for (let m = 1; m <= CFG_MAX_CRENEAUX; m++) {
      const val = (document.getElementById(`cfg-j${n}-c${m}`)?.value || "").trim();
      if (val) newEntries[`${level}_jury${n}_creneau${m}`] = val;
    }
  }
  uniqueDates.forEach((d, i) => { newEntries[`${level}_date${i + 1}`] = d; });

  const merged = {};
  for (const [k, v] of Object.entries(APP_CONFIG.horaires)) {
    if (!k.startsWith(`${level}_`)) merged[k] = v;
  }
  Object.assign(merged, newEntries);

  showCfgStatus("Sauvegarde en cours…", "info");
  try {
    const ts = new Date().toLocaleString("fr-FR");
    await saveJsonToGitHub("horaires.json", JSON.stringify(merged, null, 2),
      `Config horaires ${level} — ${ts}`);
    await saveJsonToGitHub("donnees.json", buildJSON(),
      `Sync donnees ${level} — ${ts}`);
    APP_CONFIG.horaires = merged;
    applyHoraires(merged);

    if (_cfgImportedNames.length > 0) {
      const slots = cfgGetSlotsPerJury();
      let idx = 0;
      const etudiantsEntries = {};
      for (let n = 1; n <= juryCount; n++) {
        for (let m = 1; m <= (slots[n - 1] || 0); m++) {
          if (idx < _cfgImportedNames.length) {
            etudiantsEntries[`${level}_jury${n}_sname${m}`] = _cfgImportedNames[idx++];
          }
        }
      }
      const mergedEtudiants = {};
      for (const [k, v] of Object.entries(APP_CONFIG.etudiants)) {
        if (!k.startsWith(`${level}_`)) mergedEtudiants[k] = v;
      }
      Object.assign(mergedEtudiants, etudiantsEntries);
      await saveJsonToGitHub("etudiants.json", JSON.stringify(mergedEtudiants, null, 2),
        `Candidats ${level} — ${ts}`);
      APP_CONFIG.etudiants = mergedEtudiants;
      applyEtudiants(mergedEtudiants);
    }

    showCfgStatus("✓ Configuration sauvegardée !", "success");
    setTimeout(closeCfgModal, 1400);
  } catch (e) {
    showCfgStatus("✗ " + e.message, "error");
  }
}

/* ── Sauvegarder ─────────────────────────────────────────────────── */
async function saveSelectionsToFile() {
  const pwd = prompt(
    "Veuillez saisir le mot de passe pour autoriser la sauvegarde :",
  );
  if (pwd === null) return;

  const secret = [
    126, 110, 90, 94, 130, 34, 94, 96, 104, 105, 110, 42, 41, 44, 41,
  ];
  const isAuth =
    pwd.length === secret.length &&
    pwd.split("").every((c, i) => (c.charCodeAt(0) ^ 45) + i === secret[i]);
  if (!isAuth) {
    alert("Mot de passe incorrect. Sauvegarde annulée.");
    return;
  }

  if (!isGHConfigured()) {
    showToast("⚙ Configurez GitHub via le lien en bas de page");
    openGHModal();
    return;
  }

  await saveToGitHub();
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

function applyHoraires(data) {
  for (const [id, val] of Object.entries(data)) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
}

function applyEtudiants(data) {
  for (const [id, val] of Object.entries(data)) {
    const m = id.match(/^(.+_jury\d+)_sname(\d+)$/);
    if (!m) continue;
    const creneauEl = document.getElementById(`${m[1]}_creneau${m[2]}`);
    if (creneauEl) {
      const snameEl = creneauEl.closest("tr")?.querySelector(".sname");
      if (snameEl) snameEl.textContent = val;
    }
  }
}

async function loadHoraires() {
  try {
    const resp = await fetch("horaires.json", { cache: "no-store" });
    if (resp.ok) {
      const data = await resp.json();
      APP_CONFIG.horaires = data;
      applyHoraires(data);
    }
  } catch (e) {
    console.warn("horaires.json non trouvé ou erreur de chargement.", e);
  }
}

async function loadEtudiants() {
  try {
    const resp = await fetch("etudiants.json", { cache: "no-store" });
    if (resp.ok) {
      const data = await resp.json();
      APP_CONFIG.etudiants = data;
      applyEtudiants(data);
    }
  } catch (e) {
    console.warn("etudiants.json non trouvé.", e);
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
  // Applique la même structure d'accessibilité (aria-label) à toutes les pages
  document.querySelectorAll(".tselect").forEach((select) => {
    const lbl = select.previousElementSibling;
    if (lbl && lbl.classList.contains("mlbl")) {
      select.setAttribute("aria-label", lbl.textContent.trim());
    }
  });

  injectGHUI();
  injectCfgUI();
  await loadFromServer();
  await loadHoraires();
  await loadEtudiants();
  loadAll();
  if (isGHConfigured()) {
    await loadFromGitHub();
  }
});
