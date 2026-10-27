/* HOPTRACE Phase 6 UI -- purely a rendering layer over real, already
   generated present/path_bundle.json files. Fetches JSON, never
   computes onset/confidence/status -- only lays it out and animates
   transitions between values that are already there. */

const TRIALS = [
  {
    id: "p4-held-04-latency-hop2-moderate",
    path: "../experiments/p4-held-04-latency-hop2-moderate/path_bundle.json",
    label: "Localized",
    blurb: "A moderate latency fault injected on a mid-path hop. HOPTRACE finds a hop range and holds it with high confidence.",
  },
  {
    id: "p4-held-01-clean1",
    path: "../experiments/p4-held-01-clean1/path_bundle.json",
    label: "No degradation",
    blurb: "A clean control run, no fault injected. The frozen detector reported no localization here (one of four clean controls in the exposed set).",
  },
  {
    id: "p4-held-12-unknown-plus-impair",
    path: "../experiments/p4-held-12-unknown-plus-impair/path_bundle.json",
    label: "Partially localized",
    blurb: "Hops 1 and 2 didn't respond to enough probes and are reported as unknown. HOPTRACE gives a partial range (Hop 3–5), but the evaluation scored this trial a false attribution: the first affected hop was 2, one of the unknown hops.",
  },
];

const state = { bundle: null, trial: null };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtMs(v) {
  if (v === null || v === undefined) return "—";
  return v < 1 ? v.toFixed(3) + " ms" : v.toFixed(1) + " ms";
}

function fmtScore(v) {
  if (v === null || v === undefined) return "—";
  return v.toFixed(2);
}

/* ---------------- ambient hero path (decorative, no trial data) ---------------- */

function buildHeroPath() {
  const track = $("#hero-track");
  const html = buildTrackHTML([1, 2, 3, 4, 5].map(ttl => ({ ttl, status: "pending" })), false);
  track.innerHTML = html;
  gsap.set(track.querySelector(".path-fill"), { width: "0%" });
  gsap.set(track.querySelector(".signal-dot"), { left: "6%" });
  const tl = gsap.timeline({ delay: 0.4 });
  tl.to(track.querySelector(".signal-dot"), { left: "94%", duration: 2.4, ease: "power2.inOut" }, 0);
  tl.to(track.querySelector(".path-fill"), { width: "100%", duration: 2.4, ease: "power2.inOut" }, 0);
  tl.to(track.querySelectorAll(".hop-node"), {
    borderColor: "var(--signal)", color: "var(--signal)",
    duration: 0.3, stagger: 0.42,
  }, 0.15);
}

/* ---------------- shared 3D track builder ---------------- */

function buildTrackHTML(hops, withTags) {
  const positions = [6, 24.5, 43, 61.5, 80, 94]; // client .. hop1..5 .. server (approx even spread on 6%-94%)
  // hops has 5 entries; nodes sit between client(0) and server(last)
  const nodePositions = [16, 33.6, 51.2, 68.8, 86.4];
  let html = `<div class="path-line-3d"><div class="path-fill"></div></div>`;
  html += `<div class="endpoint client" style="left:6%"></div>`;
  html += `<div class="endpoint server" style="left:94%"></div>`;
  if (withTags) {
    html += `<div class="endpoint-tag client-tag">CLIENT</div>`;
    html += `<div class="endpoint-tag server-tag">SERVER</div>`;
  }
  hops.forEach((h, i) => {
    const left = nodePositions[i];
    html += `<div class="hop-node" data-ttl="${h.ttl}" data-status="${h.status}" style="left:${left}%" tabindex="0" role="button" aria-label="Hop ${h.ttl}">
      ${h.ttl}
      ${withTags ? `<div class="node-tag">${h.ip || ""}</div>` : ""}
    </div>`;
  });
  html += `<div class="signal-dot" style="left:6%"></div>`;
  return html;
}

/* ---------------- trial picker ---------------- */

function renderTrialGrid() {
  const grid = $("#trial-grid");
  grid.innerHTML = TRIALS.map(t => `
    <button class="trial-card" data-id="${t.id}">
      <span class="trial-state">${t.label.toUpperCase()}</span>
      <p>${t.blurb}</p>
      <span class="trial-id mono">${t.id}</span>
    </button>
  `).join("");
  $$(".trial-card", grid).forEach(card => {
    card.addEventListener("click", () => selectTrial(card.dataset.id));
  });
}

