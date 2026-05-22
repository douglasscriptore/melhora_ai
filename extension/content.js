// Melhora.AI — content script
// Injects a Grammarly-style floating widget near focused inputs/textareas/contenteditable.

(function () {
  // Skip iframes and contexts without extension APIs
  if (window !== window.top) return;
  if (typeof chrome === "undefined" || !chrome.runtime) return;
  if (window.__melhoraAI) return;
  window.__melhoraAI = true;

  // ── Config ──────────────────────────────────────────────────────────────────

  const MODES = [
    { id: "corrigir_portugues", label: "Corrigir" },
    { id: "melhorar_texto",     label: "Melhorar" },
    { id: "resumir",            label: "Resumir"  },
    { id: "gerar_gc",           label: "GC"       },
  ];

  const BADGE_SIZE = 28; // px

  // ── State ───────────────────────────────────────────────────────────────────

  let target    = null; // currently focused element
  let badge     = null;
  let panel     = null;
  let panelOpen = false;
  let busy      = false;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const bad = ["checkbox","radio","button","submit","reset","file","range","color","hidden","image"];
      return !bad.includes((el.type || "text").toLowerCase());
    }
    // contenteditable (Gmail, Notion, etc.)
    if (el.isContentEditable) return true;
    return false;
  }

  function getText(el) {
    if (!el) return "";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return el.value || "";
    if (el.isContentEditable) return el.innerText || el.textContent || "";
    return "";
  }

  // Set value and fire synthetic events so React/Vue/etc pick it up.
  function setText(el, value) {
    if (!el) return;

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      // React overrides the native setter — reach into the prototype to trigger onChange.
      const proto = el.tagName === "INPUT"
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) {
        setter.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    if (el.isContentEditable) {
      el.focus();
      // execCommand works even in complex editors and fires the right events.
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, value);
    }
  }

  // ── Badge ───────────────────────────────────────────────────────────────────

  function ensureBadge() {
    if (badge) return badge;
    badge = document.createElement("div");
    badge.id = "__mai_badge__";
    badge.textContent = "M";
    badge.title = "Melhora.AI";
    badge.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in field
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      panelOpen ? closePanel() : openPanel();
    });
    document.documentElement.appendChild(badge);
    return badge;
  }

  function positionBadge() {
    if (!target || !badge) return;
    const r = target.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    // Bottom-right corner of the field, slightly inset
    badge.style.left = `${r.right + scrollX - BADGE_SIZE - 4}px`;
    badge.style.top  = `${r.bottom + scrollY - BADGE_SIZE - 4}px`;
  }

  function showBadge(el) {
    target = el;
    ensureBadge();
    badge.style.display = "flex";
    badge.classList.remove("--active", "--success", "--loading");
    positionBadge();
  }

  function hideBadge() {
    if (badge) badge.style.display = "none";
    closePanel();
    target = null;
  }

  // ── Panel ───────────────────────────────────────────────────────────────────

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "__mai_panel__";
    panel.style.display = "none";
    panel.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in field
    document.documentElement.appendChild(panel);
    return panel;
  }

  function positionPanel() {
    if (!target || !panel) return;
    const r = target.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const pw = panel.offsetWidth || 320;
    const ph = panel.offsetHeight || 44;
    const margin = 6;

    // Horizontal: align right edge with field right edge, clamp to viewport
    let left = r.right + scrollX - pw;
    left = Math.max(scrollX + margin, Math.min(left, scrollX + document.documentElement.clientWidth - pw - margin));

    // Vertical: prefer above badge, fall back to below field
    let top;
    const badgeTop = r.bottom + scrollY - BADGE_SIZE - 4;
    if (badgeTop - ph - margin > scrollY) {
      top = badgeTop - ph - margin; // above badge
    } else {
      top = r.bottom + scrollY + margin; // below field
    }

    panel.style.left = `${left}px`;
    panel.style.top  = `${top}px`;
  }

  function openPanel() {
    ensurePanel();
    renderModes();
    panel.style.display = "flex";
    panelOpen = true;
    badge?.classList.add("--active");
    // Wait a frame so offsetWidth/Height are measured
    requestAnimationFrame(positionPanel);
  }

  function closePanel() {
    if (panel) panel.style.display = "none";
    panelOpen = false;
    badge?.classList.remove("--active");
  }

  // ── Panel render states ──────────────────────────────────────────────────────

  function renderModes() {
    if (!panel) return;
    const text = getText(target);
    const hasText = text.trim().length > 0;
    panel.innerHTML = MODES.map((m) => `
      <button class="--mai-btn" data-mode="${m.id}" ${hasText ? "" : "disabled"} title="${m.label}">
        ${m.label}
      </button>
    `).join("");

    panel.querySelectorAll(".--mai-btn").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleMode(btn.dataset.mode);
      });
    });
  }

  function renderLoading() {
    if (!panel) return;
    panel.innerHTML = `
      <div class="__mai_status__">
        <div class="__mai_spinner__"></div>
        <span>Processando...</span>
      </div>
    `;
  }

  function renderError(msg) {
    if (!panel) return;
    panel.innerHTML = `
      <div class="__mai_status__ __mai_error__">
        <span>⚠ ${msg}</span>
      </div>
    `;
    setTimeout(() => {
      if (panel && panel.style.display !== "none") renderModes();
    }, 3500);
  }

  function renderSuccess() {
    if (!panel) return;
    panel.innerHTML = `
      <div class="__mai_status__ __mai_success__">
        <span>✓ Texto substituído</span>
      </div>
    `;
    setTimeout(() => closePanel(), 1200);
  }

  // ── Core action ──────────────────────────────────────────────────────────────

  async function handleMode(mode) {
    if (busy || !target) return;
    const text = getText(target);
    if (!text.trim()) return;

    // Extension context invalidated (e.g. extension reloaded while tab was open).
    if (!chrome?.runtime?.sendMessage) {
      renderError("Recarregue a página para usar a extensão.");
      return;
    }

    busy = true;
    badge?.classList.add("--loading");
    renderLoading();

    try {
      const resp = await chrome.runtime.sendMessage({ type: "PROCESS_TEXT", text, mode });

      if (!resp || !resp.ok) {
        renderError(resp?.error || "Erro desconhecido");
        return;
      }

      // Re-check target is still valid before writing
      if (!document.contains(target)) {
        closePanel();
        return;
      }

      setText(target, resp.text);
      renderSuccess();
      badge?.classList.remove("--loading");
      badge?.classList.add("--success");
      setTimeout(() => badge?.classList.remove("--success"), 2000);

    } catch (err) {
      renderError(err.message || "Falha na conexão com a extensão");
    } finally {
      busy = false;
      badge?.classList.remove("--loading");
    }
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  document.addEventListener("focusin", (e) => {
    if (isEditable(e.target) && e.target.id !== "__mai_badge__") {
      showBadge(e.target);
    }
  }, true);

  document.addEventListener("focusout", (e) => {
    if (e.target === target) {
      // Delay so badge/panel click events fire first
      setTimeout(() => {
        const active = document.activeElement;
        const inWidget = active === badge || badge?.contains(active)
                      || active === panel || panel?.contains(active);
        if (!inWidget) hideBadge();
      }, 180);
    }
  }, true);

  // Reposition on scroll / resize
  window.addEventListener("scroll", () => {
    positionBadge();
    if (panelOpen) positionPanel();
  }, { passive: true, capture: true });

  window.addEventListener("resize", () => {
    positionBadge();
    if (panelOpen) positionPanel();
  }, { passive: true });

  // Close panel on outside click
  document.addEventListener("click", (e) => {
    if (!badge?.contains(e.target) && !panel?.contains(e.target)) {
      closePanel();
    }
  }, true);

  // Reposition if target element moves (e.g. virtual keyboard on mobile, SPA route changes)
  const resizeObserver = new ResizeObserver(() => {
    if (target) { positionBadge(); if (panelOpen) positionPanel(); }
  });
  document.addEventListener("focusin", (e) => {
    if (isEditable(e.target)) resizeObserver.observe(e.target);
  }, true);
  document.addEventListener("focusout", (e) => {
    if (isEditable(e.target)) resizeObserver.unobserve(e.target);
  }, true);

})();
