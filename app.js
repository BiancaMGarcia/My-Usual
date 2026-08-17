const SUPABASE_URL = "https://ntjrvvruniofgcduhgyk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_pCnl_RWebLHeQg6wDkZvyg_jWbjabxH";
const LEGACY_STORAGE_KEY = "my-usual-data-v1";
const LAST_ZIP_STORAGE_KEY = "my-usual-last-zip";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

let data = [];
let selectedCategory = "All";
let selectedRestaurantId = null;
let editMode = false;
let editingRestaurantId = null;
let editingItemId = null;
let ratingItemId = null;
let currentUser = null;
let isAdmin = false;
let onboardingStep = 1;
let authMode = "signup";
let discoveredRestaurants = [];
let selectedDiscoveredRestaurant = null;
let discoveredReturnTarget = "search";
let topPicksRequestId = 0;
let currentTopPicks = [];
const topPicksCache = new Map();
const topPicksSeenByRestaurant = new Map();
let loadingCount = 0;
let restaurantLookupMatches = [];
let pendingItemLookupMatch = null;
let currentAvatarId = "avatar-1";
const $ = id => document.getElementById(id);
const AVATARS=[
  {id:"avatar-1",src:"avatar-husky-blue.png",name:"Happy Husky"},
  {id:"avatar-2",src:"avatar-brown-peach.png",name:"Cocoa Pup"},
  {id:"avatar-3",src:"avatar-samoyed-lavender.png",name:"Cloud Samoyed"},
  {id:"avatar-4",src:"avatar-white-mint.png",name:"Little Snow Pup"},
  {id:"avatar-5",src:"avatar-spitz-pink.png",name:"Smiley Spitz"},
  {id:"avatar-6",src:"avatar-shepherd-yellow.png",name:"Shepherd Buddy"}
];

function renderAccountButton(){
  const button=$("editModeBtn");if(!button)return;
  if(!currentUser){button.innerHTML="🔐";button.setAttribute("aria-label","Sign in");return;}
  const avatar=AVATARS.find(item=>item.id===currentAvatarId)||AVATARS[0];
  button.innerHTML=`<img class="account-avatar" src="${avatar.src}?v=31" alt="" />`;
  button.setAttribute("aria-label",`Account · ${avatar.name}`);
}

function renderAvatarPicker(){
  const picker=$("avatarPicker");if(!picker)return;
  picker.innerHTML=AVATARS.map(avatar=>`<button type="button" class="avatar-option ${avatar.id===currentAvatarId?"selected":""}" data-avatar-id="${avatar.id}" role="radio" aria-checked="${avatar.id===currentAvatarId}" aria-label="${avatar.name}"><img src="${avatar.src}?v=31" alt="" /></button>`).join("");
}

async function loadUserAvatar(){
  if(!currentUser){currentAvatarId="avatar-1";renderAccountButton();return;}
  const {data:profile,error}=await sb.from("profiles").select("avatar_id").eq("user_id",currentUser.id).maybeSingle();
  if(error&&isMissingColumnError(error,"avatar_id")){currentAvatarId="avatar-1";}else if(profile?.avatar_id&&AVATARS.some(a=>a.id===profile.avatar_id)){currentAvatarId=profile.avatar_id;}
  renderAccountButton();
}

async function chooseAvatar(avatarId){
  if(!currentUser||!AVATARS.some(avatar=>avatar.id===avatarId))return;
  const previous=currentAvatarId;currentAvatarId=avatarId;renderAccountButton();renderAvatarPicker();
  const {error}=await sb.from("profiles").update({avatar_id:avatarId}).eq("user_id",currentUser.id);
  if(error){currentAvatarId=previous;renderAccountButton();renderAvatarPicker();showToast(isMissingColumnError(error,"avatar_id")?"Run PROFILE_AVATAR_MIGRATION.sql first.":"Couldn't save avatar.");return;}
  showToast("Profile buddy updated ✨");
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  const duration = /couldn't|error/i.test(message) ? 5000 : 1800;
  showToast.timer = setTimeout(() => toast.classList.remove("show"), duration);
}

function setLoading(on, message = "Just a moment…") {
  loadingCount = Math.max(0, loadingCount + (on ? 1 : -1));
  if (on && $("loadingMessage")) $("loadingMessage").textContent = message;
  const active = loadingCount > 0;
  document.body.classList.toggle("loading", active);
  $("loadingOverlay")?.setAttribute("aria-hidden", String(!active));
}

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;

  if (currentUser) {
    await refreshAdminStatus();
    await ensureProfile();
    await loadUserAvatar();
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
  setLoading(true, "Loading your usuals…");
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
      description: o.description || "",
      item_url: o.item_url || "",
      item_link_type: o.item_link_type || "",
      rating: o.rating || null,
      favorite: !!o.favorite,
      sort_order: o.sort_order || 0
    })).sort((a,b) => Number(b.favorite)-Number(a.favorite) || (a.sort_order||0)-(b.sort_order||0) || a.name.localeCompare(b.name))
  }));
  setLoading(false);
}

function getCategories() {
  return ["All", ...new Set(data.map(r => r.category).filter(Boolean))];
}

function matchesSearch(r, query) {
  if (!query) return true;
  const haystack = [r.name, r.category, r.location, ...r.items.flatMap(i => [i.name, i.description, i.notes])]
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
  renderAccountButton();
}