async function selectTrial(id) {
  const meta = TRIALS.find(t => t.id === id);
  if (!meta) return;
  const res = await fetch(meta.path);
  const bundle = await res.json();
  state.bundle = bundle;
  state.trial = meta;
  $$(".trial-card").forEach(c => c.classList.toggle("active", c.dataset.id === id));
  renderJourney();
  renderInspect();
  renderEvidence();
  renderFooterConfig();
}

/* ---------------- pinned journey ---------------- */

function statusAtStep(hop, step, bundle) {
  // step 0: baseline, everything pending/quiet
  // step 1: app onset only, path still pending
  // step 2: path-level reveal -- real status per hop
  // step 3: downstream persistence -- same real status, fully lit
  if (step <= 1) return "pending";
  return hop.status;
}

function renderJourney() {
  const b = state.bundle;
  const track = $("#journey-track");
  track.innerHTML = buildTrackHTML(b.hops.map(h => ({ ttl: h.ttl, status: "pending", ip: h.ip })), true);
  renderJourneyStep(0);
}

function renderJourneyStep(step) {
  const b = state.bundle;
  if (!b) return;
  const track = $("#journey-track");
  const fill = track.querySelector(".path-fill");
  const dot = track.querySelector(".signal-dot");
  const nodes = $$(".hop-node", track);

  const labels = ["01 / 04", "02 / 04", "03 / 04", "04 / 04"];
  const titles = [
    "Baseline",
    "The application feels it first",
    "Tracing back through the path",
    resultTitle(b.plain_language.result_state),
  ];
  $("#step-label").textContent = labels[step];
  $("#step-title").textContent = titles[step];

  if (step === 0) {
    $("#step-body").textContent = "Before anything goes wrong: application ping RTT and every hop's own RTT, sampled continuously on the same CLOCK_MONOTONIC clock.";
    setReadout([
      ["app baseline", fmtMs(b.app.rtt_baseline_ms)],
      ["samples", String(b.app.sample_count)],
      ["window", `${b.observation_window.duration_s?.toFixed(1) ?? "—"}s`],
    ]);
    gsap.to(fill, { width: "0%", duration: 0.5 });
    gsap.to(dot, { left: "6%", duration: 0.5 });
    nodes.forEach(n => n.dataset.status = "pending");
  }

  if (step === 1) {
    $("#step-body").textContent = b.app.onset_ns
      ? `Application ping RTT rises from ${fmtMs(b.app.rtt_baseline_ms)} baseline to ${fmtMs(b.app.rtt_observed_ms)}. That's the only signal so far — the path hasn't been checked yet.`
      : "No application-level onset was detected in this trial — the client never saw a reliable RTT shift.";
    setReadout([
      ["app baseline", fmtMs(b.app.rtt_baseline_ms)],
      ["app observed", fmtMs(b.app.rtt_observed_ms)],
    ]);
    gsap.to(fill, { width: "6%", duration: 0.5 });
    gsap.to(dot, { left: "6%", duration: 0.6, ease: "power2.out" });
    nodes.forEach(n => n.dataset.status = "pending");
  }

  if (step === 2) {
    $("#step-body").textContent = "Walking hop by hop: does this hop's own RTT show the same kind of onset, at a plausible time?";
    const firstDeg = b.hops.find(h => h.status === "degraded");
    setReadout([
      ["hop range", b.hop_range ? `Hop ${b.hop_range.min}–${b.hop_range.max}` : "none found"],
      ["confidence", b.confidence.level],
    ]);
    const targetPct = firstDeg ? nodePercentForTtl(firstDeg.ttl) : 94;
    gsap.to(fill, { width: `${targetPct}%`, duration: 0.9, ease: "power2.inOut" });
    gsap.to(dot, { left: `${targetPct}%`, duration: 0.9, ease: "power2.inOut" });
    nodes.forEach(n => {
      const h = b.hops.find(x => String(x.ttl) === n.dataset.ttl);
      n.dataset.status = h.status;
    });
  }

  if (step === 3) {
    $("#step-body").textContent = b.plain_language.summary;
    setReadout([
      ["result", b.plain_language.result_state.replace(/_/g, " ")],
      ["alignment", `${b.alignment_delta_ms ?? "—"} ms`],
      ["confidence", `${b.confidence.level} (${fmtScore(b.confidence.score)})`],
    ]);
    gsap.to(fill, { width: "94%", duration: 0.8, ease: "power2.inOut" });
    gsap.to(dot, { left: "94%", duration: 0.8, ease: "power2.inOut" });
    nodes.forEach(n => {
      const h = b.hops.find(x => String(x.ttl) === n.dataset.ttl);
      n.dataset.status = h.status;
    });
  }
}

