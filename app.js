const STORAGE_KEY = "my-usual-data-v1";

const seedData = [
  {
    id: crypto.randomUUID(),
    name: "Din Tai Fung",
    category: "Asian",
    location: "Valley Fair",
    favorite: true,
    items: [
      { id: crypto.randomUUID(), name: "Pork Xiao Long Bao", notes: "" },
      { id: crypto.randomUUID(), name: "Cucumber Salad", notes: "" },
      { id: crypto.randomUUID(), name: "Braised Beef Noodle Soup", notes: "" }
    ]
  },
  {
    id: crypto.randomUUID(),
    name: "Panda Express",
    category: "Asian",
    location: "",
    favorite: true,
    items: [
      { id: crypto.randomUUID(), name: "Plate with Chow Mein + Orange Chicken", notes: "Second entree: Broccoli Beef" }
    ]
  },
  {
    id: crypto.randomUUID(),
    name: "Starbucks",
    category: "Coffee",
    location: "",
    favorite: false,
    items: [
      { id: crypto.randomUUID(), name: "Caramel Macchiato", notes: "Grande, hot" }
    ]
  }
];

let data = loadData();
let selectedCategory = "All";
let selectedRestaurantId = null;
let editMode = false;
let editingRestaurantId = null;
let editingItemId = null;

const $ = (id) => document.getElementById(id);

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch (_) {}
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seedData));
  return seedData;
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  render();
  if (selectedRestaurantId) renderRestaurantSheet();
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1700);
}

function getCategories() {
  return ["All", ...new Set(data.map(r => r.category).filter(Boolean))];
}