function restaurantCard(r) {
  const emoji = foodEmoji(r.name, r.category);
  return `
    <button class="restaurant-card" data-restaurant-id="${r.id}">
      <div class="row">
        <div>
          <strong>${emoji} ${escapeHtml(r.name)}</strong>
          <div class="meta">${escapeHtml(r.category)}${r.location ? ` · ${escapeHtml(r.location)}` : ""}</div>
          ${ratingStars(r.rating)}
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

  const website = safeUrl(r.website_url);
  const maps = safeUrl(r.google_maps_url) || googleMapsSearchUrl(r.name,r.location);
  $("restaurantName").innerHTML = website ? `<a class="saved-link" href="${escapeHtml(website)}" target="_blank" rel="noopener">${escapeHtml(r.name)} ↗</a>` : escapeHtml(r.name);
  $("restaurantCategory").textContent = [r.category, r.location].filter(Boolean).join(" · ");
  $("favoriteBtn").textContent = r.favorite ? "⭐" : "♡";
  $("favoriteBtn").disabled = !currentUser;
  $("favoriteBtn").style.opacity = (!currentUser) ? ".45" : "1";
  $("addItemBtn").classList.toggle("hidden", !currentUser);
  $("deleteRestaurantBtn").classList.toggle("hidden", !currentUser);
  $("pickForMeResult").classList.add("hidden");
  $("pickForMeResult").innerHTML = "";
  const menuLink = $("savedRestaurantMenuLink");
  const mapsLink = $("savedRestaurantMapsLink");
  menuLink.classList.toggle("hidden", !website); if (website) menuLink.href = website;
  menuLink.textContent = r.website_link_type === "menu" ? "📖 View full menu ↗" : "🌐 Restaurant website ↗";
  mapsLink.classList.toggle("hidden", !maps); if (maps) mapsLink.href = maps;
  $("savedRestaurantLinks").classList.toggle("hidden", !website && !maps);

  $("orderList").innerHTML = r.items.length ? r.items.map(item => `
    <div class="order-card ${item.favorite ? "favorite-item" : ""}">
      <div class="order-title">${foodEmoji(item.name)} ${escapeHtml(item.name)}</div>
      ${item.description ? `<div class="order-description">${escapeHtml(item.description)}</div>` : ""}
      ${item.notes ? `<div class="order-notes"><strong>Preferences:</strong> ${escapeHtml(item.notes)}</div>` : ""}
      ${ratingStars(item.rating)}
      ${safeUrl(item.item_url)?`<a class="small-btn saved-item-link" href="${escapeHtml(safeUrl(item.item_url))}" target="_blank" rel="noopener">${itemLinkLabel(item.item_link_type)} ↗</a>`:""}
      <div class="order-actions">
        ${currentUser ? `<button class="small-btn favorite-item-btn" data-favorite-item="${item.id}">${item.favorite ? "⭐ Favorited" : "☆ Favorite"}</button>` : ""}
        ${currentUser ? `<button class="small-btn rate-item-btn" data-rate-item="${item.id}">⭐ Rate</button>` : ""}
        <button class="copy-btn" data-copy-item="${item.id}">📋 Copy order</button>
        ${currentUser ? `
          <button class="small-btn" data-edit-item="${item.id}">Edit</button>
          <button class="small-btn danger-text" data-delete-item="${item.id}">Delete</button>` : ""}
      </div>
    </div>`).join("") : `<div class="empty">No saved orders yet.</div>`;

  if (currentUser) {
    $("orderList").insertAdjacentHTML("beforeend",
      `<button class="secondary-btn full-btn" id="editRestaurantInside">✏️ Edit restaurant & links</button>`);
  }
}

async function copyOrder(item) {
  await copyDishName(item.name);
}

async function copyDishName(text) {

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
  showToast("Dish name copied!");
}

async function pickForMe() {
  const r = data.find(x => x.id === selectedRestaurantId);
  if (!r || !r.items.length) return showToast("No saved orders yet.");
  const button = $("pickForMeBtn");
  const result = $("pickForMeResult");
  button.disabled = true;
  result.classList.remove("hidden", "revealed");
  result.innerHTML = `<div class="pick-spinner"><span>🍜</span><span>🥟</span><span>🍕</span></div><strong>Choosing from your usuals…</strong>`;
  for (let i = 0; i < 8; i++) {
    const preview = r.items[i % r.items.length];
    result.querySelector("strong").textContent = `${foodEmoji(preview.name)} ${preview.name}`;
    await new Promise(resolve => setTimeout(resolve, 85 + i * 18));
  }
  const item = r.items[Math.floor(Math.random() * r.items.length)];
  const url = safeUrl(item.item_url);
  result.innerHTML = `<p class="eyebrow">✨ Your pick is</p><h3>${foodEmoji(item.name)} ${url ? `<a class="saved-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(item.name)} ↗</a>` : escapeHtml(item.name)}</h3>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}${item.notes ? `<p class="order-notes">${escapeHtml(item.notes)}</p>` : ""}${ratingStars(item.rating)}`;
  result.classList.add("revealed");
  button.disabled = false;
}

function openRestaurantForm(id = null) {
  if (!currentUser) return;
  editingRestaurantId = id;
  const r = id ? data.find(x => x.id === id) : null;
  $("restaurantFormTitle").textContent = r ? "Edit restaurant" : "Add restaurant";
  $("restaurantNameInput").value = r?.name ?? "";
  $("restaurantCategoryInput").value = r?.category ?? "";
  $("restaurantLocationInput").value = r?.location ?? "";
  $("restaurantWebsiteInput").value = r?.website_url ?? "";
  $("restaurantLinkTypeInput").value = r?.website_link_type || "restaurant";
  $("restaurantMapsInput").value = r?.google_maps_url ?? "";
  $("restaurantRatingInput").value = r?.rating ?? "";
  $("restaurantFavoriteInput").checked = r?.favorite ?? false;
  restaurantLookupMatches=[];
  $("findRestaurantDetailsStatus").classList.add("hidden");
  $("findRestaurantDetailsStatus").textContent="";
  $("findRestaurantSuggestions").classList.add("hidden");
  $("findRestaurantSuggestions").innerHTML="";
  $("editRestaurantDialog").showModal();
}

function applyRestaurantLookupMatch(match){
  if(!match)return;
  $("restaurantNameInput").value=match.name||$("restaurantNameInput").value;
  $("restaurantCategoryInput").value=match.type||$("restaurantCategoryInput").value||"Restaurant";
  $("restaurantLocationInput").value=match.address||$("restaurantLocationInput").value;
  const bestUrl=safeUrl(match.menuUrl||match.website);
  $("restaurantWebsiteInput").value=bestUrl;
  $("restaurantLinkTypeInput").value=match.menuUrl?"menu":"restaurant";
  $("restaurantMapsInput").value=safeUrl(match.googleMapsUrl);
  const linkLabel=match.menuUrl?"Menu":match.website?"Restaurant website":"no website";
  $("findRestaurantDetailsStatus").textContent=`✓ Added ${linkLabel}${match.googleMapsUrl?" and Google Maps":""}. Review before saving.`;
  $("findRestaurantDetailsStatus").classList.remove("hidden");
}

async function findRestaurantDetails(){
  const restaurantName=$("restaurantNameInput").value.trim();
  const location=$("restaurantLocationInput").value.trim();
  const sourceUrl=safeUrl($("restaurantWebsiteInput").value);
  const status=$("findRestaurantDetailsStatus");
  const suggestions=$("findRestaurantSuggestions");
  if(!restaurantName&&!sourceUrl){status.textContent="Enter a restaurant name or paste a restaurant link first.";status.classList.remove("hidden");$("restaurantNameInput").focus();return;}
  $("findRestaurantDetailsBtn").disabled=true;
  status.textContent="🔎 Looking for the official restaurant, menu, and Maps links…";status.classList.remove("hidden");
  suggestions.classList.add("hidden");suggestions.innerHTML="";
  try{
    const response=await fetch(`${SUPABASE_URL}/functions/v1/lookup-restaurant`,{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":`Bearer ${SUPABASE_PUBLISHABLE_KEY}`},body:JSON.stringify({restaurantName,location,sourceUrl})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||"Restaurant lookup failed.");
    restaurantLookupMatches=Array.isArray(result.matches)?result.matches:[];
    if(!restaurantLookupMatches.length){status.textContent="No confident match found. Try adding a city, ZIP code, or shopping center.";return;}
    if(restaurantLookupMatches.length===1){applyRestaurantLookupMatch(restaurantLookupMatches[0]);return;}
    status.textContent="Did you mean one of these?";
    suggestions.innerHTML=restaurantLookupMatches.map((match,index)=>`<button type="button" class="restaurant-suggestion-card" data-restaurant-match="${index}"><span class="restaurant-suggestion-emoji" aria-hidden="true">${foodEmoji(match.name,match.type)}</span><span class="restaurant-suggestion-copy"><strong>${escapeHtml(match.name)}</strong><span class="restaurant-suggestion-address">📍 ${escapeHtml(match.address||"Address unavailable")}</span><span class="restaurant-suggestion-badges">${match.menuUrl?'<span class="result-badge menu-badge">📖 Menu</span>':match.website?'<span class="result-badge website-badge">🌐 Website</span>':'<span class="result-badge unavailable-badge">No website</span>'}${match.googleMapsUrl?'<span class="result-badge maps-badge">🗺️ Maps</span>':""}</span></span><span class="restaurant-suggestion-arrow" aria-hidden="true">›</span></button>`).join("");
    suggestions.classList.remove("hidden");
  }catch(error){console.error(error);status.textContent=error.message||"Couldn't find restaurant details.";}finally{$("findRestaurantDetailsBtn").disabled=false;}
}

function openItemForm(id = null) {
  if (!currentUser) return;
  editingItemId = id;
  const r = data.find(x => x.id === selectedRestaurantId);
  const item = id ? r?.items.find(x => x.id === id) : null;
  $("itemFormTitle").textContent = item ? "Edit order" : "Add order";
  $("itemNameInput").value = item?.name ?? "";
  $("itemDescriptionInput").value = item?.description ?? "";
  $("itemUrlInput").value = item?.item_url ?? "";
  $("itemLinkTypeInput").value = item?.item_link_type || "item";
  $("findItemDetailsStatus").classList.add("hidden");
  $("findItemDetailsStatus").textContent = "";
  $("findItemSuggestions").classList.add("hidden");
  $("findItemSuggestions").innerHTML = "";
  pendingItemLookupMatch = null;
  $("itemNotesInput").value = item?.notes ?? "";
  $("itemRatingInput").value = item?.rating ?? "";
  $("editItemDialog").showModal();
}


function openDiscover(){
  discoveredReturnTarget="search";
  invalidateTopPicks();
  $("discoverStatus").textContent="";
  $("discoverResults").innerHTML="";
  $("restaurantSearchInput").value="";
  $("restaurantZipInput").value=localStorage.getItem(LAST_ZIP_STORAGE_KEY)||"";
  const savedRadius=Number(localStorage.getItem("my-usual-search-radius"))||25;
  $("restaurantRadiusInput").value=String(Math.min(50,Math.max(5,savedRadius)));
  updateRestaurantRadiusLabel();
  $("discoverDialog").showModal();
  setTimeout(()=>($("restaurantZipInput").value?$("restaurantSearchInput"):$("restaurantZipInput")).focus(),100);
}
function showRestaurantSearchLoading(){
  $("discoverResults").innerHTML=`<div class="restaurant-search-loading"><div class="searching-icon-row"><span>📍</span><span>🍽️</span></div><strong>Looking around the neighborhood</strong><div class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></div><div class="result-skeletons" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
}
async function searchRestaurants(suggestion=""){
  invalidateTopPicks();
  const search=$("restaurantSearchInput").value.trim();
  const sourceUrl=safeUrl(search);
  const restaurantSearchText=sourceUrl?"":search;
  const zip=$("restaurantZipInput").value.trim();
  const radiusMiles=Number($("restaurantRadiusInput").value)||25;
  if(!sourceUrl&&!/^\d{5}$/.test(zip)){$("discoverStatus").textContent="Enter a valid 5-digit ZIP code, or paste a restaurant link.";$("restaurantZipInput").focus();return;}
  if(zip&&!/^\d{5}$/.test(zip)){$("discoverStatus").textContent="ZIP code must contain 5 digits.";$("restaurantZipInput").focus();return;}
  if(zip)localStorage.setItem(LAST_ZIP_STORAGE_KEY,zip);
  localStorage.setItem("my-usual-search-radius",String(radiusMiles));
  const searchTerm=suggestion||search||"popular restaurants";
  const query=`Find up to 15 currently open restaurants matching "${searchTerm}" within ${radiusMiles} miles of ZIP code ${zip}. Include nearby cities and different ZIP codes. Use fuzzy name matching, partial names, common spelling variations, and the restaurant's full official name. Do not require an exact name or exact ZIP-code match.`;
  $("restaurantSearchBtn").disabled=true;$("restaurantSearchBtn").textContent="Searching…";$("discoverStatus").textContent="Searching restaurants…";showRestaurantSearchLoading();
  try{
    if(sourceUrl){
      const response=await fetch(`${SUPABASE_URL}/functions/v1/lookup-restaurant`,{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":`Bearer ${SUPABASE_PUBLISHABLE_KEY}`},body:JSON.stringify({restaurantName:restaurantSearchText,location:zip,sourceUrl})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok){console.error(result);$("discoverStatus").textContent=result.error||"That link couldn't be matched to a restaurant.";$("discoverResults").innerHTML="";return;}
      discoveredRestaurants=(result.matches||[]).map(r=>({...r,website:r.website||"",menuUrl:r.menuUrl||""}));
      $("discoverStatus").textContent=discoveredRestaurants.length?`${discoveredRestaurants.length} verified restaurant match${discoveredRestaurants.length===1?"":"es"} found from that link`:"No confident restaurant match was found from that link. Add the restaurant name or ZIP code and try again.";
      $("discoverResults").innerHTML=discoveredRestaurants.map((r,index)=>{const kind=r.type||"Restaurant";const yelp=safeUrl(r.yelpUrl)||yelpSearchUrl(r.name,r.address);return `<div class="discover-result"><button type="button" class="discover-result-main" data-discovered-index="${index}"><strong>${foodEmoji(r.name,kind)} ${escapeHtml(r.name)}</strong><div class="meta">${escapeHtml(kind)}</div><div class="meta">📍 ${escapeHtml(r.address||"")}</div></button><a class="discover-yelp-link" href="${escapeHtml(yelp)}" target="_blank" rel="noopener">⭐ Check Yelp ratings ↗</a></div>`;}).join("");
      return;
    }
    const response=await fetch(`${SUPABASE_URL}/functions/v1/search-restaurants`,{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":`Bearer ${SUPABASE_PUBLISHABLE_KEY}`},body:JSON.stringify({query,searchTerm,zip,radiusMiles})});
    const result=await response.json();
    if(!response.ok){console.error(result);$("discoverStatus").textContent="Restaurant search failed. Try again.";$("discoverResults").innerHTML="";return;}
    discoveredRestaurants=result.restaurants||[];
    $("discoverStatus").textContent=discoveredRestaurants.length?`${discoveredRestaurants.length} restaurant${discoveredRestaurants.length===1?"":"s"} found within ${radiusMiles} miles of ${zip}`:`No restaurants found within ${radiusMiles} miles. Try expanding the radius.`;
    $("discoverResults").innerHTML=discoveredRestaurants.map((r,index)=>{const kind=r.type||r.category||r.cuisine||r.primaryType||"Restaurant";const distance=Number(r.distanceMiles)>0?` · about ${Number(r.distanceMiles).toFixed(1)} mi`:"";const yelp=yelpSearchUrl(r.name,r.address);return `<div class="discover-result"><button type="button" class="discover-result-main" data-discovered-index="${index}"><strong>${foodEmoji(r.name,kind)} ${escapeHtml(r.name)}</strong><div class="meta">${escapeHtml(kind)}${distance}</div><div class="meta">📍 ${escapeHtml(r.address||"")}</div></button><a class="discover-yelp-link" href="${escapeHtml(yelp)}" target="_blank" rel="noopener">⭐ Check Yelp ratings ↗</a></div>`;}).join("");
  }catch(error){console.error(error);$("discoverStatus").textContent="Couldn't reach restaurant search.";$("discoverResults").innerHTML="";}finally{$("restaurantSearchBtn").disabled=false;$("restaurantSearchBtn").textContent="Find Restaurants";}
}
function updateRestaurantRadiusLabel(){
  const miles=Number($("restaurantRadiusInput").value)||25;
  $("restaurantRadiusValue").textContent=`${miles} miles`;
}
function openDiscoveredRestaurant(index){
  discoveredReturnTarget="search";
  const searchResult=discoveredRestaurants[index];if(!searchResult)return;
  // Search-provider website fields are unverified. Keep the restaurant identity,
  // address, and Maps link, then let lookup-restaurant supply verified web links.
  const hasVerifiedLinks=searchResult._verifiedLinks===true;
  selectedDiscoveredRestaurant={...searchResult,_searchIndex:index,website:hasVerifiedLinks?searchResult.website||"":"",menuUrl:hasVerifiedLinks?searchResult.menuUrl||"":"",menuSourceType:hasVerifiedLinks?searchResult.menuSourceType||"":""}; const r=selectedDiscoveredRestaurant;
  const kind=r.type||r.category||r.cuisine||r.primaryType||"Restaurant";$("discoveredName").textContent=`${foodEmoji(r.name,kind)} ${r.name||"Restaurant"}`;$("discoveredType").textContent=kind;$("discoveredAddress").textContent=r.address?`📍 ${r.address}`:"";
  const menu=$("viewMenuBtn"); const menuUrl=safeUrl(r.menuUrl); if(menuUrl){menu.href=menuUrl;menu.textContent="📖 View menu ↗";menu.classList.remove("hidden");}else{menu.classList.add("hidden");}
  const website=$("viewRestaurantBtn"); const websiteUrl=safeUrl(r.website); if(websiteUrl){website.href=websiteUrl;website.textContent="🌐 Restaurant website ↗";website.classList.remove("hidden");}else{website.classList.add("hidden");}
  const maps=$("viewMapsBtn"); if(r.googleMapsUrl){maps.href=r.googleMapsUrl;maps.classList.remove("hidden");}else{maps.classList.add("hidden");}
  const yelp=$("viewYelpBtn");yelp.href=safeUrl(r.yelpUrl)||yelpSearchUrl(r.name,r.address);yelp.textContent=safeUrl(r.yelpUrl)?"⭐ View on Yelp ↗":"⭐ Find Yelp ratings ↗";yelp.classList.remove("hidden");
  $("discoverDialog").close();$("discoveredRestaurantDialog").showModal();
  if(hasVerifiedLinks)loadTopPicks();else enrichRestaurantThenLoadTopPicks();
}
function openSavedRestaurantTopPicks(){
  const r=data.find(item=>item.id===selectedRestaurantId);if(!r)return;
  discoveredReturnTarget="saved";
  const savedUrl=safeUrl(r.website_url);
  selectedDiscoveredRestaurant={name:r.name,type:r.category||"Restaurant",address:r.location||"",website:r.website_link_type==="menu"?"":savedUrl,menuUrl:r.website_link_type==="menu"?savedUrl:"",googleMapsUrl:safeUrl(r.google_maps_url)||googleMapsSearchUrl(r.name,r.location),yelpUrl:""};
  const detail=selectedDiscoveredRestaurant;
  $("discoveredName").textContent=`${foodEmoji(detail.name,detail.type)} ${detail.name}`;$("discoveredType").textContent=detail.type;$("discoveredAddress").textContent=detail.address?`📍 ${detail.address}`:"";
  const menu=$("viewMenuBtn");if(detail.menuUrl){menu.href=detail.menuUrl;menu.textContent="📖 View menu ↗";menu.classList.remove("hidden");}else menu.classList.add("hidden");
  const website=$("viewRestaurantBtn");if(detail.website){website.href=detail.website;website.textContent="🌐 Restaurant website ↗";website.classList.remove("hidden");}else website.classList.add("hidden");
  const maps=$("viewMapsBtn");if(detail.googleMapsUrl){maps.href=detail.googleMapsUrl;maps.classList.remove("hidden");}else maps.classList.add("hidden");
  const yelp=$("viewYelpBtn");yelp.href=yelpSearchUrl(detail.name,detail.address);yelp.textContent="⭐ Find Yelp ratings ↗";yelp.classList.remove("hidden");
  $("restaurantDialog").close();$("discoveredRestaurantDialog").showModal();enrichRestaurantThenLoadTopPicks();
}

async function enrichRestaurantThenLoadTopPicks(){
  const restaurant=selectedDiscoveredRestaurant;if(!restaurant)return;
  const expectedName=restaurant.name;
  const expectedAddress=restaurant.address||"";
  resetTopPicks();$("topPicksExplainer").textContent="Finding the official restaurant website and menu before researching your picks.";showTopPicksLoading();
  try{
    const response=await fetch(`${SUPABASE_URL}/functions/v1/lookup-restaurant`,{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":`Bearer ${SUPABASE_PUBLISHABLE_KEY}`},body:JSON.stringify({restaurantName:restaurant.name,location:restaurant.address||""})});
    const result=await response.json().catch(()=>({}));
    if(response.ok&&selectedDiscoveredRestaurant?.name===expectedName&&selectedDiscoveredRestaurant?.address===expectedAddress){
      const matches=Array.isArray(result.matches)?result.matches:[];
      const match=matches.find(item=>restaurantIdentityMatches(item,restaurant));
      if(match){
        selectedDiscoveredRestaurant={...selectedDiscoveredRestaurant,name:match.name||restaurant.name,type:match.type||restaurant.type,address:match.address||restaurant.address,website:safeUrl(match.website)||restaurant.website,menuUrl:safeUrl(match.menuUrl)||restaurant.menuUrl,menuSourceType:match.menuSourceType||restaurant.menuSourceType,googleMapsUrl:safeUrl(match.googleMapsUrl)||restaurant.googleMapsUrl,_verifiedLinks:true};
        if(Number.isInteger(selectedDiscoveredRestaurant._searchIndex))discoveredRestaurants[selectedDiscoveredRestaurant._searchIndex]={...discoveredRestaurants[selectedDiscoveredRestaurant._searchIndex],...selectedDiscoveredRestaurant,_verifiedLinks:true};
        const detail=selectedDiscoveredRestaurant;
        $("discoveredName").textContent=`${foodEmoji(detail.name,detail.type)} ${detail.name}`;$("discoveredAddress").textContent=detail.address?`📍 ${detail.address}`:"";
        const menu=$("viewMenuBtn");if(detail.menuUrl){menu.href=detail.menuUrl;menu.textContent=menuLinkLabel(detail.menuSourceType);menu.classList.remove("hidden");}
        const website=$("viewRestaurantBtn");if(detail.website){website.href=detail.website;website.textContent="🌐 Restaurant website ↗";website.classList.remove("hidden");}
        const maps=$("viewMapsBtn");if(detail.googleMapsUrl){maps.href=detail.googleMapsUrl;maps.classList.remove("hidden");}
      }
    }
  }catch(error){console.error("Restaurant link enrichment failed:",error);}
  if(selectedDiscoveredRestaurant&&$("discoveredRestaurantDialog").open)loadTopPicks();
}

function normalizeSearchName(value=""){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g,"").replace(/restaurant|cafe|shop|studio|teahouse/g,"");}
function restaurantIdentityMatches(candidate={},expected={}){
  const candidateName=normalizeSearchName(candidate.name),expectedName=normalizeSearchName(expected.name);
  if(!candidateName||!expectedName||candidateName!==expectedName)return false;
  const candidateAddress=String(candidate.address||"").toLowerCase(),expectedAddress=String(expected.address||"").toLowerCase();
  const expectedZip=expectedAddress.match(/\b\d{5}\b/)?.[0];
  if(expectedZip&&candidateAddress&&!candidateAddress.includes(expectedZip))return false;
  return true;
}
function menuLinkLabel(type=""){return type==="official"?"📖 Official menu ↗":type==="restaurant-linked"?"🛍️ Restaurant-linked order menu ↗":type==="third-party"?"🔎 Third-party menu ↗":"📖 View menu ↗";}
function menuSourceLabel(type=""){return type==="official"?"Official restaurant menu":type==="restaurant-linked"?"Ordering page linked by the restaurant":type==="saved-menu"?"Saved menu link":type==="third-party"?"Third-party menu fallback":"Menu source";}

function resetTopPicks(){
  currentTopPicks=[];
  $("topPicksList").innerHTML="";
  $("topPicksStatus").innerHTML="";
  $("topPicksSource").classList.add("hidden");$("topPicksSource").innerHTML="";
  $("topPicksActions").classList.add("hidden");
  $("retryTopPicksBtn").classList.add("hidden");
  $("findDifferentTopPicksBtn")?.classList.add("hidden");
  $("newRestaurantPickResult")?.classList.add("hidden");
  if ($("newRestaurantPickResult")) $("newRestaurantPickResult").innerHTML="";
}

function invalidateTopPicks(){
  topPicksRequestId++;
  currentTopPicks=[];
  selectedDiscoveredRestaurant=null;
  resetTopPicks();
}

function showTopPicksMessage(message, action=""){
  const existingMenuUrl=safeUrl(selectedDiscoveredRestaurant?.menuUrl||"");
  const menuProblem=/menu|recommendation|verif/i.test(message);
  const menuHelp=menuProblem&&!existingMenuUrl?`<div class="empty top-picks-link-help"><strong>A menu link may help.</strong><p>Paste the restaurant's full menu link below and My Usual will try the recommendations again.</p><label class="inline-menu-link-label">Menu link<input id="topPicksMenuLinkInput" type="url" inputmode="url" placeholder="https://restaurant.com/menu" /></label><button id="useTopPicksMenuLinkBtn" type="button" class="secondary-btn full-btn">📖 Use this menu</button></div>`:menuProblem&&existingMenuUrl?`<div class="empty top-picks-link-help"><strong>Menu link found ✓</strong><p>My Usual found the menu, but this website did not expose readable item names. It already checked alternate verified menu sources, so you do not need to paste the same link again.</p></div>`:"";
  $("topPicksStatus").innerHTML=`<div class="empty">${escapeHtml(message)}</div>${menuHelp}`;
  $("retryTopPicksBtn").classList.toggle("hidden",action!=="retry");
}

function showTopPicksLoading(){
  $("topPicksStatus").innerHTML=`<div class="top-picks-loading"><span class="mini-plate">🍽️</span><div><strong>Finding your Top Picks</strong><div class="loading-dots" aria-hidden="true"><span></span><span></span><span></span></div></div></div>`;
  $("retryTopPicksBtn").classList.add("hidden");
}

function renderTopPicks(picks){
  currentTopPicks=picks;
  $("topPicksStatus").innerHTML="";
  $("retryTopPicksBtn").classList.add("hidden");
  $("findDifferentTopPicksBtn")?.classList.remove("hidden");
  const restaurant=data.find(x=>x.name.toLowerCase()===(selectedDiscoveredRestaurant?.name||"").toLowerCase());
  const savedNames=new Set((restaurant?.items||[]).map(item=>item.name.toLowerCase()));
  $("topPicksList").innerHTML=picks.map((pick,index)=>`
    <li class="top-pick-item ${savedNames.has((pick.name||"").toLowerCase())?"is-saved":""}">
      <label class="top-pick-choice"><input type="checkbox" data-pick-index="${index}" ${savedNames.has((pick.name||"").toLowerCase())?"disabled":"checked"} /><span class="top-pick-rank">${Number(pick.rank)||index+1}</span></label>
      <div class="top-pick-copy">
        <strong>${foodEmoji(pick.name)} ${safeUrl(pick.itemUrl||pick.item_url) ? `<a class="saved-link" href="${escapeHtml(safeUrl(pick.itemUrl||pick.item_url))}" target="_blank" rel="noopener">${escapeHtml(pick.name||"Menu pick")} ↗</a>` : escapeHtml(pick.name||"Menu pick")}</strong>
        ${pick.description?`<p class="pick-description">${escapeHtml(pick.description)}</p>`:""}
        <p>${escapeHtml(pick.reason||"A strong match for your taste profile.")}</p>
        <div class="top-pick-utility"><button type="button" class="small-btn" data-copy-pick-index="${index}">📋 Copy order</button>${safeUrl(pick.itemUrl||pick.item_url)?`<a class="small-btn item-link-btn" href="${escapeHtml(safeUrl(pick.itemUrl||pick.item_url))}" target="_blank" rel="noopener">🔗 View item ↗</a>`:""}</div>
        ${savedNames.has((pick.name||"").toLowerCase())?`<span class="top-pick-saved">✓ Saved</span>`:""}
      </div>
    </li>`).join("");
  $("topPicksActions").classList.toggle("hidden",picks.every(pick=>savedNames.has((pick.name||"").toLowerCase())));
  $("saveAllPicksBtn").textContent=`Save all ${picks.length}`;
  $("topPicksExplainer").textContent=picks.length<5
    ? `We verified ${picks.length} current menu ${picks.length===1?"item":"items"} that match your taste profile.`
    : "Personalized using your taste profile and this restaurant’s menu.";
}

async function pickFromNewRestaurant(){
  if(!currentTopPicks.length)return showToast("Top Picks are still loading.");
  const button=$("pickNewRestaurantBtn");
  const result=$("newRestaurantPickResult");
  button.disabled=true;
  result.classList.remove("hidden","revealed");
  result.innerHTML=`<div class="pick-spinner"><span>🍜</span><span>🥟</span><span>🍕</span></div><strong>Choosing from your Top Picks…</strong>`;
  for(let i=0;i<9;i++){
    const preview=currentTopPicks[i%currentTopPicks.length];
    result.querySelector("strong").textContent=`${foodEmoji(preview.name)} ${preview.name}`;
    await new Promise(resolve=>setTimeout(resolve,80+i*16));
  }
  const available=currentTopPicks.map((pick,index)=>({pick,index})).filter(({index})=>!document.querySelector(`[data-pick-index="${index}"]`)?.disabled);
  const choice=(available.length?available:currentTopPicks.map((pick,index)=>({pick,index})))[Math.floor(Math.random()*(available.length||currentTopPicks.length))];
  document.querySelectorAll("[data-pick-index]").forEach(input=>{if(!input.disabled)input.checked=Number(input.dataset.pickIndex)===choice.index;});
  const pick=choice.pick;
  const link=safeUrl(pick.itemUrl||pick.item_url);
  result.innerHTML=`<p class="eyebrow">✨ Your pick is</p><h3>${foodEmoji(pick.name)} ${link?`<a class="saved-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(pick.name)} ↗</a>`:escapeHtml(pick.name)}</h3>${pick.description?`<p>${escapeHtml(pick.description)}</p>`:""}<p>${escapeHtml(pick.reason||"")}</p>`;
  result.classList.add("revealed");
  button.disabled=false;
}

async function ensureDiscoveredRestaurantSaved(){
  const r=selectedDiscoveredRestaurant;
  if(!r||!currentUser)throw new Error("Sign in to save recommendations.");
  const existing=data.find(x=>x.name.toLowerCase()===(r.name||"").toLowerCase());
  if(existing){
    const verifiedMenu=safeUrl(r.menuUrl||"");
    if(verifiedMenu&&safeUrl(existing.website_url||"")!==verifiedMenu){
      let {error}=await sb.from("restaurants").update({website_url:verifiedMenu,website_link_type:"menu"}).eq("id",existing.id);
      if(error&&isMissingColumnError(error,"website_link_type"))({error}=await sb.from("restaurants").update({website_url:verifiedMenu}).eq("id",existing.id));
      if(!error){existing.website_url=verifiedMenu;existing.website_link_type="menu";}
    }
    return existing;
  }
  const payload={name:r.name,category:r.type||"Restaurant",location:extractLocationFromAddress(r.address)||null,website_url:safeUrl(r.menuUrl||r.website)||null,website_link_type:r.menuUrl?"menu":"restaurant",google_maps_url:safeUrl(r.googleMapsUrl)||null,favorite:false,user_id:currentUser.id};
  let {data:created,error}=await sb.from("restaurants").insert(payload).select("*").single();
  if(error&&isMissingColumnError(error,"website_link_type")){
    const legacyPayload={...payload};delete legacyPayload.website_link_type;
    ({data:created,error}=await sb.from("restaurants").insert(legacyPayload).select("*").single());
  }
  if(error)throw error;
  return {...created,items:[]};
}

async function saveTopPicks(saveAll=false){
  if(!currentUser){openAuthDialog("signin");showToast("Sign in to save recommendations.");return;}
  const indexes=saveAll?currentTopPicks.map((_,index)=>index):[...document.querySelectorAll("[data-pick-index]:checked")].map(input=>Number(input.dataset.pickIndex));
  const selected=indexes.map(index=>currentTopPicks[index]).filter(Boolean);
  if(!selected.length){showToast("Choose at least one dish to save.");return;}
  setLoading(true,selected.length===1?"Saving your pick…":"Saving your picks…");
  try{
    const restaurant=await ensureDiscoveredRestaurantSaved();
    const existingNames=new Set((restaurant.items||[]).map(item=>item.name.toLowerCase()));
    const newPicks=selected.filter(pick=>!existingNames.has((pick.name||"").toLowerCase()));
    if(newPicks.length){
      const rows=newPicks.map(pick=>({restaurant_id:restaurant.id,name:pick.name,description:pick.description||pick.reason||null,item_url:safeUrl(pick.itemUrl||pick.item_url)||null,item_link_type:safeUrl(pick.itemUrl||pick.item_url)?"item":null,notes:pick.reason?`Why it fits you: ${pick.reason}`:null}));
      let {error}=await sb.from("orders").insert(rows);
      if(error&&isMissingColumnError(error,"item_link_type"))({error}=await sb.from("orders").insert(rows.map(row=>{const legacy={...row};delete legacy.item_link_type;return legacy;})));
      if(error)throw error;
    }
    await loadData();render();renderTopPicks(currentTopPicks);
    showToast(newPicks.length?`${newPicks.length} pick${newPicks.length===1?"":"s"} saved under ${restaurant.name}`:"Those picks are already saved.");
  }catch(error){console.error(error);showToast(`Couldn't save picks: ${error.message||"Unknown database error"}`);}finally{setLoading(false);}
}

function topPicksCacheKey(restaurant){return `${normalizeSearchName(restaurant?.name||"")}|${String(restaurant?.address||"").toLowerCase()}`;}

async function loadTopPicks(options={}){
  const restaurant=selectedDiscoveredRestaurant;
  const excludeItems=Array.isArray(options?.excludeItems)?options.excludeItems.filter(Boolean):[];
  const force=options?.force===true;
  const requestId=++topPicksRequestId;
  resetTopPicks();

  if(!currentUser){
    $("topPicksExplainer").textContent="Sign in and complete your taste profile to get personalized picks.";
    showTopPicksMessage("Sign in to see your Top Picks.");
    return;
  }

  const cacheKey=topPicksCacheKey(restaurant);
  const cached=!force&&!excludeItems.length?topPicksCache.get(cacheKey):null;
  if(cached){
    if(cached.menuUrl&&selectedDiscoveredRestaurant){selectedDiscoveredRestaurant.menuUrl=safeUrl(cached.menuUrl);selectedDiscoveredRestaurant.menuSourceType=cached.menuSourceType||selectedDiscoveredRestaurant.menuSourceType;$("viewMenuBtn").href=selectedDiscoveredRestaurant.menuUrl;$("viewMenuBtn").textContent=menuLinkLabel(selectedDiscoveredRestaurant.menuSourceType);$("viewMenuBtn").classList.remove("hidden");}
    if(cached.menuUrl){$("topPicksSource").innerHTML=`Previously verified menu · <a href="${escapeHtml(safeUrl(cached.menuUrl))}" target="_blank" rel="noopener">${escapeHtml(menuSourceLabel(cached.menuSourceType))} ↗</a>`;$("topPicksSource").classList.remove("hidden");}
    renderTopPicks(cached.picks.slice(0,5));return;
  }

  $("topPicksExplainer").textContent="Personalized using your taste profile and this restaurant’s menu.";
  showTopPicksLoading();

  try{
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)throw new Error("Your session expired. Please sign in again.");

    const response=await fetch(`${SUPABASE_URL}/functions/v1/top-picks`,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":SUPABASE_PUBLISHABLE_KEY,
        "Authorization":`Bearer ${session.access_token}`
      },
      body:JSON.stringify({
        restaurantName:restaurant?.name||"",
        restaurantAddress:restaurant?.address||"",
        website:restaurant?.website||"",
        menuUrl:restaurant?.menuUrl||"",
        excludeItems
      })
    });

    const result=await response.json().catch(()=>({}));
    if(requestId!==topPicksRequestId)return;
    if(!response.ok)throw new Error(result.error||"Recommendations are unavailable right now.");
    if(!Array.isArray(result.picks)||!result.picks.length)throw new Error("No menu recommendations were found.");
    topPicksCache.set(cacheKey,result);
    const seenNames=topPicksSeenByRestaurant.get(cacheKey)||new Set();result.picks.forEach(pick=>seenNames.add(pick.name));topPicksSeenByRestaurant.set(cacheKey,seenNames);
    if(result.menuUrl&&selectedDiscoveredRestaurant){
      selectedDiscoveredRestaurant.menuUrl=safeUrl(result.menuUrl);
      selectedDiscoveredRestaurant.menuSourceType=result.menuSourceType||selectedDiscoveredRestaurant.menuSourceType;
      if(Number.isInteger(selectedDiscoveredRestaurant._searchIndex))discoveredRestaurants[selectedDiscoveredRestaurant._searchIndex]={...discoveredRestaurants[selectedDiscoveredRestaurant._searchIndex],...selectedDiscoveredRestaurant,_verifiedLinks:true};
      if(selectedDiscoveredRestaurant.menuUrl){$("viewMenuBtn").href=selectedDiscoveredRestaurant.menuUrl;$("viewMenuBtn").textContent=menuLinkLabel(selectedDiscoveredRestaurant.menuSourceType);$("viewMenuBtn").classList.remove("hidden");}
      const savedRestaurant=data.find(item=>item.id===selectedRestaurantId&&normalizeSearchName(item.name)===normalizeSearchName(selectedDiscoveredRestaurant.name));
      if(savedRestaurant&&selectedDiscoveredRestaurant.menuUrl){
        let {error}=await sb.from("restaurants").update({website_url:selectedDiscoveredRestaurant.menuUrl,website_link_type:"menu"}).eq("id",savedRestaurant.id);
        if(error&&isMissingColumnError(error,"website_link_type"))({error}=await sb.from("restaurants").update({website_url:selectedDiscoveredRestaurant.menuUrl}).eq("id",savedRestaurant.id));
        if(!error){savedRestaurant.website_url=selectedDiscoveredRestaurant.menuUrl;savedRestaurant.website_link_type="menu";}
      }
    }
    if(result.menuUrl){const checked=result.menuCheckedAt?new Date(result.menuCheckedAt).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}):"just now";$("topPicksSource").innerHTML=`Menu checked ${escapeHtml(checked)} · <a href="${escapeHtml(safeUrl(result.menuUrl))}" target="_blank" rel="noopener">${escapeHtml(menuSourceLabel(result.menuSourceType))} ↗</a>`;$("topPicksSource").classList.remove("hidden");}
    if(result.yelpUrl&&selectedDiscoveredRestaurant){selectedDiscoveredRestaurant.yelpUrl=safeUrl(result.yelpUrl);$("viewYelpBtn").href=selectedDiscoveredRestaurant.yelpUrl;$("viewYelpBtn").textContent="⭐ View on Yelp ↗";}
    renderTopPicks(result.picks.slice(0,5));
  }catch(error){
    if(requestId!==topPicksRequestId)return;
    console.error(error);
    showTopPicksMessage(error.message||"Couldn't load recommendations.","retry");
  }
}
function extractLocationFromAddress(address=""){const parts=address.split(",").map(x=>x.trim()).filter(Boolean);return parts.length>=3?parts[parts.length-3]:"";}
function yelpSearchUrl(name="",location=""){return `https://www.yelp.com/search?find_desc=${encodeURIComponent(name||"Restaurant")}&find_loc=${encodeURIComponent(location||"")}`;}

