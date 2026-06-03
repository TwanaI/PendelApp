// Enkel pendelapp för två fasta riktningar:
// 1) Jordbro -> Stockholm Södra
// 2) Stockholm Södra -> Jordbro
//
// Kör lokalt med: python3 -m http.server 8000
// Öppna sedan: http://localhost:8000

const SL_BASE = "https://transport.integration.sl.se/v1";

const ROUTES = [
  {
    from: "Jordbro",
    to: "Stockholm Södra",
    elementId: "jordbroToSodra",
    // Pendeltåg från Jordbro mot Stockholm Södra går norrut.
    // Slutdestination kan variera, därför finns flera möjliga matchningar.
    destinations: ["bålsta", "balsta", "kungsängen", "kungsangen", "stockholm city", "sundbyberg", "märsta", "marsta", "uppsala"],
  },
  {
    from: "Södra Station",
    to: "Jordbro",
    elementId: "sodraToJordbro",
    // Pendeltåg från Stockholm Södra mot Jordbro går söderut.
    destinations: ["nynäshamn", "nynashamn", "västerhaninge", "vasterhaninge"],
  },
];

const statusEl = document.getElementById("status");
const refreshButton = document.getElementById("refreshButton");

let sitesCache = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function normalize(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replaceAll("å", "a")
    .replaceAll("ä", "a")
    .replaceAll("ö", "o");
}

async function getSites() {
  if (sitesCache) return sitesCache;
  const response = await fetch(`${SL_BASE}/sites?expand=true`);
  if (!response.ok) throw new Error(`Kunde inte hämta stationer från SL (${response.status}).`);
  sitesCache = await response.json();
  return sitesCache;
}

async function findSiteId(stationName) {
  const sites = await getSites();
  const list = Array.isArray(sites) ? sites : (sites.sites || sites.data || []);

  const wanted = normalize(stationName);
  const exact = list.find(s => normalize(s.name) === wanted);
  const partial = list.find(s => normalize(s.name).includes(wanted));
  const site = exact || partial;

  if (!site) throw new Error(`Hittade inte stationen ${stationName}.`);
  return site.id;
}

async function getDepartures(siteId) {
  const response = await fetch(`${SL_BASE}/sites/${siteId}/departures`);
  if (!response.ok) throw new Error(`Kunde inte hämta avgångar från SL (${response.status}).`);
  const data = await response.json();
  return data.departures || [];
}

function departureText(dep) {
  return normalize([
    dep.destination,
    dep.direction,
    dep.direction_name,
    dep.display_name,
    dep.line?.designation,
    dep.line?.name,
    dep.transport?.name,
  ].filter(Boolean).join(" "));
}

function departureTime(dep) {
  return dep.expected || dep.scheduled || dep.display_time || dep.time || dep.departure_time;
}

function formatClock(value) {
  if (!value) return "?";
  if (/^\d{1,2}:\d{2}/.test(value)) return value.slice(0, 5);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function minutesUntil(value) {
  if (!value || /^\d{1,2}:\d{2}/.test(value)) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return Math.max(0, Math.round((date.getTime() - Date.now()) / 60000));
}

function isCommuterTrain(dep) {
  const text = departureText(dep);
  const mode = normalize(dep.line?.transport_mode || dep.transport_mode || dep.transport?.mode);

  return (
    text.includes("pendeltag") ||
    text.includes("commuter") ||
    mode.includes("train") ||
    mode.includes("rail")
  );
}

function matchesRoute(dep, route) {
  const text = departureText(dep);
  return route.destinations.some(dest => text.includes(normalize(dest)));
}

function compareDepartures(a, b) {
  const at = departureTime(a);
  const bt = departureTime(b);
  return String(at).localeCompare(String(bt));
}

function renderRoute(route, departures) {
  const container = document.getElementById(route.elementId);

  const filtered = departures
  .filter(isCommuterTrain)
  .filter(dep => {
    const line = normalize(dep.line?.designation || dep.line?.name || "");
    return line !== "43x";
  })
  .filter(dep => matchesRoute(dep, route))
  .sort(compareDepartures)
  .slice(0, 2);

  container.innerHTML = "";

  if (filtered.length === 0) {
    container.innerHTML = `<div class="departure">Hittade inga matchande pendeltåg just nu.</div>`;
    return;
  }

  for (const dep of filtered) {
    const timeValue = departureTime(dep);
    const minutes = minutesUntil(timeValue);
    const destination = dep.destination || dep.direction || dep.direction_name || "okänd destination";
    const line = dep.line?.designation || dep.line?.name || "Pendeltåg";

    const div = document.createElement("div");
    div.className = "departure";
    div.innerHTML = `
      <div class="time">${formatClock(timeValue)}${minutes !== null ? `<span class="badge">om ${minutes} min</span>` : ""}</div>
      <div class="meta">${line} mot ${destination}</div>
    `;
    container.appendChild(div);
  }
}

async function loadRoute(route) {
  const siteId = await findSiteId(route.from);
  const departures = await getDepartures(siteId);
  renderRoute(route, departures);
}

async function refresh() {
  try {
    setStatus("Hämtar avgångar…");
    await Promise.all(ROUTES.map(loadRoute));
    setStatus(`Uppdaterad ${new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`);
  } catch (err) {
    setStatus(err.message);
  }
}

refreshButton.addEventListener("click", refresh);
refresh();
setInterval(refresh, 30000);
