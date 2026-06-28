import { PDFDocument, StandardFonts, rgb } from "./vendor/pdf-lib.esm.min.js";

const MS_DAY = 24 * 60 * 60 * 1000;

const scenarios = {
  hdb_sale: {
    label: "HDB Sales",
    tracks: ["hdbSale"],
  },
  hdb_purchase: {
    label: "HDB Purchase",
    tracks: ["hdbPurchase"],
  },
  private_purchase: {
    label: "Private Purchase",
    tracks: ["privatePurchase"],
  },
  private_sale: {
    label: "Private Sales",
    tracks: ["privateSale"],
  },
  hdb_to_hdb: {
    label: "HDB Sales to HDB Purchase",
    tracks: ["hdbSale", "hdbPurchase"],
    linked: true,
  },
  private_to_private: {
    label: "Private Sales to Private Purchase",
    tracks: ["privateSale", "privatePurchase"],
    linked: true,
  },
  hdb_to_private: {
    label: "Upgrade: HDB Sales to Private Purchase",
    tracks: ["hdbSale", "privatePurchase"],
    linked: true,
  },
  private_to_hdb: {
    label: "Downgrade: Private Sales to HDB Purchase",
    tracks: ["privateSale", "hdbPurchase"],
    linked: true,
  },
};

const trackMeta = {
  hdbSale: { label: "HDB Sales", type: "hdb", side: "sale" },
  hdbPurchase: { label: "HDB Purchase", type: "hdb", side: "purchase" },
  privateSale: { label: "Private Sales", type: "private", side: "sale" },
  privatePurchase: { label: "Private Purchase", type: "private", side: "purchase" },
};

const defaultAssumptions = {
  cpfBufferDays: 21,
  hdbSale: { otpExerciseDays: 21, resaleSubmissionDays: 60, hdbAcceptanceDays: 28, endorsementDays: 14, completionWeeks: 8, extensionMonths: 0 },
  hdbPurchase: { otpExerciseDays: 21, resaleSubmissionDays: 60, hdbAcceptanceDays: 28, endorsementDays: 14, completionWeeks: 8, extensionMonths: 0, renovationMonths: 0 },
  privateSale: { otpExerciseWeeks: 2, completionWeeks: 12, extensionMonths: 0 },
  privatePurchase: { otpExerciseWeeks: 2, completionWeeks: 12, extensionMonths: 0, renovationMonths: 0 },
};

const singaporePublicHolidays = {
  "2026-01-01": "New Year's Day",
  "2026-02-17": "Chinese New Year",
  "2026-02-18": "Chinese New Year",
  "2026-03-21": "Hari Raya Puasa",
  "2026-04-03": "Good Friday",
  "2026-05-01": "Labour Day",
  "2026-05-27": "Hari Raya Haji",
  "2026-06-01": "Vesak Day observed",
  "2026-08-10": "National Day observed",
  "2026-11-08": "Deepavali",
  "2026-11-09": "Deepavali observed",
  "2026-12-25": "Christmas Day",
  "2027-01-01": "New Year's Day",
  "2027-02-06": "Chinese New Year",
  "2027-02-07": "Chinese New Year",
  "2027-02-08": "Chinese New Year observed",
  "2027-03-10": "Hari Raya Puasa",
  "2027-03-26": "Good Friday",
  "2027-05-01": "Labour Day",
  "2027-05-17": "Hari Raya Haji",
  "2027-05-20": "Vesak Day",
  "2027-08-09": "National Day",
  "2027-10-28": "Deepavali",
  "2027-12-25": "Christmas Day",
};

const state = {
  mode: "forward",
  scenario: "hdb_to_private",
  skipWeekends: true,
  includeBuffer: true,
  assumptions: structuredClone(defaultAssumptions),
  dates: {
    saleIssueDate: isoDate(new Date()),
    purchaseIssueDate: isoDate(addDays(new Date(), 185)),
    saleCompletionDate: isoDate(addDays(new Date(), 120)),
    purchaseCompletionDate: isoDate(addDays(new Date(), 141)),
  },
};

const els = {
  scenario: document.querySelector("#scenario"),
  forwardInputs: document.querySelector("#forwardInputs"),
  reverseInputs: document.querySelector("#reverseInputs"),
  assumptions: document.querySelector("#assumptions"),
  skipWeekends: document.querySelector("#skipWeekends"),
  includeBuffer: document.querySelector("#includeBuffer"),
  timelineTitle: document.querySelector("#timelineTitle"),
  timelineGraphic: document.querySelector("#timelineGraphic"),
  itemizedTimeline: document.querySelector("#itemizedTimeline"),
  timelineChecklist: document.querySelector("#timelineChecklist"),
  summary: document.querySelector("#summary"),
  comparison: document.querySelector("#comparison"),
  bufferStatus: document.querySelector("#bufferStatus"),
  downloadPdf: document.querySelector("#downloadPdf"),
  resetDefaults: document.querySelector("#resetDefaults"),
};

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addBusinessDays(date, days) {
  let result = new Date(date);
  let remaining = Number(days);
  const direction = remaining < 0 ? -1 : 1;
  remaining = Math.abs(remaining);
  while (remaining > 0) {
    result.setDate(result.getDate() + direction);
    const day = result.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

function addMonths(date, months) {
  const result = new Date(date);
  const value = Number(months || 0);
  const wholeMonths = value < 0 ? Math.ceil(value) : Math.floor(value);
  const partialMonth = value - wholeMonths;
  result.setMonth(result.getMonth() + wholeMonths);
  if (partialMonth) result.setDate(result.getDate() + Math.round(partialMonth * 30.4));
  return result;
}

function addDuration(date, amount, unit, direction = 1) {
  const signed = Number(amount) * direction;
  if (unit === "workingDays") return state.skipWeekends ? addBusinessDays(date, signed) : addDays(date, signed);
  if (unit === "calendarDays" || unit === "days") return addDays(date, signed);
  if (unit === "weeks") return addDays(date, signed * 7);
  if (unit === "months") return addMonths(date, signed);
  return date;
}

function addCpfBuffer(date, direction = 1) {
  const signed = Number(state.assumptions.cpfBufferDays) * direction;
  return state.skipWeekends ? addBusinessDays(date, signed) : addDays(date, signed);
}

function parseDate(value) {
  if (/^\d{8}$/.test(value)) {
    const day = Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4));
    const year = Number(value.slice(4, 8));
    return new Date(year, month - 1, day);
  }
  const prettyMatch = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (prettyMatch) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const day = Number(prettyMatch[1]);
    const month = months.indexOf(prettyMatch[2].toLowerCase());
    const year = Number(prettyMatch[3]);
    return new Date(year, month, day);
  }
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(date) {
  return date.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" }).replaceAll(" ", "-");
}