$("searchInput").addEventListener("input", render);

$("categoryChips").addEventListener("click", e => {
  const btn = e.target.closest("[data-category]");
  if (!btn) return;
  selectedCategory = btn.dataset.category;
  render();
});

document.addEventListener("click", async e => {
  if (e.target.closest("#useTopPicksMenuLinkBtn")) {
    const input=$("topPicksMenuLinkInput");
    const menuUrl=safeUrl(input?.value);
    if(!menuUrl){showToast("Enter a complete menu link beginning with https://");input?.focus();return;}
    if(!selectedDiscoveredRestaurant){showToast("Reopen the restaurant and try again.");return;}
    selectedDiscoveredRestaurant.menuUrl=menuUrl;
    selectedDiscoveredRestaurant.menuSourceType="user-provided";
    const menuButton=$("viewMenuBtn");menuButton.href=menuUrl;menuButton.textContent="📖 View provided menu ↗";menuButton.classList.remove("hidden");
    if(discoveredReturnTarget==="saved"&&selectedRestaurantId&&currentUser){
      let {error}=await sb.from("restaurants").update({website_url:menuUrl,website_link_type:"menu"}).eq("id",selectedRestaurantId);
      if(error&&isMissingColumnError(error,"website_link_type"))({error}=await sb.from("restaurants").update({website_url:menuUrl}).eq("id",selectedRestaurantId));
      if(error){console.error("Menu link save failed:",error);showToast("The link will be used now, but couldn't be saved.");}
      else{await loadData();showToast("Menu link saved");}
    }
    loadTopPicks();
    return;
  }
  const closeBtn = e.target.closest("[data-close-dialog]");
  if (closeBtn) $(closeBtn.dataset.closeDialog)?.close();

  const suggestion = e.target.closest("[data-taste-target]");
  if (suggestion) {
    const field = $(suggestion.dataset.tasteTarget);
    const value = suggestion.textContent.trim();
    const values = field.value.split(",").map(part => part.trim()).filter(Boolean);
    if (!values.some(part => part.toLowerCase() === value.toLowerCase())) field.value = [...values, value].join(", ");
    suggestion.classList.add("added");
  }

  const card = e.target.closest("[data-restaurant-id]");
  if (card) openRestaurant(card.dataset.restaurantId);

  const copyBtn = e.target.closest("[data-copy-item]");
  if (copyBtn) {
    const r = data.find(x => x.id === selectedRestaurantId);
    const item = r?.items.find(x => x.id === copyBtn.dataset.copyItem);
    if (item) copyOrder(item);
  }

  const copyPickBtn = e.target.closest("[data-copy-pick-index]");
  if (copyPickBtn) {
    const pick = currentTopPicks[Number(copyPickBtn.dataset.copyPickIndex)];
    if (pick?.name) copyDishName(pick.name);
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

  const favoriteItem = e.target.closest("[data-favorite-item]");
  if (favoriteItem && currentUser) {
    const restaurant = data.find(x => x.id === selectedRestaurantId);
    const item = restaurant?.items.find(x => x.id === favoriteItem.dataset.favoriteItem);
    if (!item) return;
    const { error } = await sb.from("orders").update({ favorite: !item.favorite }).eq("id", item.id);
    if (error) return showToast("Couldn't update item favorite.");
    await loadData(); render(); renderRestaurantSheet();
    showToast(item.favorite ? "Removed from favorites" : "Item favorited ⭐");
  }

  const rateItem = e.target.closest("[data-rate-item]");
  if (rateItem && currentUser) {
    const restaurant = data.find(x => x.id === selectedRestaurantId);
    const item = restaurant?.items.find(x => x.id === rateItem.dataset.rateItem);
    if (!item) return;
    ratingItemId = item.id;
    $("rateItemName").textContent = `${foodEmoji(item.name)} ${item.name}`;
    renderRateButtons(item.rating);
    $("rateItemDialog").showModal();
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
    $("adminEmailLabel").textContent = currentUser.email || currentUser.phone || "Signed in";
    $("adminDialog").showModal();
  }
});

$("addRestaurantBtn").addEventListener("click", () => openRestaurantForm());
$("findRestaurantDetailsBtn").addEventListener("click",findRestaurantDetails);
$("findRestaurantSuggestions").addEventListener("click",e=>{const button=e.target.closest("[data-restaurant-match]");if(button){applyRestaurantLookupMatch(restaurantLookupMatches[Number(button.dataset.restaurantMatch)]);$("findRestaurantSuggestions").classList.add("hidden");}});
$("addItemBtn").addEventListener("click", () => openItemForm());
$("closeRestaurantBtn").addEventListener("click", () => $("restaurantDialog").close());
$("pickForMeBtn").addEventListener("click", pickForMe);

$("deleteRestaurantBtn").addEventListener("click", async () => {
  if (!currentUser) return;
  const restaurant = data.find(x => x.id === selectedRestaurantId);
  if (!restaurant || !confirm(`Delete ${restaurant.name} and all of its saved items?`)) return;
  setLoading(true, "Deleting restaurant…");
  try {
    const { error: itemsError } = await sb.from("orders").delete().eq("restaurant_id", restaurant.id);
    if (itemsError) throw itemsError;
    const { error } = await sb.from("restaurants").delete().eq("id", restaurant.id);
    if (error) throw error;
    $("restaurantDialog").close(); selectedRestaurantId = null;
    await loadData(); render(); showToast("Restaurant deleted");
  } catch (error) {
    console.error(error); showToast(`Couldn't delete restaurant: ${error.message || "Unknown database error"}`);
  } finally { setLoading(false); }
});

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

  const suppliedRestaurantUrl = safeUrl($("restaurantWebsiteInput").value);
  if (suppliedRestaurantUrl && (!$("restaurantLocationInput").value.trim() || !$("restaurantMapsInput").value.trim())) {
    await findRestaurantDetails();
    if (!$("findRestaurantSuggestions").classList.contains("hidden")) {
      showToast("Choose the matching restaurant, then press Save again.");
      return;
    }
  }

  const payload = {
    name: $("restaurantNameInput").value.trim(),
    category: $("restaurantCategoryInput").value.trim(),
    location: $("restaurantLocationInput").value.trim() || null,
    website_url: safeUrl($("restaurantWebsiteInput").value) || null,
    website_link_type: safeUrl($("restaurantWebsiteInput").value) ? $("restaurantLinkTypeInput").value : null,
    google_maps_url: safeUrl($("restaurantMapsInput").value) || googleMapsSearchUrl($("restaurantNameInput").value,$("restaurantLocationInput").value) || null,
    rating: $("restaurantRatingInput").value ? Number($("restaurantRatingInput").value) : null,
    favorite: $("restaurantFavoriteInput").checked,
    user_id: currentUser.id
  };

  let error;
  if (editingRestaurantId) {
    ({ error } = await sb.from("restaurants").update(payload).eq("id", editingRestaurantId));
  } else {
    ({ error } = await sb.from("restaurants").insert(payload));
  }

  if (error && isMissingColumnError(error, "website_link_type")) {
    const legacyPayload = { ...payload };
    delete legacyPayload.website_link_type;
    if (editingRestaurantId) ({ error } = await sb.from("restaurants").update(legacyPayload).eq("id", editingRestaurantId));
    else ({ error } = await sb.from("restaurants").insert(legacyPayload));
  }

  if (error) { console.error("Restaurant save failed:", error); return showToast(`Couldn't save restaurant: ${error.message || "Database error"}`); }
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
  const description = $("itemDescriptionInput").value.trim() || null;
  const item_url = safeUrl($("itemUrlInput").value) || null;
  const item_link_type = item_url ? $("itemLinkTypeInput").value : null;
  const rating = $("itemRatingInput").value ? Number($("itemRatingInput").value) : null;

  let error;
  if (editingItemId) {
    ({ error } = await sb.from("orders").update({ name, notes, description, item_url, item_link_type, rating }).eq("id", editingItemId));
  } else {
    ({ error } = await sb.from("orders").insert({
      restaurant_id: selectedRestaurantId,
      name,
      notes, description, item_url, item_link_type, rating
    }));
  }

  if(error&&isMissingColumnError(error,"item_link_type")){
    const legacy={name,notes,description,item_url,rating};
    if(editingItemId)({error}=await sb.from("orders").update(legacy).eq("id",editingItemId));
    else({error}=await sb.from("orders").insert({restaurant_id:selectedRestaurantId,...legacy}));
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

$("findItemDetailsBtn").addEventListener("click", async () => {
  const restaurant=data.find(x=>x.id===selectedRestaurantId);
  const itemName=$("itemNameInput").value.trim();
  const status=$("findItemDetailsStatus");
  if(!restaurant)return showToast("Choose a restaurant first.");
  if(!itemName){status.textContent="Enter the item name first.";status.classList.remove("hidden");$("itemNameInput").focus();return;}
  const button=$("findItemDetailsBtn");button.disabled=true;button.textContent="✨ Looking through the menu…";
  $("findItemSuggestions").classList.add("hidden");$("findItemSuggestions").innerHTML="";
  status.textContent="Searching for this item and the best available link…";status.classList.remove("hidden");
  try{
    const {data:{session}}=await sb.auth.getSession();
    const activeMenu=normalizeSearchName(selectedDiscoveredRestaurant?.name||"")===normalizeSearchName(restaurant.name)?safeUrl(selectedDiscoveredRestaurant?.menuUrl||""):"";
    const lookupWebsite=activeMenu||safeUrl(restaurant.website_url||"");
    const lookupLinkType=activeMenu?"menu":restaurant.website_link_type||"restaurant";
    const response=await fetch(`${SUPABASE_URL}/functions/v1/lookup-item`,{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY,"Authorization":`Bearer ${session?.access_token||SUPABASE_PUBLISHABLE_KEY}`},body:JSON.stringify({restaurantName:restaurant.name,restaurantLocation:restaurant.location||"",website:lookupWebsite,websiteLinkType:lookupLinkType,itemName})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Item lookup failed.");
    const label=result.linkType==="item"?"direct item link":result.linkType==="menu"?"full menu link":"restaurant website";
    if(result.foundOnMenu){
      const matchedName=String(result.matchedName||itemName).trim();
      pendingItemLookupMatch={...result,matchedName};
      status.textContent="Did you mean this menu item?";
      $("findItemSuggestions").innerHTML=`<button type="button" data-confirm-item-match="true">${foodEmoji(matchedName)} ${escapeHtml(matchedName)}${result.description?`<span class="matched-item-description">${escapeHtml(result.description)}</span>`:""}</button>`;
      $("findItemSuggestions").classList.remove("hidden");
    }else if(Array.isArray(result.suggestions)&&result.suggestions.length){
      status.textContent="The name wasn't an exact menu match. Did you mean:";
      $("findItemSuggestions").innerHTML=result.suggestions.map(name=>`<button type="button" data-item-suggestion="${escapeHtml(name)}">${foodEmoji(name)} ${escapeHtml(name)}</button>`).join("");$("findItemSuggestions").classList.remove("hidden");
    }else status.textContent=`The exact item description wasn't available in the readable menu. ${result.url?`A ${label} is available after a confirmed match.`:"You can enter details manually."}`;
  }catch(error){console.error(error);status.textContent=error.message||"Couldn't find item details.";}
  finally{button.disabled=false;button.textContent="✨ Find item details";}
});

$("findItemSuggestions").addEventListener("click",e=>{
  const confirmed=e.target.closest("[data-confirm-item-match]");
  if(confirmed&&pendingItemLookupMatch){
    const result=pendingItemLookupMatch;$("itemNameInput").value=result.matchedName;
    if(result.description)$("itemDescriptionInput").value=result.description;
    if(safeUrl(result.url)){$("itemUrlInput").value=safeUrl(result.url);$("itemLinkTypeInput").value=["item","menu","restaurant"].includes(result.linkType)?result.linkType:"restaurant";}
    $("findItemDetailsStatus").textContent=`✓ Matched to ${result.matchedName}. Review the details before saving.`;
    $("findItemSuggestions").classList.add("hidden");pendingItemLookupMatch=null;return;
  }
  const button=e.target.closest("[data-item-suggestion]");if(!button)return;$("itemNameInput").value=button.dataset.itemSuggestion;$("findItemDetailsBtn").click();
});

function renderRateButtons(value) {
  const rating = Number(value) || 0;
  document.querySelectorAll("[data-rate-value]").forEach(button => {
    button.classList.toggle("active", Number(button.dataset.rateValue) <= rating);
  });
}

async function saveItemRating(value) {
  if (!currentUser || !ratingItemId) return;
  setLoading(true, value ? "Saving your rating…" : "Clearing your rating…");
  const { error } = await sb.from("orders").update({ rating: value || null }).eq("id", ratingItemId);
  if (error) { setLoading(false); return showToast("Couldn't save rating."); }
  $("rateItemDialog").close();
  await loadData(); render(); renderRestaurantSheet(); setLoading(false);
  showToast(value ? `${value} star${value===1?"":"s"} saved ⭐` : "Rating cleared");
}

$("rateItemStars").addEventListener("click", e => {
  const button=e.target.closest("[data-rate-value]");
  if(button)saveItemRating(Number(button.dataset.rateValue));
});
$("clearItemRatingBtn").addEventListener("click",()=>saveItemRating(null));

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

sb.auth.onAuthStateChange(async (event, session) => {
  currentUser = session?.user ?? null;
  await refreshAdminStatus();
  render();
  if(event==="PASSWORD_RECOVERY")setTimeout(()=>{if(!$("resetPasswordDialog").open)$("resetPasswordDialog").showModal();},0);
});


$("openDiscoverBtn").addEventListener("click",openDiscover);
$("closeDiscoverBtn").addEventListener("click",()=>{$("discoverDialog").close();invalidateTopPicks();});
$("closeDiscoveredRestaurantBtn").addEventListener("click",()=>{$("discoveredRestaurantDialog").close();invalidateTopPicks();if(discoveredReturnTarget==="saved"){$("restaurantDialog").showModal();renderRestaurantSheet();}else $("discoverDialog").showModal();});
$("dismissDiscoveredRestaurantBtn").addEventListener("click",()=>{$("discoveredRestaurantDialog").close();invalidateTopPicks();});
$("restaurantSearchBtn").addEventListener("click",()=>searchRestaurants());
$("restaurantSearchInput").addEventListener("keydown",e=>{if(e.key==="Enter")searchRestaurants();});
$("savedTopPicksBtn").addEventListener("click",openSavedRestaurantTopPicks);
$("restaurantZipInput").addEventListener("input",e=>{e.target.value=e.target.value.replace(/\D/g,"").slice(0,5);});
$("restaurantZipInput").addEventListener("keydown",e=>{if(e.key==="Enter")searchRestaurants();});
$("restaurantRadiusInput").addEventListener("input",updateRestaurantRadiusLabel);
$("restaurantSuggestionChips").addEventListener("click",e=>{const btn=e.target.closest("[data-suggestion]");if(btn)searchRestaurants(btn.dataset.suggestion);});
$("discoverResults").addEventListener("click",e=>{const btn=e.target.closest("[data-discovered-index]");if(btn)openDiscoveredRestaurant(Number(btn.dataset.discoveredIndex));});
$("saveSelectedPicksBtn").addEventListener("click",()=>saveTopPicks(false));
$("saveAllPicksBtn").addEventListener("click",()=>saveTopPicks(true));
$("retryTopPicksBtn").addEventListener("click",loadTopPicks);
$("findDifferentTopPicksBtn").addEventListener("click",()=>{const key=topPicksCacheKey(selectedDiscoveredRestaurant);const seen=[...(topPicksSeenByRestaurant.get(key)||new Set(currentTopPicks.map(pick=>pick.name)))];loadTopPicks({force:true,excludeItems:seen});});
$("pickNewRestaurantBtn").addEventListener("click",pickFromNewRestaurant);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[c]);
}

function safeUrl(value = "") {
  try {
    const url = new URL(String(value).trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function googleMapsSearchUrl(name="",location=""){
  const query=[name,location].map(value=>String(value||"").trim()).filter(Boolean).join(", ");
  return query?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`:"";
}

function isMissingColumnError(error, column) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return message.includes(column.toLowerCase()) && (message.includes("column") || message.includes("schema cache"));
}

function ratingStars(value) {
  const rating = Math.round(Number(value));
  if (rating < 1 || rating > 5) return "";
  return `<div class="rating-stars" aria-label="${rating} out of 5 stars">${"★".repeat(rating)}${"☆".repeat(5-rating)}</div>`;
}

function itemLinkLabel(type) {
  return type === "item" ? "🔗 View item" : type === "menu" ? "📖 View full menu" : "🌐 Restaurant website";
}

function foodEmoji(name = "", category = "") {
  const text = `${name} ${category}`.toLowerCase();
  const choices = [
    [/boba|bubble tea|milk tea|tapioca/, "🧋"], [/coffee|espresso|cappuccino|latte|cafe|café/, "☕"],
    [/bakery|croissant|pastry|bread/, "🥐"], [/smoothie|juice|açaí|acai/, "🥤"],
    [/shrimp|prawn/, "🍤"], [/calamari|squid|seafood|fish/, "🐟"], [/sushi|sashimi|poke/, "🍣"],
    [/ramen|noodle|udon|pho|pasta|spaghetti/, "🍜"], [/dumpling|bao|gyoza|wonton/, "🥟"],
    [/pizza/, "🍕"], [/burger|sandwich/, "🍔"], [/taco|burrito|mexican/, "🌮"],
    [/soup|stew/, "🥣"], [/rice|fried rice/, "🍚"], [/chicken|wing/, "🍗"],
    [/beef|steak/, "🥩"], [/pork|bacon/, "🥓"], [/salad|vegetable|vegan/, "🥗"],
    [/cake|dessert|sweet|cupcake/, "🍰"], [/ice cream|gelato|frozen yogurt/, "🍨"],
    [/barbecue|bbq|grill/, "🍖"], [/hot pot|shabu/, "🍲"], [/indian|curry|thai/, "🍛"],
    [/korean/, "🍲"], [/japanese/, "🍣"], [/filipino/, "🍚"], [/vietnamese/, "🍜"],
    [/bar|cocktail|brewery|wine/, "🍹"], [/breakfast|brunch|egg/, "🍳"],
    [/asian|chinese|taiwanese/, "🥢"], [/italian/, "🍝"]
  ];
  return choices.find(([pattern]) => pattern.test(text))?.[1] || "🍽️";
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js?v=41"));
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
      display_name: currentUser.user_metadata?.display_name || currentUser.email?.split("@")[0] || currentUser.phone || "User",
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
  $("authSwitchBtn").classList.remove("hidden");
  $("authSwitchBtn").textContent = signup
    ? "Already have an account? Sign in"
    : "New here? Create an account";
  $("forgotPasswordBtn").classList.toggle("hidden",signup);

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
  setLoading(true, "Loading your taste profile…");

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
  setLoading(false);
}

async function saveTasteProfileAndFinish() {
  if (!currentUser) return;
  setLoading(true, "Saving your taste profile…");

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
    setLoading(false);
    return;
  }

  const { error: profileError } = await sb
    .from("profiles")
    .update({ onboarding_complete: true })
    .eq("user_id", currentUser.id);

  if (profileError) {
    console.error(profileError);
    showToast("Couldn't finish onboarding.");
    setLoading(false);
    return;
  }

  $("onboardingDialog").close();
  setLoading(false);
  showToast("Taste profile saved");
}

async function signOutCurrentUser() {
  await sb.auth.signOut();
  currentUser = null;
  isAdmin = false;
  editMode = false;
  data = [];
  currentAvatarId="avatar-1";
  if ($("accountDialog").open) $("accountDialog").close();
  render();
  openAuthDialog("signin");
}

function openAccountDialog() {
  if (!currentUser) {
    openAuthDialog("signin");
    return;
  }
  $("accountEmail").textContent = currentUser.phone || currentUser.email || "";
  renderAvatarPicker();
  $("accountDialog").showModal();
}



window.addEventListener("DOMContentLoaded", () => {
  const oldAccountBtn = $("editModeBtn");
  if (oldAccountBtn) {
    const fresh = oldAccountBtn.cloneNode(true);
    oldAccountBtn.replaceWith(fresh);
    renderAccountButton();
    fresh.addEventListener("click", openAccountDialog);
  }

  $("authForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    setLoading(true, authMode === "signup" ? "Creating your account…" : "Signing you in…");

    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const displayName = $("authDisplayName").value.trim();
    const errorBox = $("authError");
    errorBox.classList.add("hidden");

    let authData,error;
    if(authMode==="signup")({data:authData,error}=await sb.auth.signUp({email,password,options:{data:{display_name:displayName||email.split("@")[0]}}}));
    else({data:authData,error}=await sb.auth.signInWithPassword({email,password}));

    if(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden");setLoading(false);return;}
    if(authMode==="signup"&&!authData.session){errorBox.textContent="Check your email to confirm your account, then come back and sign in.";errorBox.classList.remove("hidden");setLoading(false);return;}
    currentUser=authData.user;isAdmin=true;await ensureProfile();await loadUserAvatar();$("authDialog").close();await loadData();render();await maybeStartOnboarding();
    setLoading(false);
  });

  $("authSwitchBtn")?.addEventListener("click", () => {
    openAuthDialog(authMode === "signup" ? "signin" : "signup");
  });

  $("forgotPasswordBtn")?.addEventListener("click",async()=>{
    const email=$("authEmail").value.trim();const errorBox=$("authError");errorBox.classList.add("hidden");
    if(!email){errorBox.textContent="Enter your email address first.";errorBox.classList.remove("hidden");$("authEmail").focus();return;}
    setLoading(true,"Sending your reset link…");
    const redirectTo=`${window.location.origin}${window.location.pathname}`;
    const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo});
    setLoading(false);
    if(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden");return;}
    errorBox.textContent="If an account uses that email, a password-reset link is on its way. Check your inbox and spam folder.";errorBox.classList.remove("hidden");
  });

  $("resetPasswordForm")?.addEventListener("submit",async e=>{
    e.preventDefault();const password=$("newPasswordInput").value;const confirmation=$("confirmNewPasswordInput").value;const errorBox=$("resetPasswordError");errorBox.classList.add("hidden");
    if(password!==confirmation){errorBox.textContent="The passwords do not match.";errorBox.classList.remove("hidden");return;}
    setLoading(true,"Updating your password…");const {error}=await sb.auth.updateUser({password});setLoading(false);
    if(error){errorBox.textContent=error.message;errorBox.classList.remove("hidden");return;}
    $("resetPasswordDialog").close();$("newPasswordInput").value="";$("confirmNewPasswordInput").value="";showToast("Password updated");
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

  $("avatarPicker")?.addEventListener("click",e=>{const button=e.target.closest("[data-avatar-id]");if(button)chooseAvatar(button.dataset.avatarId);});

  $("signOutUserBtn")?.addEventListener("click", signOutCurrentUser);
  $("closeAccountBtn")?.addEventListener("click", () => $("accountDialog").close());
});
