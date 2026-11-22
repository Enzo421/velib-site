// recettes.js : onglet « Recettes » (planning de repas, midi et soir, partagé à deux).
//
// Fichier séparé de la page : on peut le modifier seul (à placer dans le dépôt, à côté de index.html).
// Les données sont dans recettes.json, dans le même dépôt GitHub. Chaque enregistrement est un commit
// fait depuis le navigateur avec un jeton GitHub, mémorisé uniquement sur le téléphone (localStorage).
// La page doit contenir <div id="recettes-root"></div> et charger ce fichier ; elle appelle
// window.recettesShow() quand l'onglet est ouvert.
(() => {
  const CFG = { owner: "Enzo421", repo: "velib-site", branch: "main", path: "recettes.json" };
  const SLOTS = [["midi", "Midi"], ["soir", "Soir"]];   // les « barres » de chaque jour
  const TOKEN_KEY = "velib_gh_token";
  const API = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.path}`;

  // ---------- utilitaires ----------
  const store = {
    get: k => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    remove: k => { try { localStorage.removeItem(k); } catch {} },
  };
  const b64enc = s => {
    let bin = "";
    for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
    return btoa(bin);
  };
  const b64dec = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), c => c.charCodeAt(0)));
  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monday = d => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    Object.assign(el, props);
    kids.forEach(k => el.append(k));
    return el;
  };

  // ---------- état ----------
  let token = store.get(TOKEN_KEY);
  let data = {};                      // { "2026-11-23": { midi: "...", soir: "..." } }
  let weekStart = monday(new Date());
  let pending = {};                   // modifications pas encore enregistrées
  let timer = null;
  let queue = Promise.resolve();
  let statusText = "", statusIsError = false;
  let started = false;
  const root = document.getElementById("recettes-root");

  // ---------- GitHub ----------
  const headers = (extra = {}) => {
    const hd = { Accept: "application/vnd.github+json", ...extra };
    if (token) hd.Authorization = `Bearer ${token}`;
    return hd;
  };

  async function fetchFile() {
    const r = await fetch(`${API}?ref=${CFG.branch}&t=${Date.now()}`, { headers: headers(), cache: "no-store" });
    if (r.status === 404) return { data: {}, sha: null };            // fichier pas encore créé
    if (r.status === 401) {
      token = ""; store.remove(TOKEN_KEY);
      throw new Error("jeton refusé, reconnectez-vous");
    }
    if (!r.ok) throw new Error(`lecture ${r.status}`);
    const j = await r.json();
    return { data: JSON.parse(b64dec(j.content) || "{}"), sha: j.sha };
  }

  // Relit le fichier, applique seulement NOS changements, puis enregistre (nouvel essai si l'autre a écrit entre-temps).
  async function saveChanges(changes) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: latest, sha } = await fetchFile();
      for (const [day, slots] of Object.entries(changes)) {
        latest[day] = { ...(latest[day] || {}), ...slots };
        if (!latest[day].midi && !latest[day].soir) delete latest[day];
      }
      const body = {
        message: `recettes : ${Object.keys(changes).join(", ")}`,
        content: b64enc(JSON.stringify(latest, null, 2)),
        branch: CFG.branch,
      };
      if (sha) body.sha = sha;
      const r = await fetch(API, { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
      if (r.ok) return latest;
      if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error(`accès refusé (${r.status}), vérifiez le jeton`);
      if (r.status !== 409 && r.status !== 422) throw new Error(`écriture ${r.status}`);
    }
    throw new Error("conflit répété, réessayez");
  }

  // ---------- enregistrement et actualisation ----------
  function setStatus(text, isError = false) {
    statusText = text; statusIsError = isError;
    const el = root.querySelector(".rc-status");
    if (el) { el.textContent = text; el.classList.toggle("err", isError); }
  }

  function flush() {
    clearTimeout(timer);
    if (!Object.keys(pending).length) return;
    const changes = pending;
    pending = {};
    setStatus("Enregistrement…");
    queue = queue.then(async () => {
      try {
        data = await saveChanges(changes);
        setStatus("Enregistré à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
      } catch (e) {
        for (const [day, slots] of Object.entries(changes)) pending[day] = { ...slots, ...(pending[day] || {}) };
        setStatus(`Erreur : ${e.message}`, true);
      }
    });
  }

  async function refresh() {
    const typing = root.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
    if (Object.keys(pending).length || typing) return;               // ne pas écraser ce qui est en cours de saisie
    try {
      data = (await fetchFile()).data;
      render();
      setStatus(token ? "À jour" : "Lecture seule");
    } catch (e) {
      render();
      setStatus(`Lecture impossible : ${e.message}`, true);
    }
  }

  // ---------- affichage ----------
  const value = (day, slot) => pending[day]?.[slot] ?? data[day]?.[slot] ?? "";

  function tokenBox() {
    const input = h("input", { type: "password", placeholder: "Jeton GitHub (github_pat_…)" });
    const btn = h("button", {
      textContent: "Se connecter",
      onclick: async () => {
        const t = input.value.trim();
        if (!t) return;
        token = t; store.set(TOKEN_KEY, t);
        await refresh();
      },
    });
    return h("div", { className: "rc-box" },
      h("p", { textContent: "Lecture seule. Pour modifier le planning, collez le jeton GitHub (il reste sur ce téléphone) :" }),
      input, btn);
  }

  function render() {
    root.innerHTML = "";
    if (!token) root.append(tokenBox());

    const end = new Date(weekStart); end.setDate(end.getDate() + 6);
    const fmt = d => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const shift = n => () => { flush(); weekStart.setDate(weekStart.getDate() + n); render(); };
    root.append(h("div", { className: "rc-nav" },
      h("button", { textContent: "◀", onclick: shift(-7) }),
      h("b", { textContent: `${fmt(weekStart)} – ${fmt(end)}` }),
      h("button", { textContent: "▶", onclick: shift(7) }),
      h("button", { textContent: "Aujourd’hui", onclick: () => { weekStart = monday(new Date()); render(); } })));

    const today = iso(new Date());
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart); d.setDate(d.getDate() + i);
      const day = iso(d);
      const row = h("div", { className: "rc-day" + (day === today ? " today" : "") },
        h("div", { className: "rc-date", textContent: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" }) }));
      for (const [slot, label] of SLOTS) {
        const input = h("input", { type: "text", placeholder: "Recette…", maxLength: 200, value: value(day, slot), disabled: !token });
        input.oninput = () => {
          (pending[day] ??= {})[slot] = input.value;
          setStatus("Modification…");
          clearTimeout(timer);
          timer = setTimeout(flush, 1500);
        };
        input.onblur = flush;
        row.append(h("label", {}, h("span", { textContent: label }), input));
      }
      root.append(row);
    }

    const foot = h("div", { className: "rc-foot" }, h("span", { className: "rc-status" }),
      h("button", { textContent: "Actualiser", onclick: refresh }));
    if (token) foot.append(h("button", { textContent: "Déconnexion", onclick: () => { token = ""; store.remove(TOKEN_KEY); render(); } }));
    root.append(foot);
    setStatus(statusText, statusIsError);
  }

  function injectStyle() {
    const css = `
      #recettes-root { max-width: 560px; margin: 0 auto; font: 14px system-ui, sans-serif; }
      .rc-nav { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .rc-nav b { flex: 1; text-align: center; }
      #recettes-root button { padding: 7px 10px; border: 1px solid #bbb; background: #f4f4f4; color: #111; border-radius: 6px; font: inherit; cursor: pointer; }
      .rc-day { border: 1px solid #ccc; border-radius: 8px; padding: 8px; margin-bottom: 8px; }
      .rc-day.today { border-color: #1565c0; box-shadow: 0 0 0 1px #1565c0; }
      .rc-date { font-weight: 600; text-transform: capitalize; margin-bottom: 6px; }
      .rc-day label { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
      .rc-day label span { width: 44px; color: #666; }
      .rc-day input { flex: 1; min-width: 0; padding: 8px; border: 1px solid #bbb; border-radius: 6px; font: inherit; }
      .rc-box { border: 1px dashed #999; border-radius: 8px; padding: 8px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
      .rc-box input { padding: 8px; border: 1px solid #bbb; border-radius: 6px; font: inherit; }
      .rc-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
      .rc-status { flex: 1; color: #555; }
      .rc-status.err { color: #c62828; font-weight: 600; }`;
    document.head.append(h("style", { textContent: css }));
  }

  // ---------- appelé par la page quand l'onglet s'ouvre ----------
  window.recettesShow = () => {
    if (!root) return;
    if (!started) {
      started = true;
      injectStyle();
      setInterval(() => { if (root.offsetParent !== null) refresh(); }, 30000);   // actualisation toutes les 30 s
    }
    render();
    refresh();
  };
})();