function holidayKey(date) {
  return isoDate(stripTime(date));
}

function completionBlocker(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return day === 0 ? "Sunday" : "Saturday";
  return singaporePublicHolidays[holidayKey(date)] || "";
}

function formatInputDate(value) {
  return displayDate(parseDate(value));
}

function readInputDate(value, fallback) {
  const clean = value.trim();
  const parsed = parseDate(clean);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return isoDate(parsed);
}

function daysBetween(a, b) {
  return Math.round((stripTime(b) - stripTime(a)) / MS_DAY);
}

function workingDaysBetween(a, b) {
  let current = stripTime(a);
  const end = stripTime(b);
  let days = 0;
  while (current < end) {
    current = addDays(current, 1);
    if (current.getDay() !== 0 && current.getDay() !== 6) days += 1;
  }
  return days;
}

function cpfBufferGapDays(a, b) {
  return state.skipWeekends ? workingDaysBetween(a, b) : daysBetween(a, b);
}

function cpfBufferUnitLabel() {
  return state.skipWeekends ? "working days" : "calendar days";
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function stepsFor(trackKey) {
  const a = state.assumptions[trackKey];
  if (trackMeta[trackKey].type === "hdb") {
    return [
      { name: "Issue OTP", duration: a.otpExerciseDays, unit: "calendarDays" },
      { name: "Exercise OTP", duration: a.resaleSubmissionDays, unit: "workingDays" },
      { name: "HDB Submission", duration: a.hdbAcceptanceDays, unit: "workingDays" },
      { name: "Acceptance by HDB", duration: a.endorsementDays, unit: "days" },
      { name: "Endorsement", duration: a.completionWeeks, unit: "weeks" },
      { name: "Legal Completion", duration: a.extensionMonths, unit: "months" },
      { name: "Extension Completion", optional: true, duration: trackMeta[trackKey].side === "purchase" ? a.renovationMonths : 0, unit: "months" },
      ...(trackMeta[trackKey].side === "purchase" ? [{ name: "Renovation Ready", optional: true, duration: 0, unit: "days" }] : []),
    ];
  }
  return [
    { name: "Issue OTP", duration: a.otpExerciseWeeks, unit: "weeks" },
    { name: "Exercise OTP", duration: a.completionWeeks, unit: "weeks" },
    { name: "Legal Completion", duration: a.extensionMonths, unit: "months" },
    { name: "Extension Completion", optional: true, duration: trackMeta[trackKey].side === "purchase" ? a.renovationMonths : 0, unit: "months" },
    ...(trackMeta[trackKey].side === "purchase" ? [{ name: "Renovation Ready", optional: true, duration: 0, unit: "days" }] : []),
  ];
}

function buildForward(trackKey, issueDate) {
  const events = [];
  let current = parseDate(issueDate);
  const steps = stepsFor(trackKey);
  steps.forEach((step, index) => {
    events.push({ name: step.name, date: new Date(current), optional: step.optional, durationAfter: durationLabel(step) });
    if (index < steps.length - 1) {
      current = addDuration(current, step.duration, step.unit);
    }
  });
  return normalizeTrack(trackKey, events);
}

function buildReverse(trackKey, completionDate) {
  const steps = stepsFor(trackKey);
  const completionIndex = steps.findIndex((step) => step.name === "Legal Completion");
  let current = parseDate(completionDate);
  const events = [{ name: "Legal Completion", date: new Date(current) }];
  for (let i = completionIndex - 1; i >= 0; i -= 1) {
    current = addDuration(current, steps[i].duration, steps[i].unit, -1);
    events.unshift({ name: steps[i].name, date: new Date(current), optional: steps[i].optional, durationAfter: durationLabel(steps[i]) });
  }
  const afterCompletion = steps.slice(completionIndex + 1);
  let after = parseDate(completionDate);
  afterCompletion.forEach((step, index) => {
    after = addDuration(after, steps[completionIndex + index].duration, steps[completionIndex + index].unit);
    events.push({ name: step.name, date: new Date(after), optional: step.optional, durationAfter: durationLabel(step) });
  });
  return normalizeTrack(trackKey, events);
}

function durationLabel(step) {
  const amount = Number(step.duration || 0);
  if (!amount) return "";
  const unit = step.unit === "workingDays" ? (state.skipWeekends ? "working days" : "days") : step.unit === "calendarDays" ? "days" : step.unit;
  return `${amount} ${unit}`;
}

function normalizeTrack(trackKey, events) {
  const completion = legalCompletion(events);
  const filtered = events.filter((event) => !event.optional || event.date.getTime() !== completion.getTime());
  return {
    key: trackKey,
    label: trackMeta[trackKey].label,
    side: trackMeta[trackKey].side,
    events: filtered,
    legalCompletion: completion,
  };
}

function legalCompletion(events) {
  return events.find((event) => event.name === "Legal Completion")?.date || events.at(-1).date;
}

function calculate() {
  const scenario = scenarios[state.scenario];
  const hasSale = scenario.tracks.some((key) => trackMeta[key].side === "sale");
  const hasPurchase = scenario.tracks.some((key) => trackMeta[key].side === "purchase");
  let saleCompletionTarget = state.dates.saleCompletionDate;
  let purchaseCompletionTarget = state.dates.purchaseCompletionDate;

  if (state.mode === "reverse" && hasSale && hasPurchase && state.includeBuffer) {
    purchaseCompletionTarget = isoDate(addCpfBuffer(parseDate(saleCompletionTarget)));
  }

  const tracks = scenario.tracks.map((key) => {
    const meta = trackMeta[key];
    if (state.mode === "reverse") {
      if (meta.side === "sale") return buildReverse(key, saleCompletionTarget);
      return buildReverse(key, purchaseCompletionTarget);
    }
    const issueDate = meta.side === "sale" ? state.dates.saleIssueDate : state.dates.purchaseIssueDate;
    return buildForward(key, issueDate);
  });

  return { scenario, tracks };
}

function render() {
  if (!state.includeBuffer) state.assumptions.cpfBufferDays = 0;
  if (state.includeBuffer && state.assumptions.cpfBufferDays === 0) state.assumptions.cpfBufferDays = 21;
  els.scenario.value = state.scenario;
  els.skipWeekends.checked = state.skipWeekends;
  els.includeBuffer.checked = state.includeBuffer;
  document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  els.forwardInputs.classList.toggle("hidden", state.mode !== "forward");
  els.reverseInputs.classList.toggle("hidden", state.mode !== "reverse");
  renderInputs();
  renderAssumptions();
  const result = calculate();
  renderChecklist(result);
  renderItemized(result);
  renderTimeline(result);
  renderSummary(result);
}

function renderInputs() {
  const scenario = scenarios[state.scenario];
  const hasSale = scenario.tracks.some((key) => trackMeta[key].side === "sale");
  const hasPurchase = scenario.tracks.some((key) => trackMeta[key].side === "purchase");
  els.forwardInputs.innerHTML = `
    ${hasSale ? dateField("saleIssueDate", "Sale issue OTP date", "First sale milestone") : ""}
    ${hasPurchase ? dateField("purchaseIssueDate", "Purchase issue OTP date", "First purchase milestone") : ""}
  `;
  els.reverseInputs.innerHTML = `
    ${hasSale ? dateField("saleCompletionDate", "Sale legal completion date", "CPF refund buffer starts from legal completion") : ""}
    ${hasPurchase && !hasSale ? dateField("purchaseCompletionDate", "Purchase legal completion date", "System works backward to latest OTP date") : ""}
    ${hasPurchase && hasSale ? `<div class="field"><span class="field-label">Purchase legal completion date</span><input type="text" value="${displayDate(addCpfBuffer(parseDate(state.dates.saleCompletionDate)))}" disabled /><small>${state.includeBuffer ? `Auto-filled from sale legal completion + ${state.assumptions.cpfBufferDays}-${state.skipWeekends ? "working" : "calendar"}-day CPF buffer.` : "Auto-filled from sale legal completion with 0-day buffer."}</small></div>` : ""}
  `;
  document.querySelectorAll("[data-date-key]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const clean = event.target.value.replaceAll("-", "").trim();
      if (/^\d{8}$/.test(clean)) {
        state.dates[event.target.dataset.dateKey] = readInputDate(clean, state.dates[event.target.dataset.dateKey]);
        render();
      }
    });
    input.addEventListener("blur", (event) => {
      state.dates[event.target.dataset.dateKey] = readInputDate(event.target.value, state.dates[event.target.dataset.dateKey]);
      render();
    });
  });
}

