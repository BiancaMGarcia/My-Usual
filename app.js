const SUPABASE_URL = "https://ntjrvvruniofgcduhgyk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_pCnl_RWebLHeQg6wDkZvyg_jWbjabxH";
const LEGACY_STORAGE_KEY = "my-usual-data-v1";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

let data = [];
let selectedCategory = "All";
let selectedRestaurantId = null;
let editMode = false;
let editingRestaurantId = null;
let editingItemId = null;
let currentUser = null;
let isAdmin = false;
let onboardingStep = 1;
let authMode = "signup";
let discoveredRestaurants = [];
let selectedDiscoveredRestaurant = null;
const $ = id => document.getElementById(id);

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function setLoading(on) {
  document.body.classList.toggle("loading", on);
}

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;

  if (currentUser) {
    await ensureProfile();
    await loadData();
    render();
    await maybeStartOnboarding();
  } else {
    data = [];
    render();
    setTimeout(() => openAuthDialog("signup"), 250);
  }
}

async function refreshAdminStatus() {
  isAdmin = !!currentUser;
}

async function loadData() {
  setLoading(true);
  const { data: restaurants, error: rError } = await sb.from("restaurants")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const { data: orders, error: oError } = await sb.from("orders")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (rError || oError) {
    console.error(rError || oError);
    showToast("Couldn't load shared data.");
    setLoading(false);
    return;
  }

  data = (restaurants || []).map(r => ({
    ...r,
    items: (orders || []).filter(o => o.restaurant_id === r.id).map(o => ({
      id: o.id,
      name: o.name,
      notes: o.notes || "",
      sort_order: o.sort_order || 0
    }))
  }));
  setLoading(false);
}

function getCategories() {
  return ["All", ...new Set(data.map(r => r.category).filter(Boolean))];
}

