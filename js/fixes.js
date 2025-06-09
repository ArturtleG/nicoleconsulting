// js/fixes.js

console.log("fixes.js loaded");

/**
 * Once we find a <trix-editor> in the DOM, attach a copy‐interceptor to it.
 * We use a small interval timer so we don’t miss it if Trix initializes a bit later.
 */
(function waitForTrixEditor() {
  const editor = document.querySelector("trix-editor");
  if (!editor) {
    // Try again in 100ms
    setTimeout(waitForTrixEditor, 100);
    return;
  }

  console.log("► <trix-editor> found; attaching copy listener");

  editor.addEventListener("copy", function (event) {
    console.log("► copy event inside <trix-editor> detected");

    // 1) Grab the current Selection
    const sel = window.getSelection();
    if (!sel.rangeCount) {
      console.log("    → nothing selected, skipping cleanup");
      return;
    }

    // 2) Clone the selected nodes into a temporary container
    const range = sel.getRangeAt(0);
    const frag = range.cloneContents();
    const tempDiv = document.createElement("div");
    tempDiv.appendChild(frag);
    let html = tempDiv.innerHTML;
    //console.log("    → raw selected HTML:", html);

    // 3) Remove every <figure>…</figure> block (case‐insensitive)
    if (html.includes("<figure")) {
      html = html.replace(/<figure[\s\S]*?<\/figure>/gi, "");
      //console.log("    → cleaned HTML (figure removed):", html);
    } else {
      console.log("    → no <figure> found, no cleaning needed");
    }

    // 4) Also grab the plain‐text selection
    const plain = sel.toString();

    // 5) Prevent default copy, then overwrite clipboard with our cleaned data
    event.preventDefault();
    event.clipboardData.clearData();
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData("text/plain", plain);
    console.log("    → clipboard contents overwritten with cleaned HTML + text");
  });
})();