function resultTitle(state) {
  return {
    localized: "Localized",
    partially_localized: "Partially localized",
    not_localized: "Not localized",
    no_degradation: "No degradation",
  }[state] || state;
}

function nodePercentForTtl(ttl) {
  const map = { 1: 16, 2: 33.6, 3: 51.2, 4: 68.8, 5: 86.4 };
  return map[ttl] ?? 50;
}

function setReadout(pairs) {
  $("#step-readout").innerHTML = pairs.map(([k, v]) => `
    <div class="rv"><span class="k">${k}</span><span class="v mono">${v}</span></div>
  `).join("");
}

/* ---------------- hop inspection ---------------- */

function renderInspect() {
  const b = state.bundle;
  const strip = $("#hop-strip");
  strip.innerHTML = b.hops.map(h => `
    <button class="hop-tile" data-ttl="${h.ttl}" data-status="${h.status}">
      <div class="hop-tile-top">
        <span class="hop-num mono">HOP ${h.ttl}</span>
        <span class="hop-dot"></span>
      </div>
      <div class="hop-ip">${h.ip || "no response"}</div>
      <div class="hop-rtt">${fmtMs(h.rtt_baseline_ms)} → ${fmtMs(h.rtt_observed_ms)}</div>
    </button>
  `).join("") + `<div class="hop-detail" id="hop-detail"></div>`;

  $$(".hop-tile", strip).forEach(tile => {
    tile.addEventListener("click", () => {
      const ttl = Number(tile.dataset.ttl);
      const isOpen = tile.classList.contains("expanded");
      $$(".hop-tile", strip).forEach(t => t.classList.remove("expanded"));
      const detail = $("#hop-detail");
      if (isOpen) { detail.classList.remove("open"); return; }
      tile.classList.add("expanded");
      const h = b.hops.find(x => x.ttl === ttl);
      detail.innerHTML = `
        <strong>Hop ${h.ttl}${h.ip ? " — " + h.ip : ""}</strong>
        <ul>
          ${h.why_highlighted.map(t => `<li>${t}</li>`).join("")}
          <li class="mono">samples observed: ${h.sample_count}${h.onset_ns ? ` · onset at t=${h.onset_ns} ns` : ""}</li>
        </ul>`;
      detail.classList.add("open");
    });
  });
}

/* ---------------- evidence / confidence ---------------- */

function renderEvidence() {
  const b = state.bundle;
  $("#confidence-strip").innerHTML = `
    <div class="confidence-metric"><div class="k">CONFIDENCE LEVEL</div><div class="v">${b.confidence.level}</div></div>
    <div class="confidence-metric"><div class="k">SCORE</div><div class="v">${fmtScore(b.confidence.score)}</div></div>
    <div class="confidence-metric"><div class="k">ALIGNMENT δ</div><div class="v">${b.alignment_delta_ms ?? "—"} ms</div></div>
    <div class="confidence-metric"><div class="k">UNKNOWN HOPS</div><div class="v">${b.unknown_hops.length ? b.unknown_hops.join(", ") : "none"}</div></div>
  `;
  $("#claims-list").innerHTML = (b.evidence_record_claims || []).map(c => `
    <div class="claim-row" data-tag="${c.tag}">
      <span class="claim-tag">${c.tag}</span>
      <span>${claimText(c)}</span>
    </div>
  `).join("");
}

function claimText(c) {
  // the confidence claim carries level/score/factors instead of a
  // prose "text" field -- every other tag has text directly.
  if (c.tag === "confidence") {
    return `Confidence: ${c.level} (score ${fmtScore(c.score)}). ${c.factors?.note || c.factors?.reason || ""}`;
  }
  return c.text ?? "";
}