function matchesSearch(r, query) {
  if (!query) return true;
  const haystack = [r.name, r.category, r.location, ...r.items.flatMap(i => [i.name, i.notes])]
    .join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function render() {
  const query = $("searchInput").value.trim();
  $("categoryChips").innerHTML = getCategories().map(category => `
    <button class="chip ${category === selectedCategory ? "active" : ""}" data-category="${escapeHtml(category)}">
      ${escapeHtml(category)}
    </button>`).join("");

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
    : `<div class="empty">${data.length ? "No restaurants found." : "No restaurants saved yet."}</div>`;

  $("addRestaurantBtn").classList.toggle("hidden", !currentUser);
  $("editModeBtn").textContent = currentUser ? "👤" : "🔐";
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
    </button>`;
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
  $("favoriteBtn").disabled = !currentUser;
  $("favoriteBtn").style.opacity = (!currentUser) ? ".45" : "1";
  $("addItemBtn").classList.toggle("hidden", !currentUser);

  $("orderList").innerHTML = r.items.length ? r.items.map(item => `
    <div class="order-card">
      <div class="order-title">${escapeHtml(item.name)}</div>
      <div class="order-notes">${item.notes ? escapeHtml(item.notes) : "No customizations saved."}</div>
      <div class="order-actions">
        <button class="copy-btn" data-copy-item="${item.id}">📋 Copy order</button>
        ${editMode && isAdmin ? `
          <button class="small-btn" data-edit-item="${item.id}">Edit</button>
          <button class="small-btn" data-delete-item="${item.id}">Delete</button>` : ""}
      </div>
    </div>`).join("") : `<div class="empty">No saved orders yet.</div>`;

  if (editMode && isAdmin) {
    $("orderList").insertAdjacentHTML("beforeend",
      `<button class="secondary-btn" id="editRestaurantInside">Edit restaurant</button>`);
  }
}

async function copyOrder(item) {
  const r = data.find(x => x.id === selectedRestaurantId);
  if (!r) return;
  const text = `${r.name} — ${item.name}${item.notes ? ` — ${item.notes}` : ""}`;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
  }
  showToast("Copied! Paste it into your text.");
}

function pickForMe() {
  const r = data.find(x => x.id === selectedRestaurantId);
  if (!r || !r.items.length) return showToast("No saved orders yet.");
  const item = r.items[Math.floor(Math.random() * r.items.length)];
  showToast(`Try: ${item.name}`);
}

function openRestaurantForm(id = null) {
  if (!currentUser) return;
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
  if (!currentUser) return;
  editingItemId = id;
  const r = data.find(x => x.id === selectedRestaurantId);
  const item = id ? r?.items.find(x => x.id === id) : null;
  $("itemFormTitle").textContent = item ? "Edit order" : "Add order";
  $("itemNameInput").value = item?.name ?? "";
  $("itemNotesInput").value = item?.notes ?? "";
  $("editItemDialog").showModal();
}


function openDiscover(){
  $("discoverStatus").textContent="";
  $("discoverResults").innerHTML="";
  $("restaurantSearchInput").value="";
  $("discoverDialog").showModal();
  setTimeout(()=>$("restaurantSearchInput").focus(),100);
}
async function searchRestaurants(){
  const query=$("restaurantSearchInput").value.trim();
  if(!query){$("discoverStatus").textContent="Enter a restaurant name and city.";return;}
  $("restaurantSearchBtn").disabled=true;$("restaurantSearchBtn").textContent="Searching…";$("discoverStatus").textContent="Searching restaurants…";$("discoverResults").innerHTML="";
  try{
    const response=await fetch(`${SUPABASE_URL}/functions/v1/search-restaurants`,{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":`Bearer ${SUPABASE_PUBLISHABLE_KEY}`},body:JSON.stringify({query})});
    const result=await response.json();
    if(!response.ok){console.error(result);$("discoverStatus").textContent="Restaurant search failed. Try again.";return;}
    discoveredRestaurants=result.restaurants||[];
    $("discoverStatus").textContent=discoveredRestaurants.length?`${discoveredRestaurants.length} result${discoveredRestaurants.length===1?"":"s"} found`:"No restaurants found. Try including the city.";
    $("discoverResults").innerHTML=discoveredRestaurants.map((r,index)=>`<button class="discover-result" data-discovered-index="${index}"><strong>${escapeHtml(r.name)}</strong><div class="meta">${escapeHtml(r.type||"Restaurant")}</div><div class="meta">${escapeHtml(r.address||"")}</div></button>`).join("");
  }catch(error){console.error(error);$("discoverStatus").textContent="Couldn't reach restaurant search.";}finally{$("restaurantSearchBtn").disabled=false;$("restaurantSearchBtn").textContent="Search";}
}
function openDiscoveredRestaurant(index){
  selectedDiscoveredRestaurant=discoveredRestaurants[index]; const r=selectedDiscoveredRestaurant; if(!r)return;
  $("discoveredName").textContent=r.name||"Restaurant";$("discoveredType").textContent=r.type||"Restaurant";$("discoveredAddress").textContent=r.address||"";
  const menu=$("viewMenuBtn"); if(r.website){menu.href=r.website;menu.classList.remove("hidden");}else{menu.classList.add("hidden");}
  const maps=$("viewMapsBtn"); if(r.googleMapsUrl){maps.href=r.googleMapsUrl;maps.classList.remove("hidden");}else{maps.classList.add("hidden");}
  const existing=data.find(x=>x.name.toLowerCase()===(r.name||"").toLowerCase());
  $("saveDiscoveredRestaurantBtn").textContent=existing?"✓ Already in My Usual":"＋ Save to My Usual";$("saveDiscoveredRestaurantBtn").disabled=!!existing;
  $("discoverDialog").close();$("discoveredRestaurantDialog").showModal();
}
function extractLocationFromAddress(address=""){const parts=address.split(",").map(x=>x.trim()).filter(Boolean);return parts.length>=3?parts[parts.length-3]:"";}
async function saveDiscoveredRestaurant(){
  if(!selectedDiscoveredRestaurant)return;
  if(!currentUser||!isAdmin){$("discoveredRestaurantDialog").close();$("loginError").classList.add("hidden");$("loginDialog").showModal();showToast("Sign in to save restaurants.");return;}
  const r=selectedDiscoveredRestaurant; const payload={name:r.name,category:r.type||"Restaurant",location:extractLocationFromAddress(r.address)||null,favorite:false};
  const {error}=await sb.from("restaurants").insert(payload); if(error){console.error(error);showToast("Couldn't save restaurant.");return;}
  await loadData();render();$("saveDiscoveredRestaurantBtn").textContent="✓ Saved to My Usual";$("saveDiscoveredRestaurantBtn").disabled=true;showToast("Restaurant saved");
}

$("searchInput").addEventListener("input", render);

$("categoryChips").addEventListener("click", e => {
  const btn = e.target.closest("[data-category]");
  if (!btn) return;
  selectedCategory = btn.dataset.category;
  render();
});

document.addEventListener("click", async e => {
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
  if (deleteItem && currentUser) {
    if (!confirm("Delete this saved order?")) return;
    const { error } = await sb.from("orders").delete().eq("id", deleteItem.dataset.deleteItem);
    if (error) return showToast("Couldn't delete order.");
    await loadData();
    render();
    renderRestaurantSheet();
    showToast("Order deleted");
  }

  if (e.target.id === "editRestaurantInside") openRestaurantForm(selectedRestaurantId);
});

$("editModeBtn").addEventListener("click", async () => {
  if (!currentUser) {
    $("loginError").classList.add("hidden");
    $("loginDialog").showModal();
    return;
  }

  if (!isAdmin) return showToast("This account is not an admin.");

  if (editMode) {
    editMode = false;
    render();
    if (selectedRestaurantId) renderRestaurantSheet();
    showToast("Edit mode off");
  } else {
    $("adminEmailLabel").textContent = currentUser.email || "Signed in";
    $("adminDialog").showModal();
  }
});

$("addRestaurantBtn").addEventListener("click", () => openRestaurantForm());
$("addItemBtn").addEventListener("click", () => openItemForm());
$("closeRestaurantBtn").addEventListener("click", () => $("restaurantDialog").close());
$("pickForMeBtn").addEventListener("click", pickForMe);

$("favoriteBtn").addEventListener("click", async () => {
  if (!currentUser) return;
  const r = data.find(x => x.id === selectedRestaurantId);
  if (!r) return;
  const { error } = await sb.from("restaurants").update({ favorite: !r.favorite }).eq("id", r.id);
  if (error) return showToast("Couldn't update favorite.");
  await loadData();
  render();
  renderRestaurantSheet();
});

$("restaurantForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser) return;

  const payload = {
    name: $("restaurantNameInput").value.trim(),
    category: $("restaurantCategoryInput").value.trim(),
    location: $("restaurantLocationInput").value.trim() || null,
    favorite: $("restaurantFavoriteInput").checked,
    user_id: currentUser.id
  };

  let error;
  if (editingRestaurantId) {
    ({ error } = await sb.from("restaurants").update(payload).eq("id", editingRestaurantId));
  } else {
    ({ error } = await sb.from("restaurants").insert(payload));
  }

  if (error) return showToast("Couldn't save restaurant.");
  $("editRestaurantDialog").close();
  await loadData();
  render();
  if (selectedRestaurantId) renderRestaurantSheet();
  showToast("Restaurant saved");
});

$("itemForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser) return;

  const name = $("itemNameInput").value.trim();
  const notes = $("itemNotesInput").value.trim() || null;

  let error;
  if (editingItemId) {
    ({ error } = await sb.from("orders").update({ name, notes }).eq("id", editingItemId));
  } else {
    ({ error } = await sb.from("orders").insert({
      restaurant_id: selectedRestaurantId,
      name,
      notes
    }));
  }

  if (error) return showToast("Couldn't save order.");
  $("editItemDialog").close();
  await loadData();
  render();
  renderRestaurantSheet();
  showToast("Order saved");
});

$("cancelRestaurantForm").addEventListener("click", () => $("editRestaurantDialog").close());
$("cancelItemForm").addEventListener("click", () => $("editItemDialog").close());

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const errorBox = $("loginError");
  errorBox.classList.add("hidden");
  errorBox.textContent = "";

  const { data: authData, error } = await sb.auth.signInWithPassword({
    email: $("loginEmail").value.trim(),
    password: $("loginPassword").value
  });

  if (error) {
    errorBox.textContent = "That email or password didn't work.";
    errorBox.classList.remove("hidden");
    return;
  }

  currentUser = authData.user;
  await refreshAdminStatus();

  if (!isAdmin) {
    await sb.auth.signOut();
    currentUser = null;
    errorBox.textContent = "This account does not have admin access.";
    errorBox.classList.remove("hidden");
    return;
  }

  $("loginDialog").close();
  $("loginPassword").value = "";
  editMode = true;
  render();
  if (selectedRestaurantId) renderRestaurantSheet();
  showToast("Admin edit mode on");
});

$("cancelLoginBtn").addEventListener("click", () => $("loginDialog").close());

$("closeAdminBtn").addEventListener("click", () => {
  $("adminDialog").close();
  editMode = true;
  render();
  if (selectedRestaurantId) renderRestaurantSheet();
  showToast("Edit mode on");
});

$("signOutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
  currentUser = null;
  isAdmin = false;
  editMode = false;
  $("adminDialog").close();
  render();
  if (selectedRestaurantId) renderRestaurantSheet();
  showToast("Signed out");
});

$("importV1Btn").addEventListener("click", async () => {
  if (!currentUser) return;

  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return showToast("No V1 data found on this device.");

  let oldData;
  try { oldData = JSON.parse(raw); }
  catch { return showToast("Couldn't read V1 data."); }

  if (!Array.isArray(oldData) || !oldData.length) return showToast("No V1 restaurants to import.");
  if (!confirm(`Import ${oldData.length} V1 restaurant(s) into Supabase?`)) return;

  setLoading(true);

  for (const r of oldData) {
    const { data: inserted, error: rError } = await sb.from("restaurants").insert({
      name: r.name,
      category: r.category || "Other",
      location: r.location || null,
      favorite: !!r.favorite
    }).select("id").single();

    if (rError || !inserted) continue;

    const items = (r.items || []).map(i => ({
      restaurant_id: inserted.id,
      name: i.name,
      notes: i.notes || null
    }));

    if (items.length) await sb.from("orders").insert(items);
  }

  setLoading(false);
  await loadData();
  render();
  $("adminDialog").close();
  showToast("V1 data imported");
});

sb.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user ?? null;
  await refreshAdminStatus();
  render();
});


$("openDiscoverBtn").addEventListener("click",openDiscover);
$("closeDiscoverBtn").addEventListener("click",()=>$("discoverDialog").close());
$("closeDiscoveredRestaurantBtn").addEventListener("click",()=>{$("discoveredRestaurantDialog").close();$("discoverDialog").showModal();});
$("restaurantSearchBtn").addEventListener("click",searchRestaurants);
$("restaurantSearchInput").addEventListener("keydown",e=>{if(e.key==="Enter")searchRestaurants();});
$("discoverResults").addEventListener("click",e=>{const btn=e.target.closest("[data-discovered-index]");if(btn)openDiscoveredRestaurant(Number(btn.dataset.discoveredIndex));});
$("saveDiscoveredRestaurantBtn").addEventListener("click",saveDiscoveredRestaurant);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[c]);
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}


async function ensureProfile() {
  if (!currentUser) return;

  const { data: existing } = await sb
    .from("profiles")
    .select("*")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (!existing) {
    await sb.from("profiles").insert({
      user_id: currentUser.id,
      display_name: currentUser.user_metadata?.display_name || currentUser.email?.split("@")[0] || "User",
      onboarding_complete: false
    });
  }
}

async function maybeStartOnboarding() {
  if (!currentUser) return;

  const { data: profile } = await sb
    .from("profiles")
    .select("onboarding_complete")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (!profile?.onboarding_complete) {
    await loadTasteProfileIntoForm();
    startOnboarding();
  }
}

function openAuthDialog(mode = "signup") {
  authMode = mode;
  $("authError").classList.add("hidden");
  $("authError").textContent = "";

  const signup = mode === "signup";
  $("authTitle").textContent = signup ? "Welcome to My Usual" : "Welcome back";
  $("displayNameLabel").classList.toggle("hidden", !signup);
  $("authSubmitBtn").textContent = signup ? "Create account" : "Sign in";
  $("authSwitchBtn").textContent = signup
    ? "Already have an account? Sign in"
    : "New here? Create an account";

  if (!$("authDialog").open) $("authDialog").showModal();
}

function startOnboarding() {
  onboardingStep = 1;
  renderOnboardingStep();
  if (!$("onboardingDialog").open) $("onboardingDialog").showModal();
}

function renderOnboardingStep() {
  document.querySelectorAll(".onboarding-step").forEach(el => {
    el.classList.toggle("hidden", Number(el.dataset.step) !== onboardingStep);
  });

  $("onboardingStepLabel").textContent = `Step ${onboardingStep} of 4`;
  $("onboardingProgressBar").style.width = `${onboardingStep * 25}%`;
  $("onboardingBackBtn").classList.toggle("hidden", onboardingStep === 1);
  $("onboardingNextBtn").textContent = onboardingStep === 4 ? "Finish" : "Next";
}

async function loadTasteProfileIntoForm() {
  if (!currentUser) return;

  const { data: taste } = await sb
    .from("taste_profile")
    .select("*")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  $("tasteLikes").value = taste?.likes || "";
  $("tasteDislikes").value = taste?.dislikes || "";
  $("tasteSpice").value = taste?.spice_preference || "";
  $("tasteProteins").value = taste?.preferred_proteins || "";
  $("tasteDishes").value = taste?.preferred_dishes || "";
  $("tasteNotes").value = taste?.notes || "";
}

async function saveTasteProfileAndFinish() {
  if (!currentUser) return;

  const payload = {
    user_id: currentUser.id,
    likes: $("tasteLikes").value.trim() || null,
    dislikes: $("tasteDislikes").value.trim() || null,
    spice_preference: $("tasteSpice").value || null,
    preferred_proteins: $("tasteProteins").value.trim() || null,
    preferred_dishes: $("tasteDishes").value.trim() || null,
    notes: $("tasteNotes").value.trim() || null
  };

  const { error: tasteError } = await sb
    .from("taste_profile")
    .upsert(payload, { onConflict: "user_id" });

  if (tasteError) {
    console.error(tasteError);
    showToast("Couldn't save taste profile.");
    return;
  }

  const { error: profileError } = await sb
    .from("profiles")
    .update({ onboarding_complete: true })
    .eq("user_id", currentUser.id);

  if (profileError) {
    console.error(profileError);
    showToast("Couldn't finish onboarding.");
    return;
  }

  $("onboardingDialog").close();
  showToast("Taste profile saved");
}

async function signOutCurrentUser() {
  await sb.auth.signOut();
  currentUser = null;
  isAdmin = false;
  editMode = false;
  data = [];
  if ($("accountDialog").open) $("accountDialog").close();
  render();
  openAuthDialog("signin");
}

function openAccountDialog() {
  if (!currentUser) {
    openAuthDialog("signin");
    return;
  }
  $("accountEmail").textContent = currentUser.email || "";
  $("accountDialog").showModal();
}



window.addEventListener("DOMContentLoaded", () => {
  const oldAccountBtn = $("editModeBtn");
  if (oldAccountBtn) {
    const fresh = oldAccountBtn.cloneNode(true);
    oldAccountBtn.replaceWith(fresh);
    fresh.textContent = currentUser ? "👤" : "🔐";
    fresh.addEventListener("click", openAccountDialog);
  }

  $("authForm")?.addEventListener("submit", async e => {
    e.preventDefault();

    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const displayName = $("authDisplayName").value.trim();
    const errorBox = $("authError");
    errorBox.classList.add("hidden");

    if (authMode === "signup") {
      const { data: authData, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName || email.split("@")[0] } }
      });

      if (error) {
        errorBox.textContent = error.message;
        errorBox.classList.remove("hidden");
        return;
      }

      if (!authData.session) {
        errorBox.textContent = "Check your email to confirm your account, then come back and sign in.";
        errorBox.classList.remove("hidden");
        return;
      }

      currentUser = authData.user;
      isAdmin = true;
      await ensureProfile();
      $("authDialog").close();
      await loadData();
      render();
      await maybeStartOnboarding();
    } else {
      const { data: authData, error } = await sb.auth.signInWithPassword({ email, password });

      if (error) {
        errorBox.textContent = "That email or password didn't work.";
        errorBox.classList.remove("hidden");
        return;
      }

      currentUser = authData.user;
      isAdmin = true;
      await ensureProfile();
      $("authDialog").close();
      await loadData();
      render();
      await maybeStartOnboarding();
    }
  });

  $("authSwitchBtn")?.addEventListener("click", () => {
    openAuthDialog(authMode === "signup" ? "signin" : "signup");
  });

  $("authCancelBtn")?.addEventListener("click", () => $("authDialog").close());

  $("onboardingBackBtn")?.addEventListener("click", () => {
    if (onboardingStep > 1) onboardingStep--;
    renderOnboardingStep();
  });

  $("onboardingNextBtn")?.addEventListener("click", async () => {
    if (onboardingStep < 4) {
      onboardingStep++;
      renderOnboardingStep();
    } else {
      await saveTasteProfileAndFinish();
    }
  });

  $("editTasteProfileBtn")?.addEventListener("click", async () => {
    $("accountDialog").close();
    await loadTasteProfileIntoForm();
    startOnboarding();
  });

  $("signOutUserBtn")?.addEventListener("click", signOutCurrentUser);
  $("closeAccountBtn")?.addEventListener("click", () => $("accountDialog").close());
});