function dateField(key, label, hint) {
  return `<div class="field"><label for="${key}">${label}</label><input id="${key}" data-date-key="${key}" type="text" inputmode="numeric" placeholder="DDMMYYYY" value="${formatInputDate(state.dates[key])}" /><small>${hint}</small></div>`;
}

function renderAssumptions() {
  const scenario = scenarios[state.scenario];
  const rendered = new Set();
  const groups = [];
  scenario.tracks.forEach((key) => {
    if (rendered.has(key)) return;
    rendered.add(key);
    const values = state.assumptions[key];
    const entries = Object.entries(values).map(([name, value]) => {
      const label = labelize(name);
      const unit = assumptionUnit(name);
      const step = name.toLowerCase().includes("months") ? "any" : "1";
      const inputMode = name.toLowerCase().includes("months") ? "decimal" : "numeric";
      return `<div class="duration-grid"><label>${label}${unit ? ` <span>${unit}</span>` : ""}</label><input data-assumption-track="${key}" data-assumption-key="${name}" type="number" inputmode="${inputMode}" min="0" step="${step}" value="${value}" /></div>`;
    }).join("");
    groups.push(`<div class="assumption-group"><h3>${trackMeta[key].label}</h3>${entries}</div>`);
  });
  groups.unshift(`<div class="assumption-group"><h3>CPF Buffer</h3><div class="duration-grid"><label>CPF refund buffer <span>(days)</span></label><input data-assumption-track="root" data-assumption-key="cpfBufferDays" type="number" min="0" step="1" value="${state.includeBuffer ? state.assumptions.cpfBufferDays : 0}" ${state.includeBuffer ? "" : "disabled"} /></div></div>`);
  els.assumptions.innerHTML = groups.join("");
  document.querySelectorAll("[data-assumption-key]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const track = event.target.dataset.assumptionTrack;
      const key = event.target.dataset.assumptionKey;
      const value = Number(event.target.value || 0);
      if (track === "root") state.assumptions[key] = value;
      else state.assumptions[track][key] = value;
      updateFromState();
    });
    input.addEventListener("blur", () => {
      render();
    });
  });
}