function matchesSearch(restaurant, query) {
  if (!query) return true;
  const haystack = [
    restaurant.name,
    restaurant.category,
    restaurant.location,
    ...restaurant.items.flatMap(i => [i.name, i.notes])
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function render() {
  const query = $("searchInput").value.trim();

  $("categoryChips").innerHTML = getCategories().map(category => `
    <button class="chip ${category === selectedCategory ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
  `).join("");

  const filtered = data.filter(r =>
    (selectedCategory === "All" || r.category === selectedCategory) &&
    matchesSearch(r, query)
  );

  const favorites = filtered.filter(r => r.favorite);
  $("favoritesList").innerHTML = favorites.length
    ? favorites.map(restaurantCard).join("")
    : `<div class="empty">No favorites match your search.</div>`;

  $("restaurantList").innerHTML = filtered.length
    ? filtered.map(restaurantCard).join("")
    : `<div class="empty">No restaurants found.</div>`;

  $("addRestaurantBtn").classList.toggle("hidden", !editMode);
  $("editModeBtn").textContent = editMode ? "✓" : "✏️";
}

function restaurantCard(r) {
  return `
    <button class="restaurant-card" data-restaurant-id="${r.id}">
      <div class="row">
        <div>
          <strong>${escapeHtml(r.name)}</strong>
          <div class="meta">${escapeHtml(r.category)}${r.location ? ` · ${escapeHtml(r.location)}` : ""}</div>
        </div>
        <span>${r.favorite ? "⭐" : "›"}</span>
      </div>
      <div class="count">${r.items.length} saved order${r.items.length === 1 ? "" : "s"}</div>
    </button>
  `;
}

function openRestaurant(id) {
  selectedRestaurantId = id;
  renderRestaurantSheet();
  $("restaurantDialog").showModal();
}

function renderRestaurantSheet() {
  const r = data.find(x => x.id === selectedRestaurantId);
  if (!r) return;

  $("restaurantName").textContent = r.name;
  $("restaurantCategory").textContent = [r.category, r.location].filter(Boolean).join(" · ");
  $("favoriteBtn").textContent = r.favorite ? "⭐" : "♡";
  $("addItemBtn").classList.toggle("hidden", !editMode);

  $("orderList").innerHTML = r.items.length ? r.items.map(item => `
    <div class="order-card">
      <div class="order-title">${escapeHtml(item.name)}</div>
      ${item.notes ? `<div class="order-notes">${escapeHtml(item.notes)}</div>` : `<div class="order-notes">No customizations saved.</div>`}
      <div class="order-actions">
        <button class="copy-btn" data-copy-item="${item.id}">📋 Copy order</button>
        ${editMode ? `
          <button class="small-btn" data-edit-item="${item.id}">Edit</button>
          <button class="small-btn" data-delete-item="${item.id}">Delete</button>
        ` : ""}
      </div>
    </div>
  `).join("") : `<div class="empty">No saved orders yet.</div>`;

  if (editMode) {
    $("orderList").insertAdjacentHTML("beforeend", `
      <button class="secondary-btn" id="editRestaurantInside">Edit restaurant</button>
    `);
  }
}

async function copyOrder(item) {
  const r = data.find(x => x.id === selectedRestaurantId);
  if (!r) return;
  const text = `${r.name} — ${item.name}${item.notes ? ` — ${item.notes}` : ""}`;
  await navigator.clipboard.writeText(text);
  showToast("Copied! Paste it into your text.");
}

function pickForMe() {
  const r = data.find(x => x.id === selectedRestaurantId);
  if (!r || !r.items.length) {
    showToast("No saved orders yet.");
    return;
  }
  const item = r.items[Math.floor(Math.random() * r.items.length)];
  showToast(`Try: ${item.name}`);
}

function openRestaurantForm(id = null) {
  editingRestaurantId = id;
  const r = id ? data.find(x => x.id === id) : null;
  $("restaurantFormTitle").textContent = r ? "Edit restaurant" : "Add restaurant";
  $("restaurantNameInput").value = r?.name ?? "";
  $("restaurantCategoryInput").value = r?.category ?? "";
  $("restaurantLocationInput").value = r?.location ?? "";
  $("restaurantFavoriteInput").checked = r?.favorite ?? false;
  $("editRestaurantDialog").showModal();
}

function openItemForm(id = null) {
  editingItemId = id;
  const r = data.find(x => x.id === selectedRestaurantId);
  const item = id ? r?.items.find(x => x.id === id) : null;
  $("itemFormTitle").textContent = item ? "Edit order" : "Add order";
  $("itemNameInput").value = item?.name ?? "";
  $("itemNotesInput").value = item?.notes ?? "";
  $("editItemDialog").showModal();
}

$("searchInput").addEventListener("input", render);

$("categoryChips").addEventListener("click", e => {
  const btn = e.target.closest("[data-category]");
  if (!btn) return;
  selectedCategory = btn.dataset.category;
  render();
});

document.addEventListener("click", e => {
  const card = e.target.closest("[data-restaurant-id]");
  if (card) openRestaurant(card.dataset.restaurantId);

  const copyBtn = e.target.closest("[data-copy-item]");
  if (copyBtn) {
    const r = data.find(x => x.id === selectedRestaurantId);
    const item = r?.items.find(x => x.id === copyBtn.dataset.copyItem);
    if (item) copyOrder(item);
  }

  const editItem = e.target.closest("[data-edit-item]");
  if (editItem) openItemForm(editItem.dataset.editItem);

  const deleteItem = e.target.closest("[data-delete-item]");
  if (deleteItem) {
    const r = data.find(x => x.id === selectedRestaurantId);
    if (!r) return;
    r.items = r.items.filter(x => x.id !== deleteItem.dataset.deleteItem);
    saveData();
  }

  if (e.target.id === "editRestaurantInside") openRestaurantForm(selectedRestaurantId);
});

$("editModeBtn").addEventListener("click", () => {
  editMode = !editMode;
  render();
  if (selectedRestaurantId) renderRestaurantSheet();
  showToast(editMode ? "Edit mode on" : "Edit mode off");
});

$("addRestaurantBtn").addEventListener("click", () => openRestaurantForm());
$("addItemBtn").addEventListener("click", () => openItemForm());
$("closeRestaurantBtn").addEventListener("click", () => $("restaurantDialog").close());
$("pickForMeBtn").addEventListener("click", pickForMe);

$("favoriteBtn").addEventListener("click", () => {
  const r = data.find(x => x.id === selectedRestaurantId);
  if (!r) return;
  r.favorite = !r.favorite;
  saveData();
});

$("restaurantForm").addEventListener("submit", e => {
  e.preventDefault();
  const payload = {
    name: $("restaurantNameInput").value.trim(),
    category: $("restaurantCategoryInput").value.trim(),
    location: $("restaurantLocationInput").value.trim(),
    favorite: $("restaurantFavoriteInput").checked
  };
  if (!payload.name || !payload.category) return;

  if (editingRestaurantId) {
    const r = data.find(x => x.id === editingRestaurantId);
    Object.assign(r, payload);
  } else {
    data.push({ id: crypto.randomUUID(), ...payload, items: [] });
  }
  $("editRestaurantDialog").close();
  saveData();
});

$("itemForm").addEventListener("submit", e => {
  e.preventDefault();
  const r = data.find(x => x.id === selectedRestaurantId);
  if (!r) return;
  const payload = {
    name: $("itemNameInput").value.trim(),
    notes: $("itemNotesInput").value.trim()
  };
  if (!payload.name) return;

  if (editingItemId) {
    Object.assign(r.items.find(x => x.id === editingItemId), payload);
  } else {
    r.items.push({ id: crypto.randomUUID(), ...payload });
  }
  $("editItemDialog").close();
  saveData();
});

$("cancelRestaurantForm").addEventListener("click", () => $("editRestaurantDialog").close());
$("cancelItemForm").addEventListener("click", () => $("editItemDialog").close());

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[c]);
}

render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}