/* ---------------- evaluation (static, system-wide, real) ---------------- */

function renderEvaluation() {
  fetch(TRIALS[0].path).then(r => r.json()).then(b => {
    const ev = b.evaluation;
    if (!ev || !ev.summary) return;
    const s = ev.summary;
    const stats = [
      ["within 1 hop", s.within_1_hop_accuracy.rate, s.within_1_hop_accuracy.ci95],
      ["false attribution", s.false_attribution_rate.rate, s.false_attribution_rate.ci95],
      ["clean-control FP", s.clean_control_false_positive_rate.rate, s.clean_control_false_positive_rate.ci95],
      ["recall", s.detection_recall.rate, null],
    ];
    $("#eval-grid").innerHTML = stats.map(([label, rate, ci]) => `
      <div class="eval-stat">
        <div class="stat-val">${(rate * 100).toFixed(0)}%</div>
        <div class="stat-label">${label}</div>
        ${ci ? `<div class="stat-ci mono">95% CI ${(ci[0]*100).toFixed(0)}–${(ci[1]*100).toFixed(0)}%</div>` : ""}
      </div>
    `).join("");
    const brier = ev.brier_score?.brier;
    const brierText = brier != null ? brier.toFixed(3) : "—";
    $("#gate-badge").textContent = ev.gate_check?.overall_pass
      ? `Numeric thresholds met on an exposed set (n=${s.n_trials} trials, Brier ${brierText}) — not an independent validation`
      : `Numeric thresholds not met on an exposed set (n=${s.n_trials} trials, Brier ${brierText})`;
  });
}

function renderFooterConfig() {
  const ev = state.bundle?.evaluation;
  if (!ev) return;
  $("#cfg-algo").textContent = ev.algorithm || "—";
  $("#cfg-commit").textContent = ev.git_commit || "—";
}

/* ---------------- scroll wiring ---------------- */

function wireScroll() {
  gsap.registerPlugin(ScrollTrigger);

  ScrollTrigger.create({
    trigger: "#journey",
    start: "top top",
    end: "bottom bottom",
    pin: "#journey-pin",
    pinSpacing: false,
  });

  $$(".journey-step").forEach((el, i) => {
    ScrollTrigger.create({
      trigger: el,
      start: "top center",
      end: "bottom center",
      onEnter: () => renderJourneyStep(i),
      onEnterBack: () => renderJourneyStep(i),
    });
  });

  ScrollTrigger.create({
    trigger: "#pick",
    start: "top bottom",
    end: "bottom top",
    onToggle: self => document.getElementById("journey-rail").classList.toggle("visible", self.isActive || self.progress > 0),
  });

  ScrollTrigger.create({
    trigger: "body",
    start: "top top",
    end: "bottom bottom",
    onUpdate: self => {
      const rail = document.getElementById("journey-rail");
      if (self.progress > 0.06 && self.progress < 0.97) {
        rail.classList.add("visible");
        $("#rail-fill").style.height = `${self.progress * 100}%`;
      } else {
        rail.classList.remove("visible");
      }
    },
  });
}

/* ---------------- cursor-reactive depth on the pinned stage ---------------- */

function wireCursorDepth() {
  const stage = $("#journey");
  if (!stage) return;
  stage.addEventListener("mousemove", e => {
    const track = $("#journey-track");
    if (!track) return;
    const rect = stage.getBoundingClientRect();
    const rx = (e.clientY - rect.top - rect.height / 2) / rect.height;
    const ry = (e.clientX - rect.left - rect.width / 2) / rect.width;
    gsap.to(track, { rotateX: rx * 4, rotateY: ry * -4, duration: 0.6, ease: "power2.out" });
  });
  stage.addEventListener("mouseleave", () => {
    gsap.to($("#journey-track"), { rotateX: 0, rotateY: 0, duration: 0.6 });
  });
}

/* ---------------- boot ---------------- */

document.addEventListener("DOMContentLoaded", async () => {
  buildHeroPath();
  renderTrialGrid();
  await selectTrial(TRIALS[0].id);
  $$(".trial-card")[0].classList.add("active");
  renderEvaluation();
  wireScroll();
  wireCursorDepth();
});
