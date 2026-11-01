/* global Institution */
(() => {
  "use strict";
  if (globalThis.__institutionHelper) return;
  globalThis.__institutionHelper = true;

  const CLICKABLE = 'a, button, input[type="submit"], input[type="button"], [role="button"], [role="option"], mat-option, li[onclick*="selectidp"]';
  let profile = Institution.INSTITUTION;
  let stopped = true;
  let busy = false;
  let pending = false;
  let timer;
  let expiry;
  let searchWakeTimer;
  let federationWakeTimer;
  let searchAttempt = 0;
  let searchAt = 0;
  let observer;
  let flowId;
  let generation = 0;
  let statusNode;
  let badge;
  let pickedInstitution = false;
  let selectedFederation = false;
  let libraryState = {};
  let lastPhase;
  const actions = new Set();
  globalThis.__institutionStatus = () => ({ stopped, busy, scheduled: !!timer, pending, phase: lastPhase, actions: [...actions] });
  let roots = [document];

  function refreshRoots() {
    roots = [document];
    for (let index = 0; index < roots.length; index++) {
      for (const element of roots[index].querySelectorAll("*")) {
        if (element.shadowRoot) {
          roots.push(element.shadowRoot);
          observer?.observe(element.shadowRoot, { childList: true, subtree: true, attributes: true, characterData: true });
        }
      }
    }
  }

  const send = (message) => chrome.runtime.sendMessage(message);
  const label = (element) => (element.innerText || element.getAttribute("aria-label") || element.value || element.textContent?.trim() || element.getRootNode()?.host?.textContent || "").replace(/\s+/g, " ").trim();
  function visible(element) {
    if (!element || element.disabled || element.getAttribute("aria-disabled") === "true" || element.closest("[hidden], [inert]")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }
  const all = (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]).filter(visible);
  const findText = (pattern, selector = CLICKABLE) => all(selector).find((element) => pattern.test(label(element)));

  function setInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    const host = input.getRootNode()?.host;
    if (host && "value" in host && typeof host.value === "string") {
      host.value = value;
      host.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      host.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
  }

  function show(message) {
    if (!badge) {
      badge = document.createElement("div");
      badge.setAttribute("data-in-stitution", "");
      const shadow = badge.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = ':host{all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647}section{display:flex;align-items:center;gap:16px;max-width:360px;padding:13px 16px;border:1px solid #cbded7;border-radius:12px;background:#fff;color:#173e32;box-shadow:0 5px 25px #163b3020;font:13px/1.4 system-ui,sans-serif}strong{display:block;font-size:11px;letter-spacing:.05em;margin-bottom:3px}button{padding:7px 10px;border:1px solid #b5ccc2;border-radius:7px;background:#f2f7f4;color:#173e32;cursor:pointer}button:focus-visible{outline:2px solid #176548;outline-offset:2px}';
      const panel = document.createElement("section");
      panel.setAttribute("aria-label", "Institutional sign-in helper");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `in-stitution · ${profile.shortName}`;
      statusNode = document.createElement("span");
      statusNode.setAttribute("role", "status");
      const stopButton = document.createElement("button");
      stopButton.textContent = "Stop";
      stopButton.addEventListener("click", () => { stop(); void send({ type: "page:stop" }).catch(() => {}); });
      copy.append(title, statusNode);
      panel.append(copy, stopButton);
      shadow.append(style, panel);
      document.documentElement.append(badge);
    }
    if (statusNode.textContent !== message) statusNode.textContent = message;
  }

  function stop() {
    stopped = true;
    generation += 1;
    observer?.disconnect();
    clearTimeout(timer);
    clearTimeout(expiry);
    clearTimeout(searchWakeTimer);
    clearTimeout(federationWakeTimer);
    timer = null;
    expiry = null;
    pending = false;
    badge?.remove();
    badge = null;
  }

  async function phase(name, message) {
    if (stopped) return;
    show(message);
    if (lastPhase !== name) {
      lastPhase = name;
      await send({ type: "page:progress", phase: name });
    }
  }

  async function act(key, element, name = "discovering", destination = null) {
    if (!element || actions.has(key) || stopped) return false;
    const currentGeneration = generation;
    const reply = await send({ type: "page:progress", phase: name, action: true,
      handoff: ["institution:select", "institution:continue", "federation:continue"].includes(key) });
    if (!reply.active || stopped || currentGeneration !== generation) return false;
    actions.add(key);
    const navigation = destination || (key === "provider:menu" && element.tagName === "A" ? element.href : null);
    if (navigation && Institution.parseUrl(navigation) && Institution.isAllowedHop(navigation, { profile, providerId: Institution.providerFor(location.href)?.id }) && (new URL(navigation).origin !== location.origin || new URL(navigation).pathname !== location.pathname)) {
      location.assign(navigation);
      return true;
    }
    if (/^javascript:\s*void\s*\([^)]*\)\s*;?$/i.test(element.getAttribute("href") || "")) {
      element.addEventListener("click", (event) => event.preventDefault(), { once: true });
    }
    element.click();
    schedule();
    return true;
  }

  function institutionInput() {
    return all('input:not([type="hidden"]):not([type="password"]):not([type="submit"])').find((input) => {
      if (["username", "email", "password"].includes(input.name.toLowerCase())) return false;
      const context = [input.id, input.name, input.placeholder, input.getAttribute("aria-label"),
        ...[...(input.labels || [])].map((item) => item.textContent)].join(" ");
      const explicitInstitutionField = input.name === "els_institution" || /^(?:institution|organisation|organization)(?:[_-]?search)?$/i.test(input.name) || /search.*institution|institution.*search/i.test(input.id);
      if (!explicitInstitutionField && /username|user.?name|email|e-mail|password/i.test(context)) return false;
      return /institution|organisation|organization|university|高校|机构|学校|组织|^show\b/i.test(context);
    });
  }

  async function chooseInstitution() {
    const item = all(CLICKABLE).find((element) => Institution.isInstitution(label(element), profile) && label(element).length < 480 &&
      !element.closest('header, nav, [role="navigation"], .at-institution, .mfe-provider-designation-statement__toggle') &&
      !element.getRootNode()?.host?.closest('header, nav, [role="navigation"], .mfe-provider-designation-statement__toggle'));
    const resultState = item ? "matched" : "waiting";
    if (badge && badge.getAttribute("data-institution-result") !== resultState) badge.setAttribute("data-institution-result", resultState);
    if (!item) return false;
    pickedInstitution = await act("institution:select", item, "institution") || pickedInstitution;
    return pickedInstitution;
  }

  async function discovery() {
    await phase("institution", `Selecting ${profile.name}…`);
    const isCarsi = location.hostname === "ds.carsi.edu.cn";
    if (pickedInstitution) {
      const submitPattern = /^(?:登\s*录|log\s*in|sign\s*in|continue|next|submit and continue|go to institution|access through (?:your )?institution|转到机构|下一步|继续|提交并继续)(?:\s*↗)?$/i;
      const submit = all('#shibbolethSelectBtn, button[type="submit"], input[type="submit"]').find((element) => submitPattern.test(label(element))) || findText(submitPattern);
      await act("institution:continue", submit, "institution");
      return;
    }
    if (await chooseInstitution()) { schedule(); return; }
    const matchesOption = (option) => (profile.entityId && option.value === profile.entityId) || Institution.isInstitution(option.text, profile);
    const select = all("select").find((element) => [...element.options].some(matchesOption));
    if (select && !actions.has("institution:native-select")) {
      const currentGeneration = generation;
      const reply = await send({ type: "page:progress", phase: "institution", action: true, handoff: true });
      if (!reply.active || stopped || generation !== currentGeneration) return;
      actions.add("institution:native-select");
      select.value = ([...select.options].find((option) => profile.entityId && option.value === profile.entityId) || [...select.options].find(matchesOption)).value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      pickedInstitution = true;
      schedule();
      return;
    }
    if (isCarsi && document.querySelectorAll('li[onclick*="selectidp"]').length < 200) {
      if (await act("carsi:all", findText(/^(?:全部|all(?: institutions)?)$/i, `${CLICKABLE}, span, label`), "institution")) return;
    }
    const input = institutionInput();
    const preferLocalName = isCarsi || Institution.providerFor(location.href)?.id === "cnki";
    const libraryTerms = Institution.libraryFor(profile).discoveryTerms?.(profile) || [];
    const searchTerms = [...new Set([preferLocalName ? profile.carsiSearchTerm : profile.searchTerm, ...libraryTerms, profile.shortName, ...profile.aliases].filter(Boolean))].slice(0, 4);
    const noResults = all('.zero-results-prompt, .institution-search__no-results, [role="status"], [aria-live]').some((element) => /^(?:0\s+Results|No (?:results|matches|institutions)(?: found)?)[.!]?$/i.test(label(element)));
    const unmatchedResults = all(".institution-finder__results a").length > 0;
    const retrySearch = (noResults || unmatchedResults) && searchAttempt < searchTerms.length && Date.now() - searchAt >= 1000;
    if (input && (!actions.has("institution:search") || retrySearch)) {
      actions.add("institution:search");
      setInput(input, searchTerms[searchAttempt++]);
      searchAt = Date.now();
      input.dispatchEvent(new KeyboardEvent("keyup", { key: input.value.slice(-1), bubbles: true, composed: true }));
      clearTimeout(searchWakeTimer);
      searchWakeTimer = setTimeout(schedule, 1200);
      schedule();
    }
    if (input && actions.has("institution:search")) {
      const search = findText(/^(?:search|find)(?: for)?(?: your| my)? (?:institution|organisation|organization|university|library)$/i);
      await act(`institution:search-submit:${searchAttempt}`, search, "institution");
    }
    if (noResults && searchAttempt >= searchTerms.length) await phase("manual", "The provider returned no matching institution for the configured names. Check your library’s access options.");
  }

  async function clarivate() {
    const federation = all('select[name*="federation" i], select[id*="federation" i], mat-select[formcontrolname="federationName"]').at(0);
    if (!federation) return false;
    if (!profile.federation) { await phase("manual", "Choose your institution’s federation on this page."); return true; }
    const matchesFederation = (text) => text.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase() === profile.federation.toLowerCase();
    await phase("institution", `Selecting ${profile.federation}…`);
    if (federation.tagName === "SELECT" && !selectedFederation) {
      const option = [...federation.options].find((item) => matchesFederation(item.text));
      if (!option) return false;
      if (federation.value !== option.value) {
        federation.value = option.value;
        federation.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        schedule();
      }
      selectedFederation = true;
    } else if (!selectedFederation) {
      const option = all('[role="option"], mat-option').find((item) => matchesFederation(label(item)));
      if (option) selectedFederation = await act("federation:select", option, "institution");
      else if (federation.getAttribute("aria-expanded") !== "true") {
        const attempts = libraryState.federationOpenAttempts || 0;
        if (attempts < 3 && Date.now() - (libraryState.federationOpenedAt || 0) >= 800) {
          libraryState.federationOpenAttempts = attempts + 1;
          libraryState.federationOpenedAt = Date.now();
          const trigger = federation.querySelector(".mat-mdc-select-trigger, .mat-select-trigger") || federation;
          if (await act(`federation:open:${attempts + 1}`, trigger, "institution")) {
            clearTimeout(federationWakeTimer);
            federationWakeTimer = setTimeout(() => { federationWakeTimer = null; schedule(); }, 1000);
          }
        } else if (attempts >= 3) {
          await phase("manual", "Open the institution selector on this page. I’ll continue when its options appear.");
        }
      }
      return true;
    }
    const continueButton = findText(/^(?:go to institution|转到机构|continue)$/i);
    if (continueButton) { await act("federation:continue", continueButton, "institution"); return true; }
    return federation.tagName !== "SELECT";
  }

  function libraryContext(state) {
    const token = generation;
    return { profile, core: Institution, state, all, findText, setInput, send, phase, show, act,
      local: libraryState, current: () => !stopped && generation === token };
  }

  async function directRoute() {
    if (libraryState.routeNavigating) return true;
    if (libraryState.routeCheckedUrl === location.href) return false;
    libraryState.routeCheckedUrl = location.href;
    actions.add("protocol:checked");
    const token = generation;
    const reply = await send({ type: "page:route", url: location.href });
    if (reply.navigating) libraryState.routeNavigating = true;
    return stopped || token !== generation || reply.navigating === true;
  }

  async function provider(state) {
    if (/^(?:just a moment|请稍候|checking your browser|security verification)[.!…\s]*$/i.test(document.title.trim()) || all("#challenge-stage, #challenge-running, #challenge-form").length) {
      await phase("manual", "Complete this site’s browser verification. The helper will continue afterward.");
      return;
    }
    if (/^(?:internal server error|500(?:\s|$)|service unavailable|502 bad gateway|Scopus - (?:Error|Page Not Found)|Web of Science - (?:系统错误|System Error))/i.test(document.title.trim())) {
      await send({ type: "page:provider-error" });
      stop();
      return;
    }
    if (all(".institution-finder__no-access-prompt").some((element) => Institution.isInstitution(label(element), profile) && /unable to provide.{0,100}log in remotely/i.test(label(element)))) {
      await send({ type: "page:remote-unavailable" });
      stop();
      return;
    }
    const cookieReject = all("#onetrust-reject-all-handler")[0] || findText(/^(?:reject all|reject optional cookies|deny all|全部拒绝|拒绝所有)$/i, '[role="dialog"] button, dialog button');
    if (await act("cookies:reject-optional", cookieReject)) {
      actions.delete("provider:menu");
      actions.delete("provider:institutional");
      return;
    }
    const provider = Institution.providerFor(location.href);
    const accessSelector = ({ wos: ".institutional-name", springer: ".app-article-masthead__access", ieee: ".inst-name", elsevier: "#gh-inst-icon-btn.gh-has-institution, [data-testid='current-org']", wiley: ".institution-info-wrapper", cnki: ".ecp_header_unitName", acs: ".at-institution", rsc: ".at-institution", jstor: ".mfe-provider-designation-statement__toggle", taylor: ".institution-image-text" })[provider?.id];
    if ((Institution.isResearchPage(location.href) || state.flow.visitedIdentity) && accessSelector && all(accessSelector).some((element) => Institution.isInstitution(label(element), profile))) {
      await send({ type: "page:access-present" });
      stop();
      return;
    }
    if (await directRoute()) return;
    if (provider?.id === "elsevier" && location.hostname === "id.elsevier.com" && document.title === "Personalize your experience") {
      if (await act("elsevier:skip-personalization", all("#bdd-elsSecondaryBtn").find((element) => /^skip$/i.test(label(element))))) return;
    }
    if (provider?.id === "cnki") {
      if (await act("cnki:off-campus", all(".ecp_schoolVisit")[0], "discovering", "https://fsso.cnki.net/")) return;
      if (await act("cnki:institution-menu", all("#ecpHideUnit")[0])) return;
      if (location.hostname === "fsso.cnki.net" && all(CLICKABLE).some((element) => Institution.isInstitution(label(element), profile))) {
        await discovery();
        return;
      }
    }
    const rememberedInstitution = all(CLICKABLE).find((element) => /^access through\b/i.test(label(element)) && Institution.isInstitution(label(element), profile));
    if (await act("provider:remembered-institution", rememberedInstitution, "institution")) return;
    if (await clarivate()) return;
    if (pickedInstitution || institutionInput() || all('select').some((select) => [...select.options].some((option) => Institution.isInstitution(option.text, profile))) || all('[role="option"], li[onclick*="selectidp"]').some((item) => Institution.isInstitution(label(item), profile))) {
      await discovery();
      return;
    }
    const institutionalPattern = /(?:(?:log\s*in|sign\s*in|access|connect|authenticate).{0,45}(?:institution|organisation|organization|university|library|shibboleth))|(?:institution(?:al)? (?:log\s*in|sign\s*in|access))|^(?:find|choose|select) (?:my|your|an?) (?:institution|library)$|^remote access$|机构登录|机构登陆|校外访问|通过机构|学校登录/i;
    const keyForInstitution = (element) => element && /^(?:find|choose|select)/i.test(label(element)) ? "provider:institution-search" : "provider:institutional";
    const institutionalCandidates = all(CLICKABLE).filter((element) => {
      if (!institutionalPattern.test(label(element)) || actions.has(keyForInstitution(element))) return false;
      const href = element.getAttribute("href");
      const destination = href && !href.startsWith("#") ? Institution.parseUrl(element.href) : null;
      return !(location.pathname === "/institutional-login" && element.tagName === "A" && destination?.origin === location.origin && destination.pathname === location.pathname);
    });
    const institutional = institutionalCandidates.find((element) => ["BUTTON", "INPUT"].includes(element.tagName) || element.getAttribute("role") === "button") || institutionalCandidates[0];
    const institutionKey = keyForInstitution(institutional);
    if (await act(institutionKey, institutional)) {
      await phase("discovering", "Opening institutional sign-in…");
      return;
    }
    // Open only the ordinary sign-in menu; never select personal-account login.
    const login = all(CLICKABLE).find((element) => /^(?:log\s*in(?:\s*(?:\/|or)\s*register)?|sign\s*in|login(?:\s*(?:\/|or)\s*register)?|登录|登陆|access through your institution|institutional access)(?:\s+open menu)?$/i.test(label(element)) &&
      !element.closest("form") && element.getAttribute("type") !== "submit" &&
      !/\/auth\/personal\//i.test(element.getAttribute("href") || ""));
    if (!actions.has("provider:institutional") && !actions.has("provider:institution-search") && await act("provider:menu", login)) return;
    if (provider?.id === "springer") {
      await phase("manual", "Open an article, chapter, or book page and choose ‘Log in via an institution’. Springer’s header login is for personal accounts.");
      return;
    }
    await phase("manual", "Choose institutional sign-in on this page. I’ll continue from there.");
  }

  async function tick() {
    if (stopped) return;
    if (busy) { pending = true; return; }
    busy = true;
    try {
      const state = await send({ type: "page:state" });
      if (!state.ok || !state.active || stopped) { stop(); return; }
      profile = state.flow.profile || Institution.INSTITUTION;
      refreshRoots();
      const kind = Institution.pageKind(location.href, profile);
      if (state.flow.owner === "pack") {
        clearTimeout(expiry);
        if (kind === "identity" || profile.adapterReturnOrigins?.includes(location.origin)) await Institution.libraryFor(profile).identity(libraryContext(state));
        return;
      }
      if (kind === "login") await Institution.libraryFor(profile).login(libraryContext(state));
      else if (kind === "identity") await Institution.libraryFor(profile).identity(libraryContext(state));
      else if (kind === "discovery") {
        if (!(await directRoute())) await discovery();
      }
      else await provider(state);
    } catch (error) {
      globalThis.__institutionLastError = { name: error.name, frames: error.stack?.split("\n").slice(1, 4) };
      void send({ type: "page:error" }).catch(() => {});
      stop();
    }
    finally {
      busy = false;
      if (pending && !stopped) { pending = false; schedule(); }
    }
  }

  function schedule() {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = null; void tick(); }, Institution.LIMITS.debounceMs);
  }

  async function start() {
    const state = await send({ type: "page:state" });
    if (!state.active) { stop(); return; }
    profile = state.flow.profile || Institution.INSTITUTION;
    if (flowId !== state.flow.id || stopped) {
      stop();
      flowId = state.flow.id;
      actions.clear();
      pickedInstitution = false;
      searchAttempt = 0;
      searchAt = 0;
      selectedFederation = false;
      libraryState = {};
      lastPhase = null;
      stopped = false;
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      if (state.flow.owner !== "pack") expiry = setTimeout(stop, Math.max(0, state.flow.expiresAt - Date.now()));
    }
    schedule();
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "page:describe") respond({ url: location.origin + location.pathname });
    if (message.type === "page:route-check") respond({ active: !stopped && flowId === message.flowId, url: location.href });
    if (message.type === "flow:stop") { stop(); respond({ ok: true }); }
    if (message.type === "adapter:handoff" && message.flowId === flowId) { clearTimeout(expiry); respond({ ok: true }); }
    if (message.type === "adapter:notice" && !stopped && message.flowId === flowId && typeof message.message === "string") { show(message.message.slice(0, 240)); respond({ ok: true }); }
    if (message.type === "flow:wake") { void start().catch(stop); respond({ ok: true }); }
  });
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", () => { void start().catch(stop); });
  void start().catch(stop);
})();
