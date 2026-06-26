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
  hdbSale: { otpExerciseDays: 21, resaleSubmissionDays: 90, hdbAcceptanceDays: 28, endorsementDays: 14, completionDays: 42, extensionMonths: 0 },
  hdbPurchase: { otpExerciseDays: 21, resaleSubmissionDays: 30, hdbAcceptanceDays: 28, endorsementDays: 14, completionDays: 42, extensionMonths: 0, renovationMonths: 0 },
  privateSale: { otpExerciseWeeks: 3, completionWeeks: 13, extensionMonths: 0 },
  privatePurchase: { otpExerciseWeeks: 3, completionWeeks: 13, extensionMonths: 0, renovationMonths: 0 },
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
  result.setMonth(result.getMonth() + Number(months));
  return result;
}

function addDuration(date, amount, unit, direction = 1) {
  const signed = Number(amount) * direction;
  if (unit === "days") return state.skipWeekends ? addBusinessDays(date, signed) : addDays(date, signed);
  if (unit === "weeks") return addDays(date, signed * 7);
  if (unit === "months") return addMonths(date, signed);
  return date;
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

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function stepsFor(trackKey) {
  const a = state.assumptions[trackKey];
  if (trackMeta[trackKey].type === "hdb") {
    return [
      { name: "Issue OTP", duration: a.otpExerciseDays, unit: "days" },
      { name: "Exercise OTP", duration: a.resaleSubmissionDays, unit: "days" },
      { name: "HDB Submission", duration: a.hdbAcceptanceDays, unit: "days" },
      { name: "Acceptance by HDB", duration: a.endorsementDays, unit: "days" },
      { name: "Endorsement", duration: a.completionDays, unit: "days" },
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
  return `${amount} ${step.unit}`;
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
    purchaseCompletionTarget = isoDate(addDays(parseDate(saleCompletionTarget), state.assumptions.cpfBufferDays));
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
    ${hasPurchase && hasSale ? `<div class="field"><span class="field-label">Purchase legal completion date</span><input type="text" value="${displayDate(addDays(parseDate(state.dates.saleCompletionDate), state.assumptions.cpfBufferDays))}" disabled /><small>${state.includeBuffer ? "Auto-filled from sale legal completion + 21-day CPF buffer." : "Auto-filled from sale legal completion with 0-day buffer."}</small></div>` : ""}
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
      return `<div class="duration-grid"><label>${label}${unit ? ` <span>${unit}</span>` : ""}</label><input data-assumption-track="${key}" data-assumption-key="${name}" type="number" min="0" step="1" value="${value}" /></div>`;
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
  const latestPurchaseOtp = purchase ? purchase.events[0].date : null;
  const otpGapDays = sale && purchase ? daysBetween(sale.events[0].date, purchase.events[0].date) : null;
  const metrics = [
    ["Scenario", scenario.label],
    ["Sale legal completion", sale ? displayDate(sale.legalCompletion) : "Not selected"],
    ["Purchase legal completion", purchase ? displayDate(purchase.legalCompletion) : "Not selected"],
    ["Latest purchase OTP", latestPurchaseOtp ? displayDate(latestPurchaseOtp) : "Not selected"],
    ["Sale OTP to purchase OTP", otpGapDays !== null ? `${otpGapDays} days / ${(otpGapDays / 30.4).toFixed(1)} months` : "Not selected"],
  ];
  els.summary.innerHTML = metrics.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join("");

  let status = "Single timeline";
  let statusClass = "";
  if (bufferDays !== null) {
    if (!state.includeBuffer) status = `${bufferDays} days between completions`;
    else if (bufferDays >= state.assumptions.cpfBufferDays) status = `CPF buffer met: ${bufferDays} days`;
    else {
      status = `CPF buffer short: ${bufferDays} days`;
      statusClass = "danger";
    }
  }
  els.bufferStatus.textContent = status;
  els.bufferStatus.className = `status-pill ${statusClass}`;

  els.comparison.innerHTML = `
    <div class="note-box"><h3>Assumptions</h3><p>Legal completion is used for CPF refund planning. Extensions and renovation are optional planning items and every duration can be overridden.</p></div>
    <div class="note-box"><h3>Weekend rule</h3><p>${state.skipWeekends ? "Day-based steps skip Saturdays and Sundays. Week and month steps are calendar based." : "Day-based steps use calendar days. Public holidays are ignored."}</p></div>
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

function renderTimeline({ scenario, tracks }) {
  els.timelineTitle.textContent = scenario.label;
  els.timelineGraphic.className = `timeline-graphic tracks-${tracks.length}`;
  els.timelineGraphic.innerHTML = tracks.map((track) => {
    const start = track.events[0].date;
    const end = track.events.at(-1).date;
    const span = Math.max(1, end - start);
    const milestones = track.events.map((event, index) => {
      const pct = ((event.date - start) / span) * 100;
      return `<div class="milestone" style="left:clamp(64px, ${pct}%, calc(100% - 64px)); --row:${index % 2}"><div class="dot"></div><strong>${event.name}</strong><span>${displayDate(event.date)}</span>${event.durationAfter ? `<em>${event.durationAfter}</em>` : ""}</div>`;
    }).join("");
    return `
      <article class="track">
        <div class="track-title"><strong>${track.label}</strong><span>${daysBetween(start, end)} calendar days</span></div>
        <div class="track-line"><div class="track-fill"></div></div>
        <div class="milestones">${milestones}</div>
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

  function drawText(text, x, textY, size = 10, font = regular, color = navy) {
    page.drawText(String(text), { x, y: textY, size, font, color });
  }

  function addReportPage() {
    page = pdf.addPage(pageSize);
    y = pageHeight - 48;
  }

  page.drawRectangle({ x: 0, y: pageHeight - 132, width: pageWidth, height: 132, color: navy });
  y -= 12;
  drawText("Timeline Report", margin, y, 28, bold, rgb(1, 1, 1));
  y -= 24;
  drawText("Angie Yap | 83963088 | CEA No.: R067805D", margin, y, 10, regular, rgb(1, 1, 1));
  y = pageHeight - 168;

  drawText(scenarios[state.scenario].label, margin, y, 16, bold, navy);
  y -= 24;
  drawText(`Generated on ${displayDate(new Date())}`, margin, y, 10, regular, muted);
  y -= 30;

  result.tracks.forEach((track) => {
    page.drawRectangle({ x: margin, y: y - 20, width: pageWidth - margin * 2, height: 30, color: paper });
    drawText(track.label, margin + 12, y - 8, 11, bold, navy);
    y -= 46;
    track.events.forEach((event) => {
      if (y < 90) addReportPage();
      page.drawCircle({ x: margin + 7, y: y + 3, size: 4, borderColor: gold, borderWidth: 1.5 });
      const eventTitle = event.durationAfter ? `${event.name} (${event.durationAfter})` : event.name;
      drawText(eventTitle, margin + 24, y, 10, bold, navy);
      drawText(displayDate(event.date), pageWidth - margin - 112, y, 10, regular, muted);
      y -= 24;
    });
    y -= 12;
  });

  if (y < 120) addReportPage();
  y -= 4;
  drawText("Assumptions", margin, y, 12, bold, navy);
  y -= 20;
  const assumptionLines = [
    `CPF refund buffer: ${state.includeBuffer ? `${state.assumptions.cpfBufferDays} days from sale legal completion` : "not enforced"}`,
    `Weekend rule: ${state.skipWeekends ? "day-based steps skip Saturdays and Sundays" : "day-based steps use calendar days"}`,
    "Public holidays ignored. Durations are editable planning assumptions.",
  ];
  const saleTrack = result.tracks.find((track) => track.side === "sale");
  const purchaseTrack = result.tracks.find((track) => track.side === "purchase");
  if (saleTrack && purchaseTrack) {
    const otpGapDays = daysBetween(saleTrack.events[0].date, purchaseTrack.events[0].date);
    assumptionLines.unshift(`Sale OTP to purchase OTP: ${otpGapDays} days / ${(otpGapDays / 30.4).toFixed(1)} months`);
  }
  assumptionLines.forEach((line) => {
    drawText(line, margin, y, 10, regular, muted);
    y -= 16;
  });

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
