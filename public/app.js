(function () {
  "use strict";

  var messagesEl = document.getElementById("messages");
  var emptyEl = document.getElementById("empty");
  var form = document.getElementById("composer");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var stopBtn = document.getElementById("stop");
  var counterEl = document.getElementById("counter");
  var newBtn = document.getElementById("new-eval");
  var viewBtn = document.getElementById("view-prompt");
  var dialog = document.getElementById("prompt-dialog");
  var promptText = document.getElementById("prompt-text");
  var copyBtn = document.getElementById("copy-prompt");
  var closeBtn = document.getElementById("close-prompt");

  var LIMIT = 40000;
  var history = []; // [{role, content}] kept in memory only
  var streaming = false;
  var controller = null;

  var MARK_SVG =
    '<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" focusable="false">' +
    '<rect width="32" height="32" rx="9" fill="#E31837"/>' +
    '<path d="M16 6.5 24.5 9.6v6.2c0 4.8-3.4 8.2-8.5 9.9-5.1-1.7-8.5-5.1-8.5-9.9V9.6L16 6.5Z" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="m11.9 16.2 3 3 5.4-5.8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var COPY_SVG =
    '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function renderMarkdown(text) {
    var html = window.marked.parse(text, { gfm: true, breaks: false });
    return window.DOMPurify.sanitize(html);
  }

  function scrollToBottom() {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }

  function setTyping(bubble, label) {
    bubble.textContent = "";
    var wrap = document.createElement("span");
    wrap.className = "typing";
    if (label) {
      var t = document.createElement("span");
      t.className = "typing-label";
      t.textContent = label;
      wrap.appendChild(t);
    } else {
      wrap.setAttribute("role", "status");
      wrap.setAttribute("aria-label", "Evaluating");
    }
    for (var i = 0; i < 3; i++) wrap.appendChild(document.createElement("i"));
    bubble.appendChild(wrap);
  }

  function addUserBubble(text) {
    emptyEl.hidden = true;
    var el = document.createElement("div");
    el.className = "msg user";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    el.appendChild(bubble);
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function addAssistantBubble() {
    var el = document.createElement("article");
    el.className = "msg assistant";
    var card = document.createElement("div");
    card.className = "card";
    var head = document.createElement("div");
    head.className = "card-head";
    var avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.innerHTML = MARK_SVG;
    var name = document.createElement("span");
    name.className = "card-name";
    name.textContent = "Evaluation agent";
    head.appendChild(avatar);
    head.appendChild(name);
    var bubble = document.createElement("div");
    bubble.className = "bubble md";
    setTyping(bubble);
    var note = document.createElement("p");
    note.className = "wait-note";
    note.setAttribute("role", "status");
    note.textContent = "Full evaluations can take a few minutes.";
    card.appendChild(head);
    card.appendChild(note);
    card.appendChild(bubble);
    el.appendChild(card);
    messagesEl.appendChild(el);
    scrollToBottom();
    return { el: el, card: card, bubble: bubble, note: note };
  }

  function addCopyAction(ui, rawText) {
    var bar = document.createElement("div");
    bar.className = "card-actions";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn quiet";
    btn.setAttribute("aria-label", "Copy reply as Markdown");
    btn.innerHTML = COPY_SVG + "<span>Copy</span>";
    var span = btn.querySelector("span");
    btn.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(rawText);
        span.textContent = "Copied";
      } catch (e) {
        span.textContent = "Copy failed";
      }
      setTimeout(function () { span.textContent = "Copy"; }, 1800);
    });
    bar.appendChild(btn);
    ui.card.appendChild(bar);
  }

  function showError(message) {
    var el = document.createElement("div");
    el.className = "msg error";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.setAttribute("role", "alert");
    bubble.textContent = message;
    el.appendChild(bubble);
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function setStreaming(on) {
    streaming = on;
    sendBtn.disabled = on;
    input.disabled = on;
    stopBtn.hidden = !on;
    sendBtn.hidden = on;
    messagesEl.setAttribute("aria-busy", on ? "true" : "false");
    if (!on) input.focus();
  }

  function updateCounter() {
    var n = input.value.length;
    if (n < 30000) {
      counterEl.hidden = true;
      counterEl.className = "counter";
      return;
    }
    counterEl.hidden = false;
    counterEl.textContent = n.toLocaleString("en-CA") + " / " + LIMIT.toLocaleString("en-CA");
    counterEl.className = "counter " + (n > LIMIT ? "over" : n >= 38000 ? "warn" : "");
  }

  function autosize() {
    input.style.height = "auto";
    var max = Math.round(window.innerHeight * 0.4);
    var h = Math.min(input.scrollHeight, max);
    input.style.height = h + "px";
    input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
    updateCounter();
  }

  function decorate(bubble) {
    var tables = bubble.querySelectorAll("table");
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (t.parentNode && t.parentNode.className === "table-wrap") continue;
      var wrap = document.createElement("div");
      wrap.className = "table-wrap";
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    }
    var heads = bubble.querySelectorAll("h1, h2, h3, h4");
    for (var j = 0; j < heads.length; j++) {
      if (/verdict/i.test(heads[j].textContent)) heads[j].classList.add("verdict");
    }
  }

  async function send(text) {
    history.push({ role: "user", content: text });
    var userEl = addUserBubble(text);
    var ui = addAssistantBubble();
    controller = new AbortController();
    setStreaming(true);

    var accumulated = "";
    var pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        ui.bubble.innerHTML = renderMarkdown(accumulated);
        decorate(ui.bubble);
        scrollToBottom();
      }, 60);
    }

    function failTurn(message) {
      history.pop();
      input.value = text;
      autosize();
      ui.el.remove();
      userEl.classList.add("failed");
      showError(message);
    }

    function finish() {
      ui.bubble.innerHTML = renderMarkdown(accumulated);
      decorate(ui.bubble);
      scrollToBottom();
      history.push({ role: "assistant", content: accumulated });
      addCopyAction(ui, accumulated);
    }

    try {
      var res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!res.ok) {
        var msg = "Request failed (status " + res.status + ").";
        try {
          var data = await res.json();
          if (data && data.error) msg = data.error;
        } catch (e) { /* keep default */ }
        failTurn(msg);
        return;
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var done = false;

      while (!done) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].replace(/\r$/, "");
          if (line.indexOf("data: ") !== 0) continue;
          var payload = line.slice(6).trim();
          if (payload === "[DONE]") { done = true; break; }
          try {
            var obj = JSON.parse(payload);
            var delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
            if (delta && !accumulated && (delta.reasoning_content || delta.reasoning)) {
              setTyping(ui.bubble, "Thinking…");
            }
            if (delta && typeof delta.content === "string" && delta.content) {
              accumulated += delta.content;
              schedule();
            }
          } catch (e) { /* ignore malformed line */ }
        }
      }
      if (!done && buffer.indexOf("data: ") === 0) {
        var tail = buffer.slice(6).trim();
        if (tail && tail !== "[DONE]") {
          try {
            var o = JSON.parse(tail);
            var d = o.choices && o.choices[0] && o.choices[0].delta;
            if (d && typeof d.content === "string") accumulated += d.content;
          } catch (e) { /* ignore */ }
        }
      }

      if (accumulated) {
        finish();
      } else {
        failTurn("The AI service returned an empty response. Please try again.");
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        // User pressed Stop: keep what arrived, no error.
        if (accumulated) {
          finish();
        } else {
          history.pop();
          input.value = text;
          autosize();
          ui.el.remove();
          userEl.remove();
          if (!messagesEl.querySelector(".msg")) emptyEl.hidden = false;
        }
      } else {
        failTurn("Network error. Check your connection and try again.");
      }
    } finally {
      if (ui.note) ui.note.remove();
      controller = null;
      setStreaming(false);
    }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (streaming) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    autosize();
    send(text);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", autosize);
  window.addEventListener("resize", autosize);

  stopBtn.addEventListener("click", function () {
    if (controller) controller.abort();
  });

  var exampleBtns = document.querySelectorAll(".example");
  Array.prototype.forEach.call(exampleBtns, function (b) {
    b.addEventListener("click", function () {
      input.value = b.getAttribute("data-text") || "";
      autosize();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });

  newBtn.addEventListener("click", function () {
    if (streaming) return;
    history = [];
    messagesEl.querySelectorAll(".msg").forEach(function (n) { n.remove(); });
    emptyEl.hidden = false;
    input.value = "";
    autosize();
    window.scrollTo({ top: 0 });
    input.focus();
  });

  viewBtn.addEventListener("click", async function () {
    promptText.textContent = "Loading...";
    copyBtn.textContent = "Copy";
    dialog.showModal();
    try {
      var res = await fetch("/api/prompt");
      if (!res.ok) throw new Error("status " + res.status);
      promptText.textContent = await res.text();
    } catch (e) {
      promptText.textContent = "Could not load the system prompt.";
    }
  });

  copyBtn.addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(promptText.textContent);
      copyBtn.textContent = "Copied";
    } catch (e) {
      copyBtn.textContent = "Copy failed";
    }
    setTimeout(function () { copyBtn.textContent = "Copy"; }, 1800);
  });

  closeBtn.addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog) dialog.close();
  });

  autosize();
})();
