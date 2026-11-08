(function () {
  "use strict";

  var messagesEl = document.getElementById("messages");
  var emptyEl = document.getElementById("empty");
  var form = document.getElementById("composer");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var newBtn = document.getElementById("new-eval");
  var viewBtn = document.getElementById("view-prompt");
  var dialog = document.getElementById("prompt-dialog");
  var promptText = document.getElementById("prompt-text");
  var copyBtn = document.getElementById("copy-prompt");
  var closeBtn = document.getElementById("close-prompt");

  var history = []; // [{role, content}] kept in memory only
  var streaming = false;
  var controller = null;

  function renderMarkdown(text) {
    var html = window.marked.parse(text, { gfm: true, breaks: false });
    return window.DOMPurify.sanitize(html);
  }

  function scrollToBottom() {
    window.scrollTo({ top: document.documentElement.scrollHeight });
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
    var el = document.createElement("div");
    el.className = "msg assistant";
    var bubble = document.createElement("div");
    bubble.className = "bubble md";
    bubble.textContent = "...";
    el.appendChild(bubble);
    messagesEl.appendChild(el);
    scrollToBottom();
    return { el: el, bubble: bubble };
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
    if (!on) input.focus();
  }

  function wrapTables(bubble) {
    var tables = bubble.querySelectorAll("table");
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      if (t.parentNode && t.parentNode.className === "table-wrap") continue;
      var wrap = document.createElement("div");
      wrap.className = "table-wrap";
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    }
  }

  async function send(text) {
    history.push({ role: "user", content: text });
    var userEl = addUserBubble(text);
    var ui = addAssistantBubble();
    setStreaming(true);

    var accumulated = "";
    var pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        ui.bubble.innerHTML = renderMarkdown(accumulated);
        wrapTables(ui.bubble);
        scrollToBottom();
      }, 60);
    }

    function failTurn(message) {
      history.pop();
      input.value = text;
      ui.el.remove();
      userEl.classList.add("failed");
      showError(message);
    }

    try {
      var res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
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
              ui.bubble.textContent = "Thinking…";
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

      ui.bubble.innerHTML = renderMarkdown(accumulated || "(No response received.)");
      wrapTables(ui.bubble);
      scrollToBottom();

      if (accumulated) {
        history.push({ role: "assistant", content: accumulated });
      } else {
        failTurn("The AI service returned an empty response. Please try again.");
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
      failTurn("Network error. Check your connection and try again.");
    } finally {
      setStreaming(false);
    }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (streaming) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    send(text);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  newBtn.addEventListener("click", function () {
    if (streaming) return;
    history = [];
    messagesEl.querySelectorAll(".msg").forEach(function (n) { n.remove(); });
    emptyEl.hidden = false;
    input.value = "";
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
})();
