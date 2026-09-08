/* ===========================================================
   Controle de Trabalho — lógica principal
  Salva localmente e, quando configurado, sincroniza com o Supabase.

   Ao entregar uma nova versão deste app, só mude APP_VERSION
   abaixo — o número aparece sozinho no rodapé da aba Ajustes,
   assim dá pra saber qual versão está aberta sem precisar abrir
   o código.
   =========================================================== */
(function () {
  "use strict";

  const APP_VERSION = "v18";
  const STORAGE_KEY = "controleTrabalho_v2";
  const remoteConfig = window.SUPABASE_CONFIG || {};
  const remoteEnabled = Boolean(remoteConfig.url && remoteConfig.anonKey &&
    !remoteConfig.url.includes("SEU_PROJETO") && !remoteConfig.anonKey.includes("SUA_CHAVE"));
  let remoteReady = false;
  let remoteRequestInFlight = false;
  let remoteSyncPending = false;
  let localChangesPending = false;
  let remoteIgnoreUntil = 0;

  const SERIES_COLORS = [
    "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
    "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"
  ];
  const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const MESES_ABREV = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

  // ---------------------------------------------------------
  // Estado
  // ---------------------------------------------------------
  let state = loadState();
  let viewYear, viewMonth;
  let statsRange = "year";
  let selectedType = "normal";
  let selectedTurno = "diurno";
  let valorWasAuto = true;

  const today = new Date();
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
      // tenta migrar da versão antiga (v1), se existir
      const old = localStorage.getItem("controleTrabalho_v1");
      if (old) return normalizeState(JSON.parse(old), true);
    } catch (e) { console.warn("Falha ao ler dados salvos:", e); }
    return normalizeState({
      clientes: ["ALEX", "FIRMINO", "NATAL", "GIGIO", "PORFIRIO", "SCARPARO"],
      vipClientes: [{ nome: "ADRIANO", valorPadrao: 550 }],
      turnoValores: { diurno: 330, noturno: 380 },
      registros: [],
      cicloAtivo: false,
      cicloDia: 27
    });
  }

  function normalizeState(s, migratingFromV1) {
    const registros = (s.registros || []).map(r => ({
      id: r.id || uid(),
      date: r.date,
      tipo: r.tipo === "vip" ? "vip" : "normal",
      cliente: r.cliente || null,
      turno: r.turno || null,
      valor: Number(r.valor) || 0,
      // dados antigos (antes do controle de pagamento) são tratados como já recebidos
      pago: typeof r.pago === "boolean" ? r.pago : !!migratingFromV1,
      obs: r.obs || ""
    }));
    return {
      clientes: Array.isArray(s.clientes) ? s.clientes : ["ALEX", "FIRMINO", "NATAL", "GIGIO", "PORFIRIO", "SCARPARO"],
      vipClientes: (Array.isArray(s.vipClientes) ? s.vipClientes : []).map(v => (typeof v === "string" ? { nome: v, valorPadrao: 0 } : { nome: v.nome, valorPadrao: Number(v.valorPadrao) || 0 })),
      turnoValores: { diurno: (s.turnoValores && s.turnoValores.diurno) || 330, noturno: (s.turnoValores && s.turnoValores.noturno) || 380 },
      registros,
      cicloAtivo: !!s.cicloAtivo,
      cicloDia: s.cicloDia || 27
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localChangesPending = true;
    if (remoteEnabled && remoteReady) syncStateToRemote();
  }

  function remoteHeaders() {
    return {
      apikey: remoteConfig.anonKey,
      Authorization: `Bearer ${remoteConfig.anonKey}`,
      "Content-Type": "application/json"
    };
  }

  async function syncStateToRemote() {
    if (remoteRequestInFlight) {
      remoteSyncPending = true;
      return;
    }
    remoteRequestInFlight = true;
    remoteSyncPending = false;
    const stateSnapshot = JSON.stringify(state);
    try {
      const response = await fetch(`${remoteConfig.url}/rest/v1/controle_trabalho_estado`, {
        method: "POST",
        headers: { ...remoteHeaders(), Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ id: 1, dados: JSON.parse(stateSnapshot) })
      });
      if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
      if (JSON.stringify(state) === stateSnapshot) {
        localChangesPending = false;
        // Evita que uma leitura imediatamente após o upsert traga a versão anterior.
        remoteIgnoreUntil = Date.now() + 5000;
      }
    } catch (error) {
      console.warn("Falha ao sincronizar dados:", error);
    } finally {
      remoteRequestInFlight = false;
      if (remoteSyncPending || JSON.stringify(state) !== stateSnapshot) syncStateToRemote();
    }
  }

  async function loadRemoteState() {
    if (!remoteEnabled) return;
    try {
      const response = await fetch(
        `${remoteConfig.url}/rest/v1/controle_trabalho_estado?id=eq.1&select=dados`,
        { headers: remoteHeaders() }
      );
      if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
      const rows = await response.json();
      if (localChangesPending) {
        remoteReady = true;
        await syncStateToRemote();
      } else if (rows.length && rows[0].dados) {
        state = normalizeState(rows[0].dados);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderClientList();
        renderVipClientList();
        initTurnoInputs();
        initCycleInputs();
        refreshAll();
      } else {
        await syncStateToRemote();
      }
      remoteReady = true;
      toast("Dados sincronizados");
    } catch (error) {
      console.warn("Supabase indisponível; usando dados locais:", error);
      toast("Modo local: não foi possível sincronizar");
    }
  }

  async function refreshRemoteState() {
    if (!remoteEnabled || !remoteReady || remoteRequestInFlight || localChangesPending || Date.now() < remoteIgnoreUntil) return;
    try {
      const response = await fetch(
        `${remoteConfig.url}/rest/v1/controle_trabalho_estado?id=eq.1&select=dados`,
        { headers: remoteHeaders() }
      );
      if (!response.ok) return;
      const rows = await response.json();
      if (!rows.length || !rows[0].dados) return;
      state = normalizeState(rows[0].dados);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderClientList();
      renderVipClientList();
      initTurnoInputs();
      initCycleInputs();
      refreshAll();
    } catch (error) {
      console.warn("Falha ao atualizar dados remotos:", error);
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function brl(n) {
    return (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("is-visible"), 2200);
  }

  function pad(n) { return String(n).padStart(2, "0"); }
  function dateKey(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  // ---------------------------------------------------------
  // Cor por pessoa — usada no calendário e na legenda de abas,
  // sempre a mesma cor pra mesma pessoa em qualquer lugar do app.
  // ---------------------------------------------------------
  function getPeopleOrder() {
    const combined = [];
    state.clientes.forEach(c => { if (!combined.includes(c)) combined.push(c); });
    state.vipClientes.forEach(v => { if (!combined.includes(v.nome)) combined.push(v.nome); });
    return combined;
  }
  function simpleNameHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function personColor(nome) {
    const name = nome || "—";
    const order = getPeopleOrder();
    let idx = order.indexOf(name);
    if (idx === -1) idx = simpleNameHash(name);
    return SERIES_COLORS[idx % SERIES_COLORS.length];
  }

  // ---------------------------------------------------------
  // Ciclo de pagamento (mês calendário OU período personalizado)
  // ---------------------------------------------------------
  function getPeriodForView(y, m) {
    if (!state.cicloAtivo) {
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0);
      return { start, end };
    }
    const day = Math.min(Math.max(parseInt(state.cicloDia, 10) || 27, 1), 28);
    const start = new Date(y, m - 1, day);
    const end = new Date(y, m, day - 1);
    return { start, end };
  }

  function entriesInRange(start, end) {
    const s = start.getTime(), e = end.getTime();
    return state.registros.filter(r => {
      const t = new Date(r.date + "T00:00:00").getTime();
      return t >= s && t <= e;
    });
  }

  function entriesInYear(year) {
    return entriesInRange(new Date(year, 0, 1), new Date(year, 11, 31));
  }

  // ---------------------------------------------------------
  // Cálculos / totais
  // ---------------------------------------------------------
  function computeTotals(entries) {
    let totalNormal = 0, totalVip = 0, totalRecebido = 0, totalAReceber = 0;
    const porCliente = {};
    const porVip = {};
    const diasSet = new Set();
    const diasNormalSet = new Set();
    const diasVipSet = new Set();

    entries.forEach(r => {
      const v = Number(r.valor) || 0;
      diasSet.add(r.date);
      const bucket = r.pago ? "recebido" : "aReceber";
      if (r.pago) totalRecebido += v; else totalAReceber += v;

      if (r.tipo === "vip") {
        totalVip += v;
        diasVipSet.add(r.date);
        const key = r.cliente || "VIP";
        porVip[key] = porVip[key] || { gerado: 0, recebido: 0, aReceber: 0 };
        porVip[key].gerado += v;
        porVip[key][bucket] += v;
      } else {
        totalNormal += v;
        diasNormalSet.add(r.date);
        const key = r.cliente || "—";
        porCliente[key] = porCliente[key] || { gerado: 0, recebido: 0, aReceber: 0 };
        porCliente[key].gerado += v;
        porCliente[key][bucket] += v;
      }
    });

    return {
      total: totalNormal + totalVip,
      totalNormal, totalVip, totalRecebido, totalAReceber,
      porCliente, porVip,
      diasTrabalhados: diasSet.size,
      diasNormal: diasNormalSet.size,
      diasVip: diasVipSet.size,
      mediaPorDia: diasSet.size ? (totalNormal + totalVip) / diasSet.size : 0
    };
  }

  // ---------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------
  document.querySelectorAll(".tabs__btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs__btn").forEach(b => { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
      document.querySelectorAll(".tabpanel").forEach(p => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("is-active");
      if (btn.dataset.tab === "estatisticas") renderStats();
    });
  });

  // ---------------------------------------------------------
  // Tema
  // ---------------------------------------------------------
  function initTheme() {
    const saved = localStorage.getItem("ctw_theme");
    if (saved) applyTheme(saved);
    updateThemeIcon();
  }
  function applyTheme(mode) {
    if (mode === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("ctw_theme", mode);
    updateThemeIcon();
  }
  function updateThemeIcon() {
    const attr = document.documentElement.getAttribute("data-theme");
    const isDark = attr === "dark" || (!attr && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.getElementById("themeIconSun").hidden = isDark;
    document.getElementById("themeIconMoon").hidden = !isDark;
  }
  document.getElementById("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "auto";
    const isDarkNow = current === "dark" || (current === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    applyTheme(isDarkNow ? "light" : "dark");
  });
  initTheme();

  // ---------------------------------------------------------
  // Calendário
  // ---------------------------------------------------------
  function renderMonthLabel() {
    document.getElementById("monthLabel").textContent = `${MESES[viewMonth]} ${viewYear}`;
    document.getElementById("cicloLabel").textContent = state.cicloAtivo
      ? `Ciclo de pagamento ativo (fecha dia ${state.cicloDia})`
      : "Mês corrente";
  }

  function renderCalendar() {
    renderMonthLabel();
    const grid = document.getElementById("calendarGrid");
    grid.innerHTML = "";
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement("div");
      empty.className = "day day--empty";
      grid.appendChild(empty);
    }

    for (let d = 1; d <= totalDays; d++) {
      const key = dateKey(viewYear, viewMonth, d);
      const dayEntries = state.registros.filter(r => r.date === key);
      const peopleToday = [];
      dayEntries.forEach(r => {
        const nome = r.cliente || (r.tipo === "vip" ? "VIP" : "—");
        if (!peopleToday.includes(nome)) peopleToday.push(nome);
      });

      const cell = document.createElement("div");
      cell.className = "day";
      if (key === todayKey) cell.classList.add("day--today");
      if (new Date(key) > today) cell.classList.add("day--future");
      if (peopleToday.length) cell.classList.add("day--has-entries");

      const num = document.createElement("span");
      num.textContent = d;
      cell.appendChild(num);

      const dots = document.createElement("div");
      dots.className = "day__dots";
      dots.innerHTML = peopleToday.slice(0, 3)
        .map(nome => `<span class="dot" style="background:${personColor(nome)}"></span>`)
        .join("");
      cell.appendChild(dots);

      cell.addEventListener("click", () => openDayModal(key));
      grid.appendChild(cell);
    }
  }

  function renderPeopleLegend() {
    const entries = entriesInYear(viewYear);
    const totals = {};
    entries.forEach(r => {
      const nome = r.cliente || (r.tipo === "vip" ? "VIP" : "—");
      totals[nome] = (totals[nome] || 0) + (Number(r.valor) || 0);
    });
    const nomes = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    const box = document.getElementById("peopleLegend");
    if (!nomes.length) { box.innerHTML = ""; return; }
    box.innerHTML = nomes.map(nome => `
      <div class="people-chip" style="--chip-color:${personColor(nome)}">
        <span class="people-chip__name">${escapeHTML(nome)}</span>
        <span class="people-chip__value">R$ ${brl(totals[nome])}</span>
      </div>`).join("");
  }

  function renderQuickStats() {
    const entries = entriesInYear(viewYear);
    const t = computeTotals(entries);
    const el = document.getElementById("quickStats");
    const hasVip = t.diasVip > 0;
    el.classList.toggle("has-vip", hasVip);
    el.innerHTML = `
      <div class="stattile stattile--accent">
        <div class="stattile__label">Total geral</div>
        <div class="stattile__value money">${brl(t.total)}</div>
      </div>
      <div class="stattile">
        <div class="stattile__label">Dias trabalhados</div>
        <div class="stattile__value">${t.diasNormal}</div>
      </div>
      ${hasVip ? `
      <div class="stattile stattile--vip">
        <div class="stattile__label">Dias VIP</div>
        <div class="stattile__value">${t.diasVip}</div>
      </div>` : ""}`;
  }

  function renderMonthEntriesList() {
    const entries = entriesInYear(viewYear).slice().sort((a, b) => b.date.localeCompare(a.date));
    const list = document.getElementById("monthEntriesList");
    if (!entries.length) {
      list.innerHTML = `<div class="empty-hint">Nenhum lançamento neste período ainda. Toque em um dia no calendário ou no botão + para adicionar.</div>`;
      return;
    }
    list.innerHTML = entries.map(simpleEntryRowHTML).join("");
    list.querySelectorAll("[data-open-day]").forEach(row => {
      row.addEventListener("click", () => openDayModal(row.dataset.openDay));
    });
  }

  // Linha somente-leitura: nome, data, dia/noite (ou VIP) e valor.
  // Tocar na linha abre o dia no calendário para editar/excluir, se precisar.
  function simpleEntryRowHTML(r) {
    const [y, m, d] = r.date.split("-");
    const dataFmt = `${d}/${m}`;
    const isVip = r.tipo === "vip";
    const nome = isVip ? (r.cliente || "VIP") : (r.cliente || "—");
    const turnoTxt = isVip ? "VIP" : (r.turno === "noturno" ? "🌙 Noite" : "☀️ Dia");
    return `
      <div class="simple-row" data-open-day="${r.date}" style="--row-color:${personColor(nome)}">
        <div class="simple-row__main">
          <div class="simple-row__name">${escapeHTML(nome)}</div>
          <div class="simple-row__sub">${dataFmt} · ${turnoTxt}</div>
        </div>
        <div class="simple-row__value">R$ ${brl(r.valor)}</div>
      </div>`;
  }

  // Linha completa (com editar/excluir) — usada só dentro do modal do dia.
  function entryRowHTML(r) {
    const [y, m, d] = r.date.split("-");
    const dataFmt = `${d}/${m}`;
    const isVip = r.tipo === "vip";
    const nome = isVip ? (r.cliente || "VIP") : (r.cliente || "—");
    const turnoTag = !isVip && r.turno ? (r.turno === "diurno" ? " · ☀️ Diurno" : " · 🌙 Noturno") : "";
    return `
      <div class="entry-row">
        <div class="entry-row__badge ${isVip ? "t-vip" : "t-normal"}">${isVip ? "VIP" : d}</div>
        <div class="entry-row__main">
          <div class="entry-row__title">${escapeHTML(nome)}${isVip ? '<span class="tag-vip">VIP</span>' : ""}</div>
          <div class="entry-row__sub">${dataFmt}${turnoTag}${r.obs ? " · " + escapeHTML(r.obs) : ""}</div>
        </div>
        <div class="entry-row__end">
          <div class="entry-row__value">R$ ${brl(r.valor)}</div>
        </div>
        <div class="entry-row__actions">
          <button class="entry-row__icon" data-edit="${r.id}" aria-label="Editar">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="entry-row__icon" data-del="${r.id}" aria-label="Excluir">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </div>`;
  }

  function bindEntryRowActions(container) {
    container.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); deleteEntry(btn.dataset.del); });
    });
    container.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); openEditEntry(btn.dataset.edit); });
    });
  }

  function deleteEntry(id) {
    if (!confirm("Excluir este lançamento?")) return;
    state.registros = state.registros.filter(r => r.id !== id);
    saveState();
    refreshAll();
    toast("Lançamento excluído");
  }

  document.getElementById("prevMonth").addEventListener("click", () => changeMonth(-1));
  document.getElementById("nextMonth").addEventListener("click", () => changeMonth(1));
  function changeMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
    renderQuickStats();
    renderPeopleLegend();
    renderMonthEntriesList();
  }

  document.getElementById("viewTableBtn").addEventListener("click", () => {
    document.querySelector('.tabs__btn[data-tab="estatisticas"]').click();
  });

  // ---------------------------------------------------------
  // Modal de lançamento
  // ---------------------------------------------------------
  const modal = document.getElementById("dayModal");
  const entryForm = document.getElementById("entryForm");

  function populateClienteSelect() {
    const sel = document.getElementById("entryCliente");
    sel.innerHTML = state.clientes.length
      ? state.clientes.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("")
      : `<option value="">Adicione clientes em Ajustes</option>`;
  }
  function populateVipClienteSelect() {
    const sel = document.getElementById("entryVipCliente");
    sel.innerHTML = state.vipClientes.length
      ? state.vipClientes.map(c => `<option value="${escapeHTML(c.nome)}" data-valor="${c.valorPadrao}">${escapeHTML(c.nome)}</option>`).join("")
      : `<option value="">Adicione clientes VIP em Ajustes</option>`;
  }

  function openDayModal(key) {
    resetEntryForm();
    document.getElementById("entryDate").value = key;
    const [y, m, d] = key.split("-");
    document.getElementById("dayModalTitle").textContent = `${d} de ${MESES[parseInt(m, 10) - 1]}`;
    renderExistingEntriesForDay(key);
    modal.classList.add("is-open");
  }

  function resetEntryForm() {
    document.getElementById("entryEditId").value = "";
    document.getElementById("entrySubmitBtn").textContent = "Salvar lançamento";
    selectedType = "normal";
    setTypeSegment("normal");
    selectedTurno = "diurno";
    setTurnoSegment("diurno");
    populateClienteSelect();
    populateVipClienteSelect();
    document.getElementById("entryValor").value = state.turnoValores.diurno || "";
    valorWasAuto = true;
    document.getElementById("entryPago").checked = false;
    document.getElementById("entryObs").value = "";
  }

  function openEditEntry(id) {
    const r = state.registros.find(x => x.id === id);
    if (!r) return;
    resetEntryForm();
    document.getElementById("entryDate").value = r.date;
    document.getElementById("entryEditId").value = r.id;
    document.getElementById("entrySubmitBtn").textContent = "Salvar alterações";
    const [y, m, d] = r.date.split("-");
    document.getElementById("dayModalTitle").textContent = `Editar · ${d} de ${MESES[parseInt(m, 10) - 1]}`;

    selectedType = r.tipo;
    setTypeSegment(r.tipo);
    if (r.tipo === "normal") {
      document.getElementById("entryCliente").value = r.cliente || "";
      selectedTurno = r.turno || "diurno";
      setTurnoSegment(selectedTurno);
    } else {
      document.getElementById("entryVipCliente").value = r.cliente || "";
    }
    document.getElementById("entryValor").value = r.valor;
    valorWasAuto = false;
    document.getElementById("entryPago").checked = !!r.pago;
    document.getElementById("entryObs").value = r.obs || "";

    renderExistingEntriesForDay(r.date);
    modal.classList.add("is-open");
  }

  function renderExistingEntriesForDay(key) {
    const entries = state.registros.filter(r => r.date === key);
    const box = document.getElementById("dayEntriesExisting");
    box.innerHTML = entries.map(entryRowHTML).join("");
    bindEntryRowActions(box);
    box.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => renderExistingEntriesForDay(key));
    });
  }

  document.getElementById("closeModal").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  function closeModal() { modal.classList.remove("is-open"); }

  document.getElementById("entryTypeSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-type]");
    if (!btn) return;
    selectedType = btn.dataset.type;
    setTypeSegment(selectedType);
    if (valorWasAuto) {
      if (selectedType === "normal") {
        document.getElementById("entryValor").value = state.turnoValores[selectedTurno] || "";
      } else {
        const opt = document.getElementById("entryVipCliente").selectedOptions[0];
        document.getElementById("entryValor").value = opt ? (opt.dataset.valor || "") : "";
      }
    }
  });
  function setTypeSegment(type) {
    document.querySelectorAll("#entryTypeSeg .segmented__btn").forEach(b => b.classList.toggle("is-active", b.dataset.type === type));
    document.getElementById("clienteField").hidden = type === "vip";
    document.getElementById("turnoField").hidden = type === "vip";
    document.getElementById("vipClienteField").hidden = type === "normal";
  }

  document.getElementById("entryTurnoSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-turno]");
    if (!btn) return;
    selectedTurno = btn.dataset.turno;
    setTurnoSegment(selectedTurno);
    if (valorWasAuto) document.getElementById("entryValor").value = state.turnoValores[selectedTurno] || "";
  });
  function setTurnoSegment(turno) {
    document.querySelectorAll("#entryTurnoSeg .segmented__btn").forEach(b => b.classList.toggle("is-active", b.dataset.turno === turno));
  }

  document.getElementById("entryVipCliente").addEventListener("change", (e) => {
    if (!valorWasAuto) return;
    const opt = e.target.selectedOptions[0];
    document.getElementById("entryValor").value = opt ? (opt.dataset.valor || "") : "";
  });

  document.getElementById("entryValor").addEventListener("input", () => { valorWasAuto = false; });

  entryForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const date = document.getElementById("entryDate").value;
    const valor = parseFloat(document.getElementById("entryValor").value);
    if (!date || isNaN(valor) || valor < 0) { toast("Preencha um valor válido"); return; }

    let cliente = null, turno = null;
    if (selectedType === "normal") {
      cliente = document.getElementById("entryCliente").value;
      if (!cliente) { toast("Escolha para quem você trabalhou"); return; }
      turno = selectedTurno;
    } else {
      cliente = document.getElementById("entryVipCliente").value;
      if (!cliente) { toast("Escolha o cliente VIP"); return; }
    }
    const pago = document.getElementById("entryPago").checked;
    const obs = document.getElementById("entryObs").value.trim();
    const editId = document.getElementById("entryEditId").value;

    if (editId) {
      const idx = state.registros.findIndex(r => r.id === editId);
      if (idx >= 0) state.registros[idx] = { ...state.registros[idx], date, tipo: selectedType, cliente, turno, valor, pago, obs };
      toast("Lançamento atualizado ✓");
    } else {
      state.registros.push({ id: uid(), date, tipo: selectedType, cliente, turno, valor, pago, obs });
      toast("Lançamento salvo ✓");
    }
    saveState();
    renderExistingEntriesForDay(date);
    resetEntryForm();
    document.getElementById("entryDate").value = date;
    refreshAll();
    closeModal();
  });

  document.getElementById("fabAdd").addEventListener("click", () => {
    const key = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
    if (viewYear !== today.getFullYear() || viewMonth !== today.getMonth()) {
      viewYear = today.getFullYear(); viewMonth = today.getMonth();
      renderCalendar(); renderQuickStats(); renderMonthEntriesList();
    }
    openDayModal(key);
  });

  // ---------------------------------------------------------
  // Estatísticas
  // ---------------------------------------------------------
  document.getElementById("statsRange").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-range]");
    if (!btn) return;
    statsRange = btn.dataset.range;
    document.querySelectorAll("#statsRange .segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    renderStats();
  });

  function getStatsEntries() {
    if (statsRange === "all") return state.registros.slice();
    if (statsRange === "year") {
      const start = new Date(viewYear, 0, 1);
      const end = new Date(viewYear, 11, 31);
      return entriesInRange(start, end);
    }
    if (statsRange === "month") {
      const { start, end } = getPeriodForView(viewYear, viewMonth);
      return entriesInRange(start, end);
    }
    const end = new Date(viewYear, viewMonth + 1, 0);
    const start = new Date(viewYear, viewMonth - 5, 1);
    return entriesInRange(start, end);
  }

  function renderStats() {
    const entries = getStatsEntries();
    const t = computeTotals(entries);

    document.getElementById("statsHero").innerHTML = `
      <div class="stattile stattile--accent">
        <div class="stattile__label">Total geral</div>
        <div class="stattile__value money">${brl(t.total)}</div>
      </div>
      <div class="stattile">
        <div class="stattile__label">Dias trabalhados</div>
        <div class="stattile__value">${t.diasTrabalhados}</div>
      </div>
      <div class="stattile">
        <div class="stattile__label">Recebido</div>
        <div class="stattile__value money">${brl(t.totalRecebido)}</div>
      </div>
      <div class="stattile">
        <div class="stattile__label">A receber</div>
        <div class="stattile__value money">${brl(t.totalAReceber)}</div>
      </div>`;

    renderBreakdownChart("clientChart", "clientChartEmpty", t.porCliente, state.clientes, "Nenhum lançamento de trabalho normal ainda.");
    renderBreakdownChart("vipChart", "vipChartEmpty", t.porVip, state.vipClientes.map(v => v.nome), "Nenhum lançamento VIP ainda.");
    renderTypeDonut(t.totalNormal, t.totalVip);
    renderTrendChart();
    renderStatsTable(entries);
  }

  function renderBreakdownChart(areaId, emptyId, porPessoa, knownNames, emptyMsg) {
    const wrap = document.getElementById(areaId);
    const emptyHint = document.getElementById(emptyId);
    const nomes = knownNames.slice();
    Object.keys(porPessoa).forEach(n => { if (!nomes.includes(n)) nomes.push(n); });

    const rows = nomes
      .map((nome, i) => ({ nome, ...(porPessoa[nome] || { gerado: 0, recebido: 0, aReceber: 0 }) }))
      .filter(r => r.gerado > 0)
      .sort((a, b) => b.gerado - a.gerado);

    if (!rows.length) { wrap.innerHTML = ""; emptyHint.hidden = false; return; }
    emptyHint.hidden = true;
    const max = Math.max(...rows.map(r => r.gerado));

    wrap.innerHTML = rows.map(r => {
      const pctRecebido = Math.max(0, (r.recebido / max) * 100);
      const pctAReceber = Math.max(0, (r.aReceber / max) * 100);
      const segs = [];
      if (r.recebido > 0) segs.push(`<div class="bar-row__seg bar-row__seg--good" style="width:${Math.max(3, pctRecebido)}%"></div>`);
      if (r.aReceber > 0) segs.push(`<div class="bar-row__seg bar-row__seg--warning" style="width:${Math.max(3, pctAReceber)}%"></div>`);
      return `
        <div class="bar-row">
          <div class="bar-row__label" title="${escapeHTML(r.nome)}">${escapeHTML(r.nome)}</div>
          <div class="bar-row__track">${segs.join("")}</div>
          <div class="bar-row__value-group">
            <div class="bar-row__value">R$ ${brl(r.gerado)}</div>
            ${r.aReceber > 0 ? `<div class="bar-row__value-sub">${brl(r.aReceber)} a receber</div>` : `<div class="bar-row__value-sub">tudo pago</div>`}
          </div>
        </div>`;
    }).join("");
  }

  function renderTypeDonut(totalNormal, totalVip) {
    const total = totalNormal + totalVip;
    const area = document.getElementById("typeDonut");
    const legend = document.getElementById("typeLegend");
    const c1 = "var(--series-1)", c2 = "var(--series-2)";

    if (total <= 0) {
      area.innerHTML = `<svg width="150" height="150" viewBox="0 0 150 150"><circle cx="75" cy="75" r="58" fill="none" stroke="var(--hairline)" stroke-width="20"/></svg>`;
      legend.innerHTML = `<div class="empty-hint" style="padding:0">Sem lançamentos ainda</div>`;
      return;
    }
    const r = 58, circ = 2 * Math.PI * r;
    const pctNormal = totalNormal / total;
    const dashNormal = pctNormal * circ;
    area.innerHTML = `
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--hairline)" stroke-width="20"/>
        <circle cx="75" cy="75" r="${r}" fill="none" stroke="${c2}" stroke-width="20"
          stroke-dasharray="${circ}" stroke-dashoffset="0" transform="rotate(-90 75 75)"/>
        <circle cx="75" cy="75" r="${r}" fill="none" stroke="${c1}" stroke-width="20"
          stroke-dasharray="${dashNormal} ${circ - dashNormal}" stroke-dashoffset="0" transform="rotate(-90 75 75)"
          stroke-linecap="butt"/>
        <text x="75" y="70" text-anchor="middle" font-size="18" font-weight="700" fill="var(--text-primary)">R$ ${brl(total)}</text>
        <text x="75" y="90" text-anchor="middle" font-size="10.5" fill="var(--text-muted)">total</text>
      </svg>`;
    legend.innerHTML = `
      <div class="donut-legend__item"><span class="donut-legend__swatch" style="background:${c1}"></span><span class="donut-legend__label">Normal</span><span class="donut-legend__value">${Math.round(pctNormal*100)}%</span></div>
      <div class="donut-legend__item"><span class="donut-legend__swatch" style="background:${c2}"></span><span class="donut-legend__label">Bico VIP</span><span class="donut-legend__value">${Math.round((1-pctNormal)*100)}%</span></div>`;
  }

  function renderTrendChart() {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(viewYear, viewMonth - i, 1);
      const { start, end } = getPeriodForView(d.getFullYear(), d.getMonth());
      const t = computeTotals(entriesInRange(start, end));
      months.push({ label: MESES_ABREV[d.getMonth()], total: t.total });
    }
    const max = Math.max(1, ...months.map(m => m.total));
    const w = 320, h = 130, padL = 8, padR = 8, padT = 14, padB = 22;
    const innerW = w - padL - padR, innerH = h - padT - padB;
    const stepX = innerW / (months.length - 1 || 1);

    const points = months.map((m, i) => {
      const x = padL + i * stepX;
      const y = padT + innerH - (m.total / max) * innerH;
      return { x, y, ...m };
    });
    const pathD = points.map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" ");
    const areaD = pathD + ` L ${points[points.length-1].x.toFixed(1)} ${padT+innerH} L ${points[0].x.toFixed(1)} ${padT+innerH} Z`;

    const dots = points.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--series-1)" stroke="var(--surface-2)" stroke-width="2"/>`).join("");
    const labels = points.map(p => `<text class="trend-tip" x="${p.x.toFixed(1)}" y="${h-6}" text-anchor="middle">${p.label}</text>`).join("");
    const lastLabel = `<text class="trend-tip" x="${points[points.length-1].x.toFixed(1)}" y="${Math.max(12, points[points.length-1].y - 8)}" text-anchor="middle" font-weight="700" fill="var(--text-primary)">R$ ${brl(points[points.length-1].total)}</text>`;

    document.getElementById("trendChart").innerHTML = `
      <svg class="trend-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
        <path d="${areaD}" fill="var(--series-1)" opacity="0.1"/>
        <path d="${pathD}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        ${labels}
        ${lastLabel}
      </svg>`;
  }

  function renderStatsTable(entries) {
    const sorted = entries.slice().sort((a, b) => b.date.localeCompare(a.date));
    const tbody = document.querySelector("#statsTable tbody");
    tbody.innerHTML = sorted.map(r => {
      const [y, m, d] = r.date.split("-");
      const turnoTxt = r.tipo === "vip" ? "—" : (r.turno === "noturno" ? "🌙 Noturno" : "☀️ Diurno");
      return `<tr>
        <td>${d}/${m}/${y}</td>
        <td>${r.tipo === "vip" ? "VIP" : "Normal"}</td>
        <td>${escapeHTML(r.cliente || "—")}</td>
        <td>${turnoTxt}</td>
        <td>R$ ${brl(r.valor)}</td>
        <td>${r.pago ? '<span class="status-pill status-pill--good">Pago</span>' : '<span class="status-pill status-pill--warning">A receber</span>'}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">Sem dados</td></tr>`;
  }

  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    const entries = getStatsEntries().slice().sort((a,b) => a.date.localeCompare(b.date));
    let csv = "Data;Tipo;Para quem;Turno;Valor;Status;Observacao\n";
    entries.forEach(r => {
      const turnoTxt = r.tipo === "vip" ? "" : (r.turno === "noturno" ? "Noturno" : "Diurno");
      csv += `${r.date};${r.tipo === "vip" ? "VIP" : "Normal"};${r.cliente||""};${turnoTxt};${(r.valor||0).toFixed(2).replace(".",",")};${r.pago ? "Pago" : "A receber"};${(r.obs||"").replace(/;/g,",")}\n`;
    });
    downloadFile(csv, `controle-trabalho_${Date.now()}.csv`, "text/csv;charset=utf-8");
  });

  // ---------------------------------------------------------
  // Configurações: clientes (trabalho normal)
  // ---------------------------------------------------------
  function renderClientList() {
    const box = document.getElementById("clientList");
    if (!state.clientes.length) {
      box.innerHTML = `<div class="empty-hint" style="padding:0">Nenhum cliente cadastrado ainda</div>`;
      return;
    }
    box.innerHTML = state.clientes.map((c, i) => `
      <span class="chip">
        <span class="chip__dot" style="background:${SERIES_COLORS[i % SERIES_COLORS.length]}"></span>
        ${escapeHTML(c)}
        <button type="button" class="chip__edit" data-edit-client="${escapeHTML(c)}" aria-label="Editar">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button type="button" class="chip__del" data-remove-client="${escapeHTML(c)}" aria-label="Remover">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </span>`).join("");

    box.querySelectorAll("[data-edit-client]").forEach(btn => {
      btn.addEventListener("click", () => {
        const nomeAtual = btn.dataset.editClient;
        const novoNome = prompt("Editar nome:", nomeAtual);
        if (!novoNome || !novoNome.trim() || novoNome.trim() === nomeAtual) return;
        const novo = novoNome.trim();
        if (state.clientes.some(c => c.toLowerCase() === novo.toLowerCase() && c !== nomeAtual)) { toast("Já existe um cliente com esse nome"); return; }
        state.clientes = state.clientes.map(c => c === nomeAtual ? novo : c);
        state.registros.forEach(r => { if (r.tipo === "normal" && r.cliente === nomeAtual) r.cliente = novo; });
        saveState();
        renderClientList();
        refreshAll();
        toast("Nome atualizado ✓");
      });
    });
    box.querySelectorAll("[data-remove-client]").forEach(btn => {
      btn.addEventListener("click", () => {
        const nome = btn.dataset.removeClient;
        if (!confirm(`Remover "${nome}" da lista? Lançamentos já feitos não serão apagados.`)) return;
        state.clientes = state.clientes.filter(c => c !== nome);
        saveState();
        renderClientList();
        refreshAll();
      });
    });
  }

  document.getElementById("addClientForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("newClientInput");
    const nome = input.value.trim();
    if (!nome) return;
    if (state.clientes.some(c => c.toLowerCase() === nome.toLowerCase())) { toast("Esse nome já está na lista"); return; }
    state.clientes.push(nome);
    saveState();
    input.value = "";
    renderClientList();
    toast("Cliente adicionado");
  });

  // ---------------------------------------------------------
  // Configurações: clientes VIP
  // ---------------------------------------------------------
  function renderVipClientList() {
    const box = document.getElementById("vipClientList");
    if (!state.vipClientes.length) {
      box.innerHTML = `<div class="empty-hint" style="padding:0">Nenhum cliente VIP cadastrado ainda</div>`;
      return;
    }
    box.innerHTML = state.vipClientes.map((c, i) => `
      <span class="chip">
        <span class="chip__dot" style="background:${SERIES_COLORS[(i + 1) % SERIES_COLORS.length]}"></span>
        ${escapeHTML(c.nome)}
        <span class="chip__value">R$ ${brl(c.valorPadrao)}</span>
        <button type="button" class="chip__edit" data-edit-vip="${escapeHTML(c.nome)}" aria-label="Editar">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button type="button" class="chip__del" data-remove-vip="${escapeHTML(c.nome)}" aria-label="Remover">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </span>`).join("");

    box.querySelectorAll("[data-edit-vip]").forEach(btn => {
      btn.addEventListener("click", () => {
        const nomeAtual = btn.dataset.editVip;
        const cli = state.vipClientes.find(c => c.nome === nomeAtual);
        if (!cli) return;
        const novoNome = prompt("Editar nome do cliente VIP:", nomeAtual);
        if (novoNome === null || !novoNome.trim()) return;
        const novoValorStr = prompt("Valor padrão (R$):", String(cli.valorPadrao));
        if (novoValorStr === null) return;
        const novoValor = parseFloat(novoValorStr.replace(",", "."));
        if (isNaN(novoValor) || novoValor < 0) { toast("Valor inválido"); return; }
        const novo = novoNome.trim();
        if (novo.toLowerCase() !== nomeAtual.toLowerCase() && state.vipClientes.some(c => c.nome.toLowerCase() === novo.toLowerCase())) { toast("Já existe um cliente VIP com esse nome"); return; }
        state.registros.forEach(r => { if (r.tipo === "vip" && r.cliente === nomeAtual) r.cliente = novo; });
        cli.nome = novo; cli.valorPadrao = novoValor;
        saveState();
        renderVipClientList();
        refreshAll();
        toast("Cliente VIP atualizado ✓");
      });
    });
    box.querySelectorAll("[data-remove-vip]").forEach(btn => {
      btn.addEventListener("click", () => {
        const nome = btn.dataset.removeVip;
        if (!confirm(`Remover "${nome}" da lista VIP? Lançamentos já feitos não serão apagados.`)) return;
        state.vipClientes = state.vipClientes.filter(c => c.nome !== nome);
        saveState();
        renderVipClientList();
        refreshAll();
      });
    });
  }

  document.getElementById("addVipClientForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const nomeInput = document.getElementById("newVipClientInput");
    const valorInput = document.getElementById("newVipValueInput");
    const nome = nomeInput.value.trim();
    const valor = parseFloat(valorInput.value);
    if (!nome || isNaN(valor) || valor < 0) { toast("Preencha nome e valor"); return; }
    if (state.vipClientes.some(c => c.nome.toLowerCase() === nome.toLowerCase())) { toast("Esse cliente VIP já existe"); return; }
    state.vipClientes.push({ nome, valorPadrao: valor });
    saveState();
    nomeInput.value = ""; valorInput.value = "";
    renderVipClientList();
    toast("Cliente VIP adicionado");
  });

  // ---------------------------------------------------------
  // Valores padrão por turno
  // ---------------------------------------------------------
  function initTurnoInputs() {
    document.getElementById("turnoDiurnoInput").value = state.turnoValores.diurno;
    document.getElementById("turnoNoturnoInput").value = state.turnoValores.noturno;
  }
  document.getElementById("turnoDiurnoInput").addEventListener("change", (e) => {
    const v = parseFloat(e.target.value);
    state.turnoValores.diurno = isNaN(v) ? 0 : v;
    saveState();
    toast("Valor diurno atualizado");
  });
  document.getElementById("turnoNoturnoInput").addEventListener("change", (e) => {
    const v = parseFloat(e.target.value);
    state.turnoValores.noturno = isNaN(v) ? 0 : v;
    saveState();
    toast("Valor noturno atualizado");
  });

  // ---------------------------------------------------------
  // Ciclo de pagamento
  // ---------------------------------------------------------
  const cycleToggle = document.getElementById("cycleToggle");
  const cycleDayRow = document.getElementById("cycleDayRow");
  const cycleDayInput = document.getElementById("cycleDay");

  function initCycleInputs() {
    cycleToggle.checked = state.cicloAtivo;
    cycleDayRow.hidden = !state.cicloAtivo;
    cycleDayInput.value = state.cicloDia;
  }
  cycleToggle.addEventListener("change", () => {
    state.cicloAtivo = cycleToggle.checked;
    cycleDayRow.hidden = !state.cicloAtivo;
    saveState();
    refreshAll();
  });
  cycleDayInput.addEventListener("change", () => {
    let v = parseInt(cycleDayInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 28) v = 28;
    cycleDayInput.value = v;
    state.cicloDia = v;
    saveState();
    refreshAll();
  });

  // ---------------------------------------------------------
  // Backup: exportar / importar / limpar
  // ---------------------------------------------------------
  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.getElementById("exportBtn").addEventListener("click", () => {
    downloadFile(JSON.stringify(state, null, 2), `backup-controle-trabalho_${Date.now()}.json`, "application/json");
    toast("Backup exportado");
  });

  document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.registros)) throw new Error("formato inválido");
        if (!confirm("Importar este backup vai SUBSTITUIR todos os dados atuais. Continuar?")) return;
        state = normalizeState(parsed);
        saveState();
        renderClientList();
        renderVipClientList();
        initTurnoInputs();
        initCycleInputs();
        refreshAll();
        toast("Backup importado ✓");
      } catch (err) {
        toast("Arquivo inválido");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("clearAllBtn").addEventListener("click", () => {
    if (!confirm("Isso vai apagar todos os lançamentos dos dias. Os clientes normais e VIP continuarão cadastrados. Tem certeza?")) return;
    if (!confirm("Confirma mesmo? Considere exportar um backup antes.")) return;
    state.registros = [];
    saveState();
    refreshAll();
    toast("Lançamentos apagados");
  });

  // ---------------------------------------------------------
  // Refresh geral
  // ---------------------------------------------------------
  function refreshAll() {
    renderCalendar();
    renderQuickStats();
    renderPeopleLegend();
    renderMonthEntriesList();
    if (document.getElementById("tab-estatisticas").classList.contains("is-active")) renderStats();
  }

  // ---------------------------------------------------------
  // Init
  // ---------------------------------------------------------
  renderClientList();
  renderVipClientList();
  initTurnoInputs();
  initCycleInputs();
  refreshAll();
  document.getElementById("versionTag").textContent = `Controle de Trabalho · ${APP_VERSION} · by Alex`;

  loadRemoteState();
  if (remoteEnabled) {
    setInterval(refreshRemoteState, 15000);
    window.addEventListener("focus", refreshRemoteState);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
