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
};

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
  await loadFromServer();
  loadAll();
  if (isGHConfigured()) {
    await loadFromGitHub();
  }
});