function labelize(value) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/\s+(Days|Weeks|Months)$/i, "")
    .replace(/^./, (char) => char.toUpperCase())
    .replace("Otp", "OTP")
    .replace("Hdb", "HDB");
}

function assumptionUnit(name) {
  if (name.toLowerCase().includes("weeks")) return "(weeks)";
  if (name.toLowerCase().includes("months")) return "(months)";
  if (name.toLowerCase().includes("days")) return "(days)";
  return "";
}

function renderSummary({ scenario, tracks }) {
  const sale = tracks.find((track) => track.side === "sale");
  const purchase = tracks.find((track) => track.side === "purchase");
  const bufferDays = sale && purchase ? daysBetween(sale.legalCompletion, purchase.legalCompletion) : null;
  const cpfGapDays = sale && purchase ? cpfBufferGapDays(sale.legalCompletion, purchase.legalCompletion) : null;
  const latestPurchaseOtp = purchase ? purchase.events[0].date : null;
  const otpGapDays = sale && purchase ? daysBetween(sale.events[0].date, purchase.events[0].date) : null;
  const checklistItems = buildChecklist({ tracks });
  const warningCount = checklistItems.filter((item) => !item.ok).length;
  const metrics = [
    ["Scenario", scenario.label],
    ["Sale legal completion", sale ? displayDate(sale.legalCompletion) : "Not selected"],
    ["Purchase legal completion", purchase ? displayDate(purchase.legalCompletion) : "Not selected"],
    ["Latest purchase OTP", latestPurchaseOtp ? displayDate(latestPurchaseOtp) : "Not selected"],
    ["Sale OTP to purchase OTP", otpGapDays !== null ? `${otpGapDays} days / ${(otpGapDays / 30.4).toFixed(1)} months` : "Not selected"],
  ];
  const metricHtml = ([label, value], extraClass = "") => {
    const dateClass = /^\d{2}-[A-Za-z]{3}-\d{4}$/.test(value) ? " date-value" : "";
    return `<div class="metric ${extraClass}"><span>${label}</span><strong class="${dateClass.trim()}">${value}</strong></div>`;
  };
  els.summary.innerHTML = `
    <div class="summary-row scenario-row">${metricHtml(metrics[0], "scenario-metric")}</div>
    <div class="summary-row detail-row">${metrics.slice(1).map((metric) => metricHtml(metric)).join("")}</div>
  `;

  let status = "Single timeline";
  let statusClass = "";
  if (bufferDays !== null) {
    if (!state.includeBuffer) status = `${bufferDays} calendar days between completions`;
    else if (cpfGapDays >= state.assumptions.cpfBufferDays) status = `CPF buffer met: ${cpfGapDays} ${cpfBufferUnitLabel()}`;
    else {
      status = `CPF buffer short: ${cpfGapDays} ${cpfBufferUnitLabel()}`;
      statusClass = "danger";
    }
  }
  els.bufferStatus.textContent = status;
  els.bufferStatus.className = `status-pill ${statusClass}`;

  els.comparison.innerHTML = `
    <div class="note-box"><h3>Funds readiness</h3><p>Confirm CPF refund timing, stamp duty and cash shortfall before exercising the purchase OTP.</p></div>
    <div class="note-box"><h3>Next action</h3><p>${warningCount ? `Review ${warningCount} timeline item${warningCount > 1 ? "s" : ""} before proceeding.` : "No warnings found. You can proceed with this timeline plan."}</p></div>
  `;
}

function updateFromState() {
  const result = calculate();
  renderChecklist(result);
  renderItemized(result);
  renderTimeline(result);
  renderSummary(result);
}

function eventDate(track, name) {
  return track?.events.find((event) => event.name === name)?.date || null;
}

