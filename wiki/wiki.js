/* HexSeal wiki: search, tags and bookmarks, all in the browser.
   Bookmarks live in localStorage on this device only; nothing is sent anywhere. */
(function () {
  "use strict";

  var INDEX = window.HEXHOLD_INDEX || [];
  var BM_KEY = "hexhold-wiki-bookmarks";

  // ---------- bookmarks ----------

  function loadBookmarks() {
    try { return JSON.parse(localStorage.getItem(BM_KEY)) || []; } catch (e) { return []; }
  }
  function saveBookmarks(list) {
    try { localStorage.setItem(BM_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
  }
  function isMarked(href) {
    return loadBookmarks().some(function (b) { return b.href === href; });
  }
  function toggleMark(entry) {
    var list = loadBookmarks();
    var i = list.findIndex(function (b) { return b.href === entry.href; });
    if (i >= 0) list.splice(i, 1); else list.unshift(entry);
    saveBookmarks(list);
    return i < 0;
  }

  function wireStars() {
    var page = document.body.getAttribute("data-page");
    if (!page) return;
    var pageTitle = document.body.getAttribute("data-title");
    document.querySelectorAll("button.star").forEach(function (btn) {
      var anchor = btn.getAttribute("data-bm");
      var href = page + ".html" + anchor;
      var title = pageTitle;
      if (anchor) {
        var h = btn.parentElement.cloneNode(true);
        h.querySelectorAll("button").forEach(function (b) { b.remove(); });
        title = pageTitle + " › " + h.textContent.trim();
      }
      var big = !anchor;
      function paint(on) {
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.textContent = big ? (on ? "★ Bookmarked" : "☆ Bookmark") : (on ? "★" : "☆");
      }
      paint(isMarked(href));
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        paint(toggleMark({ href: href, title: title }));
      });
    });
  }

  function renderBookmarks() {
    var ul = document.getElementById("bm-list");
    if (!ul) return;
    var list = loadBookmarks();
    ul.innerHTML = "";
    document.getElementById("bm-empty").hidden = list.length > 0;
    list.forEach(function (b) {
      var li = document.createElement("li");
      li.style.display = "flex";
      li.style.alignItems = "center";
      var a = document.createElement("a");
      a.className = "hit";
      a.style.flex = "1";
      a.href = b.href;
      a.innerHTML = '<span class="hit-title"></span>';
      a.firstChild.textContent = b.title;
      var x = document.createElement("button");
      x.className = "star star-sm";
      x.style.opacity = "1";
      x.setAttribute("aria-label", "Remove bookmark");
      x.setAttribute("aria-pressed", "true");
      x.textContent = "★";
      x.addEventListener("click", function () {
        toggleMark(b);
        renderBookmarks();
      });
      li.appendChild(a);
      li.appendChild(x);
      ul.appendChild(li);
    });
  }

  // ---------- search ----------

  function norm(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function terms(q) {
    return norm(q).split(/[^a-z0-9']+/).filter(function (t) { return t.length > 0; });
  }
  function hasWord(text, t) {
    // Match at the start of a word, so "rose" finds "rosette" but "tte" does not.
    var re = new RegExp("(^|[^a-z0-9])" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return re.test(text);
  }

  function score(doc, ts) {
    var title = norm(doc.title), summary = norm(doc.summary), tags = doc.tags.join(" ");
    var total = 0, best = null, bestScore = 0;
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i], s = 0;
      if (hasWord(title, t)) s += 12;
      if (hasWord(tags, t)) s += 8;
      if (hasWord(summary, t)) s += 4;
      doc.headings.forEach(function (h) { if (hasWord(norm(h.text), t)) s += 3; });
      var inBody = false;
      doc.sections.forEach(function (sec) { if (hasWord(norm(sec.text), t)) { s += 1; inBody = true; } });
      if (s === 0) return null; // every word must match somewhere
      total += s;
    }
    // Deep link to the section that matches the most words.
    doc.sections.forEach(function (sec) {
      var n = norm(sec.text), c = 0;
      ts.forEach(function (t) { if (hasWord(n, t)) c++; });
      doc.headings.forEach(function (h) {
        if (h.id === sec.id) ts.forEach(function (t) { if (hasWord(norm(h.text), t)) c += 2; });
      });
      if (c > bestScore) { bestScore = c; best = sec; }
    });
    return { doc: doc, score: total, section: best };
  }

  function snippet(text, ts) {
    var n = norm(text), at = -1;
    for (var i = 0; i < ts.length && at < 0; i++) {
      var m = n.search(new RegExp("(^|[^a-z0-9])" + ts[i]));
      if (m >= 0) at = m;
    }
    if (at < 0) at = 0;
    var start = Math.max(0, at - 60);
    var s = (start > 0 ? "…" : "") + text.slice(start, start + 180) + (start + 180 < text.length ? "…" : "");
    return s;
  }

  function highlight(el, text, ts) {
    var re = new RegExp("(^|[^A-Za-z0-9])(" + ts.map(function (t) {
      return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("|") + ")", "gi");
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      var s = m.index + m[1].length;
      el.appendChild(document.createTextNode(text.slice(last, s)));
      var mk = document.createElement("mark");
      // Extend the mark to the end of the word.
      var end = s + m[2].length;
      while (end < text.length && /[A-Za-z0-9]/.test(text[end])) end++;
      mk.textContent = text.slice(s, end);
      el.appendChild(mk);
      last = end;
      re.lastIndex = end;
    }
    el.appendChild(document.createTextNode(text.slice(last)));
  }

  function headingText(doc, id) {
    var h = doc.headings.find(function (x) { return x.id === id; });
    return h ? h.text : "";
  }

  var activeTag = null;

  function run(q) {
    var wrap = document.getElementById("results-wrap");
    var ul = document.getElementById("results");
    var browse = document.getElementById("browse");
    var ts = terms(q);
    if (!ts.length && !activeTag) {
      wrap.hidden = true;
      browse.hidden = false;
      return;
    }
    var hits = [];
    INDEX.forEach(function (doc) {
      if (activeTag && doc.tags.indexOf(activeTag) < 0) return;
      if (!ts.length) { hits.push({ doc: doc, score: 0, section: null }); return; }
      var r = score(doc, ts);
      if (r) hits.push(r);
    });
    hits.sort(function (a, b) { return b.score - a.score; });

    var title = document.getElementById("results-title");
    var label = ts.length ? "“" + q.trim() + "”" : "";
    if (activeTag) label += (label ? " in " : "Tagged ") + "#" + activeTag;
    title.textContent = hits.length + (hits.length === 1 ? " result" : " results") + (label ? " for " + label : "");

    ul.innerHTML = "";
    if (!hits.length) {
      var li = document.createElement("li");
      li.className = "empty";
      li.style.padding = ".5rem 0";
      li.textContent = "Nothing matched. Try fewer words, or a tag below.";
      ul.appendChild(li);
    }
    hits.forEach(function (h) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.className = "hit";
      var sec = h.section;
      a.href = h.doc.slug + ".html" + (sec && sec.id ? "#" + sec.id : "");
      var t = document.createElement("span");
      t.className = "hit-title";
      t.textContent = h.doc.title;
      a.appendChild(t);
      var where = sec && sec.id ? headingText(h.doc, sec.id) : h.doc.section;
      var w = document.createElement("span");
      w.className = "hit-where";
      w.textContent = "  " + where;
      a.appendChild(w);
      var sn = document.createElement("span");
      sn.className = "hit-snip";
      var text = ts.length && sec ? snippet(sec.text, ts) : h.doc.summary;
      if (ts.length) highlight(sn, text, ts); else sn.textContent = text;
      a.appendChild(sn);
      li.appendChild(a);
      ul.appendChild(li);
    });
    wrap.hidden = false;
    browse.hidden = true;
  }

  function renderTags() {
    var cloud = document.getElementById("tag-cloud");
    if (!cloud) return;
    var counts = {};
    INDEX.forEach(function (d) { d.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    Object.keys(counts).sort().forEach(function (t) {
      var b = document.createElement("button");
      b.className = "tag" + (t === activeTag ? " on" : "");
      b.type = "button";
      b.textContent = t;
      b.title = counts[t] + (counts[t] === 1 ? " page" : " pages");
      b.addEventListener("click", function () {
        activeTag = activeTag === t ? null : t;
        syncUrl();
        cloud.querySelectorAll(".tag").forEach(function (x) {
          x.classList.toggle("on", x.textContent === activeTag);
        });
        run(document.getElementById("q").value);
      });
      cloud.appendChild(b);
    });
  }

  function syncUrl() {
    var q = document.getElementById("q").value.trim();
    var p = new URLSearchParams();
    if (q) p.set("q", q);
    if (activeTag) p.set("tag", activeTag);
    var s = p.toString();
    history.replaceState(null, "", s ? "?" + s : location.pathname + location.hash);
  }

  function wireHome() {
    var input = document.getElementById("q");
    if (!input) return;
    var params = new URLSearchParams(location.search);
    activeTag = params.get("tag");
    input.value = params.get("q") || "";
    renderTags();
    if (activeTag) document.getElementById("tag-box").open = true;
    renderBookmarks();
    var timer;
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { syncUrl(); run(input.value); }, 80);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = document.querySelector("#results a.hit");
        if (first) location.href = first.href;
      }
    });
    run(input.value);
    if (!input.value && !activeTag && !location.hash && window.matchMedia("(min-width: 700px)").matches) input.focus();
  }

  wireStars();
  wireHome();
})();