function buildChecklist({ tracks }) {
  const sale = tracks.find((track) => track.side === "sale");
  const purchase = tracks.find((track) => track.side === "purchase");
  const saleExercise = eventDate(sale, "Exercise OTP");
  const purchaseExercise = eventDate(purchase, "Exercise OTP");
  const saleSubmission = eventDate(sale, "HDB Submission");
  const saleNeedsHdbExtension = sale?.key === "hdbSale" && Number(state.assumptions.hdbSale.extensionMonths) > 0;
  const completionGapDays = sale && purchase ? daysBetween(sale.legalCompletion, purchase.legalCompletion) : null;
  const completionGapWorkingDays = sale && purchase ? workingDaysBetween(sale.legalCompletion, purchase.legalCompletion) : null;
  const purchaseIsHdb = purchase?.key === "hdbPurchase";
  const requiredCompletionText = purchaseIsHdb ? "15 working days" : "3 weeks";
  const completionOk = sale && purchase ? (purchaseIsHdb ? completionGapWorkingDays >= 15 : completionGapDays >= 21) : true;
  const completionIssues = [sale, purchase]
    .filter(Boolean)
    .map((track) => ({ track, reason: completionBlocker(track.legalCompletion) }))
    .filter((item) => item.reason);
  const completionIssueText = completionIssues.map((item) => `${item.track.label}: ${displayDate(item.track.legalCompletion)} (${item.reason})`).join("; ");

  return [
    {
      title: "HDB extension sequencing",
      detail: saleNeedsHdbExtension
        ? "Purchase Exercise OTP must be before sale HDB resale submission."
        : "Only applies when HDB sale extension is required.",
      ok: !saleNeedsHdbExtension || (purchaseExercise && saleSubmission && purchaseExercise < saleSubmission),
    },
    {
      title: "ABSD timing",
      detail: "Purchase OTP must be exercised after sale OTP is exercised.",
      ok: !sale || !purchase || (saleExercise && purchaseExercise && purchaseExercise > saleExercise),
    },
    {
      title: "Completion buffer",
      detail: `Completion gap must be at least ${requiredCompletionText}.`,
      ok: completionOk,
      meta: sale && purchase
        ? `${completionGapDays} calendar days${purchaseIsHdb ? ` / ${completionGapWorkingDays} working days` : ""}`
        : "Single timeline",
    },
    {
      title: "Completion date",
      detail: completionIssues.length
        ? "Legal completion should not fall on a weekend or Singapore public holiday."
        : "Legal completion is on a weekday and not in the Singapore PH list.",
      ok: completionIssues.length === 0,
      meta: completionIssueText,
    },
  ];
}

function renderChecklist(result) {
  const items = buildChecklist(result);
  const hasWarning = items.some((item) => !item.ok);
  els.timelineChecklist.innerHTML = `
    <div class="checklist-card ${hasWarning ? "warning" : "clear"}">
      <div class="checklist-heading">
        <span>${hasWarning ? "Warnings to review" : "Clear to proceed"}</span>
        <strong>${hasWarning ? "Timeline needs attention" : "Timeline checks passed"}</strong>
      </div>
      <div class="checklist-items">
        ${items.map((item, index) => `
          <div class="check-item ${item.ok ? "ok" : "warn"}">
            <span>${index + 1}</span>
            <div>
              <small>${item.ok ? "Clear" : "Warning"}</small>
              <strong>${item.title}</strong>
              <p>${item.detail}${item.meta ? ` ${item.meta}.` : ""}</p>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderItemized({ tracks }) {
  els.itemizedTimeline.innerHTML = tracks.map((track) => {
    const rows = track.events.map((event) => `
      <div class="itemized-row">
        <div>
          <strong>${event.name}</strong>
          ${event.durationAfter ? `<span>${event.durationAfter} to next step</span>` : ""}
        </div>
        <time>${displayDate(event.date)}</time>
      </div>
    `).join("");
    return `
      <article class="itemized-card">
        <h3>${track.label}</h3>
        ${rows}
      </article>
    `;
  }).join("");
}

function trackDurationLabel(start, end) {
  const days = daysBetween(start, end);
  return `${days} calendar days / ${(days / 30.4).toFixed(1)} months`;
}

function renderTimeline({ scenario, tracks }) {
  els.timelineTitle.textContent = scenario.label;
  els.timelineGraphic.className = `timeline-graphic tracks-${tracks.length}`;
  els.timelineGraphic.innerHTML = tracks.map((track) => {
    const start = track.events[0].date;
    const end = track.events.at(-1).date;
    const span = Math.max(1, end - start);
    const lastPctByLevel = [-100, -100, -100];
    let previousVisualPct = -100;
    const positionedEvents = track.events.map((event, index) => {
      const pct = ((event.date - start) / span) * 100;
      const visualPct = Math.min(92, Math.max(8, pct, previousVisualPct + 12));
      previousVisualPct = visualPct;
      let level = lastPctByLevel.findIndex((lastPct) => visualPct - lastPct >= 22);
      if (level < 0) level = index % lastPctByLevel.length;
      lastPctByLevel[level] = visualPct;
      return { event, visualPct, level };
    });
    const milestones = positionedEvents.map(({ event, visualPct, level }) => {
      const mobileDuration = event.durationAfter ? `<span class="mobile-duration-chip">${event.durationAfter}</span>` : `<span class="mobile-duration-chip empty"></span>`;
      return `<div class="milestone" style="left:clamp(60px, ${visualPct}%, calc(100% - 60px)); --level:${level}">${mobileDuration}<div class="dot"></div><div class="milestone-label"><strong>${event.name}</strong><span>${displayDate(event.date)}</span></div></div>`;
    }).join("");
    const durationChips = positionedEvents.slice(0, -1).map(({ event, visualPct }, index) => {
      if (!event.durationAfter) return "";
      const nextPct = positionedEvents[index + 1].visualPct;
      const midPct = (visualPct + nextPct) / 2;
      return `<span class="duration-chip" style="left:clamp(52px, ${midPct}%, calc(100% - 52px));">${event.durationAfter}</span>`;
    }).join("");
    return `
      <article class="track">
        <div class="track-title"><strong>${track.label}</strong><span>${trackDurationLabel(start, end)}</span></div>
        <div class="track-line"><div class="track-fill"></div></div>
        <div class="milestones">${durationChips}${milestones}</div>
      </article>
    `;
  }).join("");
}

async function downloadPdf() {
  document.body.dataset.pdfStatus = "started";
  const result = calculate();
  const pdf = await PDFDocument.create();
  const pageSize = [595.28, 841.89];
  let page = pdf.addPage(pageSize);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = pageSize[0];
  const pageHeight = pageSize[1];
  const margin = 42;
  let y = pageHeight - 48;
  const navy = rgb(17 / 255, 28 / 255, 54 / 255);
  const gold = rgb(200 / 255, 155 / 255, 60 / 255);
  const goldLight = rgb(240 / 255, 211 / 255, 138 / 255);
  const muted = rgb(103 / 255, 113 / 255, 134 / 255);
  const paper = rgb(248 / 255, 244 / 255, 238 / 255);
  const background = rgb(245 / 255, 241 / 255, 233 / 255);
  const card = rgb(1, 253 / 255, 250 / 255);
  const line = rgb(217 / 255, 214 / 255, 205 / 255);
  const success = rgb(15 / 255, 143 / 255, 114 / 255);
  const danger = rgb(179 / 255, 38 / 255, 30 / 255);

  function drawPageBackground() {
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: background });
  }

  function drawText(text, x, textY, size = 10, font = regular, color = navy) {
    page.drawText(String(text), { x, y: textY, size, font, color });
  }

  function drawRightText(text, rightX, textY, size = 10, font = regular, color = navy) {
    const value = String(text);
    page.drawText(value, { x: rightX - font.widthOfTextAtSize(value, size), y: textY, size, font, color });
  }

  function drawWrappedText(text, x, textY, maxWidth, size = 10, font = regular, color = navy, lineHeight = size + 3) {
    const words = String(text).split(" ");
    let line = "";
    let currentY = textY;
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        drawText(line, x, currentY, size, font, color);
        currentY -= lineHeight;
        line = word;
      } else {
        line = next;
      }
    });
    if (line) drawText(line, x, currentY, size, font, color);
    return currentY - lineHeight;
  }

  function addReportPage() {
    page = pdf.addPage(pageSize);
    drawPageBackground();
    y = pageHeight - 48;
  }

  function drawPdfChecklist(items) {
    const hasWarning = items.some((item) => !item.ok);
    const cardGap = 10;
    const cardColumns = 2;
    const cardRows = Math.ceil(items.length / cardColumns);
    const cardWidth = (pageWidth - margin * 2 - cardGap * (cardColumns - 1)) / cardColumns;
    const cardHeight = 58;
    const blockHeight = 15 + cardRows * cardHeight + (cardRows - 1) * cardGap + 16;
    if (y - blockHeight < 70) addReportPage();
    drawText(hasWarning ? "Timeline needs attention" : "Timeline checks passed", margin, y, 11.5, bold, navy);
    y -= 15;
    items.forEach((item, index) => {
      const col = index % cardColumns;
      const row = Math.floor(index / cardColumns);
      const x = margin + col * (cardWidth + cardGap);
      const tileY = y - row * (cardHeight + cardGap);
      const markColor = item.ok ? success : danger;
      page.drawRectangle({ x, y: tileY - cardHeight, width: cardWidth, height: cardHeight, color: paper, borderColor: markColor, borderWidth: 0.8 });
      page.drawCircle({ x: x + 15, y: tileY - 16, size: 8, color: markColor });
      drawText(String(index + 1), x + 12.5, tileY - 19, 6.5, bold, rgb(1, 1, 1));
      drawRightText(item.ok ? "CLEAR" : "WARNING", x + cardWidth - 8, tileY - 14, 6, bold, markColor);
      drawWrappedText(item.title, x + 10, tileY - 31, cardWidth - 20, 7.2, bold, navy, 8.2);
      const detail = `${item.detail}${item.meta ? ` ${item.meta}.` : ""}`;
      drawWrappedText(detail, x + 10, tileY - 45, cardWidth - 20, 5.2, regular, muted, 6.1);
    });
    y -= cardRows * cardHeight + (cardRows - 1) * cardGap + 16;
  }

  function drawPdfItemisedCards() {
    const cardWidth = pageWidth - margin * 2;
    const rowHeight = 25;
    const firstCardHeight = 28 + result.tracks[0].events.length * rowHeight;
    const headingHeight = 38;
    if (y - headingHeight - firstCardHeight < 70) addReportPage();
    drawText("DATES", margin, y, 8, bold, gold);
    y -= 15;
    drawText("Itemised Timeline", margin, y, 13.5, bold, navy);
    y -= 18;
    result.tracks.forEach((track) => {
      const cardHeight = 28 + track.events.length * rowHeight;
      if (y - cardHeight < 70) addReportPage();
      const x = margin;
      page.drawRectangle({ x, y: y - cardHeight, width: cardWidth, height: cardHeight, color: card, borderColor: line, borderWidth: 1 });
      page.drawRectangle({ x, y: y - 28, width: cardWidth, height: 28, color: paper });
      drawText(track.label, x + 12, y - 18, 10.5, bold, navy);
      track.events.forEach((event, rowIndex) => {
        const rowY = y - 28 - rowIndex * rowHeight;
        page.drawLine({ start: { x, y: rowY }, end: { x: x + cardWidth, y: rowY }, thickness: 0.5, color: line });
        drawText(event.name, x + 12, rowY - 11, 7.2, bold, navy);
        if (event.durationAfter) drawText(`${event.durationAfter} to next step`, x + 12, rowY - 21, 5.7, bold, gold);
        drawRightText(displayDate(event.date), x + cardWidth - 12, rowY - 15, 7.4, bold, navy);
      });
      y -= cardHeight + 8;
    });
    y -= 8;
  }

  function drawPdfPlanningTiles(saleTrack, purchaseTrack, otpGapDays) {
    const notes = [
      ["Sale OTP to purchase OTP", saleTrack && purchaseTrack ? `${otpGapDays} days / ${(otpGapDays / 30.4).toFixed(1)} months` : "Single timeline"],
      ["CPF refund buffer", state.includeBuffer ? `${state.assumptions.cpfBufferDays} ${cpfBufferUnitLabel()} from sale legal completion` : "Not enforced"],
      ["Funds readiness", "Confirm CPF refund, stamp duty and cash shortfall before exercising purchase OTP."],
      ["Next action", "Review warnings first. If there are no warnings, this timeline can be used for planning."],
    ];
    const gap = 10;
    const tileWidth = (pageWidth - margin * 2 - gap) / 2;
    const tileHeight = 42;
    const blockHeight = 16 + tileHeight * 2 + gap + 12;
    if (y - blockHeight < 70) addReportPage();
    drawText("PLANNING NOTES", margin, y, 8, bold, gold);
    y -= 15;
    notes.forEach(([label, value], index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = margin + col * (tileWidth + gap);
      const tileY = y - row * (tileHeight + gap);
      page.drawRectangle({ x, y: tileY - tileHeight, width: tileWidth, height: tileHeight, color: paper, borderColor: line, borderWidth: 1 });
      drawText(label, x + 10, tileY - 13, 6.2, bold, muted);
      drawWrappedText(value, x + 10, tileY - 27, tileWidth - 20, index < 2 ? 8.2 : 6.5, index < 2 ? bold : regular, navy, index < 2 ? 9.2 : 7.6);
    });
    y -= tileHeight * 2 + gap + 14;
  }

  function drawPdfInfographic() {
    if (y < 225) addReportPage();
    drawText("INFOGRAPHIC", margin, y, 8, bold, gold);
    y -= 15;
    drawText(scenarios[state.scenario].label, margin, y, 13.5, bold, navy);
    const sale = result.tracks.find((track) => track.side === "sale");
    const purchase = result.tracks.find((track) => track.side === "purchase");
    if (sale && purchase) {
      const bufferDays = daysBetween(sale.legalCompletion, purchase.legalCompletion);
      const cpfGapDays = cpfBufferGapDays(sale.legalCompletion, purchase.legalCompletion);
      const bufferText = state.includeBuffer ? `CPF buffer: ${cpfGapDays} ${cpfBufferUnitLabel()}` : `${bufferDays} calendar days between completions`;
      const pillWidth = Math.max(90, bold.widthOfTextAtSize(bufferText, 7.5) + 20);
      page.drawRectangle({ x: pageWidth - margin - pillWidth, y: y - 4, width: pillWidth, height: 18, color: rgb(232 / 255, 248 / 255, 244 / 255) });
      drawText(bufferText, pageWidth - margin - pillWidth + 10, y + 1, 7.5, bold, success);
    }
    y -= 22;

    result.tracks.forEach((track) => {
      if (y < 150) addReportPage();
      const x = margin;
      const cardWidth = pageWidth - margin * 2;
      const cardHeight = 128;
      page.drawRectangle({ x, y: y - cardHeight, width: cardWidth, height: cardHeight, color: card, borderColor: line, borderWidth: 1 });
      drawText(track.label, x + 14, y - 19, 13, bold, navy);
      drawText(trackDurationLabel(track.events[0].date, track.events.at(-1).date), x + 14, y - 34, 7.4, regular, muted);
      const lineX = x + 18;
      const lineY = y - 58;
      const lineWidth = cardWidth - 36;
      page.drawRectangle({ x: lineX, y: lineY, width: lineWidth, height: 4, color: gold });
      page.drawRectangle({ x: lineX, y: lineY, width: Math.max(24, lineWidth * 0.36), height: 4, color: navy });
      const start = track.events[0].date;
      const end = track.events.at(-1).date;
      const span = Math.max(1, end - start);
      const lastPctByLevel = [-100, -100, -100];
      let previousVisualPct = -100;
      const positionedEvents = track.events.map((event, index) => {
        const pct = (event.date - start) / span;
        const visualPct = Math.min(0.92, Math.max(0.08, pct, previousVisualPct + 0.12));
        previousVisualPct = visualPct;
        let level = lastPctByLevel.findIndex((lastPct) => visualPct - lastPct >= 0.22);
        if (level < 0) level = index % lastPctByLevel.length;
        lastPctByLevel[level] = visualPct;
        return { event, visualPct, level };
      });
      positionedEvents.slice(0, -1).forEach(({ event, visualPct }, index) => {
        if (!event.durationAfter) return;
        const nextPct = positionedEvents[index + 1].visualPct;
        const chipX = lineX + ((visualPct + nextPct) / 2) * lineWidth;
        const chipText = event.durationAfter;
        const chipWidth = Math.max(28, bold.widthOfTextAtSize(chipText, 5.8) + 8);
        page.drawRectangle({ x: chipX - chipWidth / 2, y: lineY + 9, width: chipWidth, height: 9, color: card, borderColor: gold, borderWidth: 0.5 });
        drawText(chipText, chipX - bold.widthOfTextAtSize(chipText, 5.5) / 2, lineY + 11.7, 5.5, bold, gold);
      });
      positionedEvents.forEach(({ event, visualPct, level }) => {
        const rawDotX = lineX + visualPct * lineWidth;
        const labelWidth = 72;
        const labelX = Math.min(Math.max(rawDotX - labelWidth / 2, x + 10), x + cardWidth - labelWidth - 10);
        const labelY = lineY - 15 - level * 26;
        page.drawCircle({ x: rawDotX, y: lineY + 2, size: 4, color: navy, borderColor: gold, borderWidth: 1.5 });
        drawWrappedText(event.name, labelX, labelY, labelWidth, 5.4, bold, navy, 6.2);
        drawText(displayDate(event.date), labelX, labelY - 12, 5.2, regular, muted);
      });
      y -= cardHeight + 10;
    });
  }

  function drawPdfDisclaimer() {
    const text = "Disclaimer: This timeline is prepared for planning and discussion only. Dates are based on the assumptions entered at the time of generation and may change due to HDB, CPF Board, banks, law firms, sellers, buyers or other third-party processing timelines. Clients should verify all legal, financial, CPF and completion requirements with the appointed conveyancing lawyer and relevant authorities before making commitments.";
    if (y < 78) addReportPage();
    drawText("DISCLAIMER", margin, y, 8, bold, gold);
    y -= 12;
    y = drawWrappedText(text, margin, y, pageWidth - margin * 2, 6.2, regular, muted, 7.5);
  }

  drawPageBackground();
  page.drawRectangle({ x: 0, y: pageHeight - 88, width: pageWidth, height: 88, color: navy });
  y -= 4;
  drawText("Timeline Report", margin, y, 22, bold, rgb(1, 1, 1));
  y -= 21;
  drawText("Angie Yap | 83963088 | CEA No.: R067805D", margin, y, 8.5, regular, rgb(1, 1, 1));
  y = pageHeight - 114;

  drawText(scenarios[state.scenario].label, margin, y, 13.5, bold, navy);
  y -= 18;
  drawText(`Generated on ${displayDate(new Date())}`, margin, y, 8.2, regular, muted);
  y -= 20;

  const saleTrack = result.tracks.find((track) => track.side === "sale");
  const purchaseTrack = result.tracks.find((track) => track.side === "purchase");
  const latestPurchaseOtp = purchaseTrack ? purchaseTrack.events[0].date : null;
  const otpGapDays = saleTrack && purchaseTrack ? daysBetween(saleTrack.events[0].date, purchaseTrack.events[0].date) : null;
  const summaryTiles = [
    ["Scenario", scenarios[state.scenario].label],
    ["Sale legal completion", saleTrack ? displayDate(saleTrack.legalCompletion) : "Not selected"],
    ["Purchase legal completion", purchaseTrack ? displayDate(purchaseTrack.legalCompletion) : "Not selected"],
    ["Latest purchase OTP", latestPurchaseOtp ? displayDate(latestPurchaseOtp) : "Not selected"],
    ["Sale OTP to purchase OTP", otpGapDays !== null ? `${otpGapDays} days / ${(otpGapDays / 30.4).toFixed(1)} months` : "Not selected"],
  ];
  const tileGap = 8;
  const tileHeight = 48;
  const scenarioTileHeight = 46;
  const fullWidth = pageWidth - margin * 2;
  page.drawRectangle({ x: margin, y: y - scenarioTileHeight, width: fullWidth, height: scenarioTileHeight, color: paper, borderColor: rgb(217 / 255, 214 / 255, 205 / 255), borderWidth: 1 });
  drawText(summaryTiles[0][0], margin + 10, y - 13, 6.2, bold, muted);
  drawWrappedText(summaryTiles[0][1], margin + 10, y - 31, fullWidth - 20, 10.5, bold, navy, 11.5);
  y -= scenarioTileHeight + 7;
  const tileWidth = (fullWidth - tileGap * 3) / 4;
  summaryTiles.slice(1).forEach(([label, value], index) => {
    const x = margin + index * (tileWidth + tileGap);
    page.drawRectangle({ x, y: y - tileHeight, width: tileWidth, height: tileHeight, color: paper, borderColor: rgb(217 / 255, 214 / 255, 205 / 255), borderWidth: 1 });
    drawText(label, x + 8, y - 13, 5.8, bold, muted);
    drawWrappedText(value, x + 8, y - 31, tileWidth - 16, index === 3 ? 7.5 : 8.3, bold, navy, 9.2);
  });
  y -= tileHeight + 20;

  drawPdfInfographic();
  drawPdfItemisedCards();
  drawPdfChecklist(buildChecklist(result));
  drawPdfPlanningTiles(saleTrack, purchaseTrack, otpGapDays);

  drawPdfDisclaimer();

  document.body.dataset.pdfPageCount = String(pdf.getPageCount());
  const bytes = await pdf.save();
  document.body.dataset.pdfStatus = `generated ${bytes.length} bytes`;
  const blob = new Blob([bytes], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${scenarios[state.scenario].label.replaceAll(" ", "-").replaceAll(":", "").toLowerCase()}-timeline.pdf`;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 1000);
}

function init() {
  Object.entries(scenarios).forEach(([key, scenario]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = scenario.label;
    els.scenario.appendChild(option);
  });
  els.scenario.addEventListener("change", (event) => {
    state.scenario = event.target.value;
    render();
  });
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      render();
    });
  });
  els.skipWeekends.addEventListener("change", (event) => {
    state.skipWeekends = event.target.checked;
    render();
  });
  els.includeBuffer.addEventListener("change", (event) => {
    state.includeBuffer = event.target.checked;
    state.assumptions.cpfBufferDays = event.target.checked ? 21 : 0;
    render();
  });
  els.resetDefaults.addEventListener("click", () => {
    state.assumptions = structuredClone(defaultAssumptions);
    render();
  });
  els.downloadPdf.addEventListener("click", downloadPdf);
  render();
}

init();
window.timelineDownloadPdf = downloadPdf;
