

// 1) IMPORT AUTH, FIRESTORE, AND STORAGE HELPERS
import {
    auth,
    provider,
    db,
    serverTimestamp,
    doc,
    setDoc,
    updateDoc,
    collection,
    getDoc,
    addDoc,
    deleteDoc,
    storage,
    storageRef,
    getStorage,
    uploadBytes,
    uploadBytesResumable,
    getDownloadURL,
    listAll,
    deleteObject,
    query, 
    where, 
    orderBy, 
    getDocs
} from "./firebaseSetup.js";

import {
    signInWithPopup,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js";


// 2) WRAP EVERYTHING IN A JQUERY READY CALLBACK
$(function () {
    // --------------------------------------------------
    // A) AUTHENTICATION: show/hide login vs. admin UI
    // --------------------------------------------------
    const $loginWrapper  = $("#login_wrapper");
    const $blogsWrapper  = $("#blogs_wrapper");
    const $newslettersWrapper  = $("#newsletters_wrapper");
    const $loginButton   = $("#login_button");
    const $displayPostsButton = $("#display_posts_button");
    const $dispayNewslettersButton = $("#display_newsletter_button");

    // Whitelist of allowed admin emails
    const authorizedEmails = [
        "nicole@mcree-ed.consulting",
        "web@mcree-ed.consulting"
    ];

    // “Sign in with Google” button
    $loginButton.on("click", () => {
    signInWithPopup(auth, provider)
        .then(result => {
        const user = result.user;
        if (authorizedEmails.includes(user.email)) {
            $newslettersWrapper.show();
            $loginWrapper.hide();
        } else {
            alert("Unauthorized user");
        }
        })
        .catch(error => {
            console.error("Sign-in error:", error);
        });
    });

  // On page load / refresh, show or hide based on auth state
    onAuthStateChanged(auth, user => {
        if (user && authorizedEmails.includes(user.email)) {
            $newslettersWrapper.show();
            $loginWrapper.hide();
        } else {
            $blogsWrapper.hide();
            $newslettersWrapper.hide();
            $loginWrapper.show();
        }
    });

    $displayPostsButton.on("click", () => {
        $("#blogs_wrapper").show();
        $("#newsletters_wrapper").hide();
    });

    $dispayNewslettersButton.on("click", () => {
        $("#blogs_wrapper").hide();
        $("#newsletters_wrapper").show();
    }); 


    // --------------------------------------------------
    // B) IMAGE PREVIEW / DRAG & DROP
    // --------------------------------------------------

    setupFileUpload({
        inputSelector: "#image",
        dropSelector: "#image_drop_area",
        previewSelector: "#image_preview",
        removeButtonSelector: "#remove_cover_button",
        fileFilter: (file) => {
            if (!file.type.startsWith("image/")) {
            alert("Please upload an image file.");
            return false;
            }
            return true;
        },
        previewRenderer: (file, $preview) => {
            const reader = new FileReader();
            reader.onload = (e) => {
            $preview
                .attr("src", e.target.result)
                .show();
            };
            reader.readAsDataURL(file);
        },
    });

    // --------------------------------------------------
    // C) MODAL SHOW/HIDE FOR “NEW POST”
    // --------------------------------------------------
    $("#new_post_button").click(function () {
        // reset the HTML form
        $("#modal_post_form form")[0].reset();
        // clear the trix editor
        //document.querySelector("trix-editor").editor.loadHTML("");
        $("#modal_post_form trix-editor")[0].editor.loadHTML("");

        // hide any old cover-preview
        $("#image_preview").attr("src","").hide();

        // clear any “original-…” data so we know this is truly a CREATE
        $("#modal_post_form")
        .removeClass("hidden")
            .data({
                "original-slug":         null,
                "original-created-at":   null,
                "original-image-url":    null,
                "original-cover-path":   null,
                "hearts":                   0,
                "remove-cover":          false
            });

        // reset headings/buttons
        $("#modal_post_form .form_heading").text("New Post");
        $("#modal_post_form [type='submit']").text("Publish Post");
    });


    // --------------------------------------------------
    // D) FORM SUBMISSION → UPLOAD IMAGE + WRITE FIRESTORE
    // --------------------------------------------------
    $("#post_form").on("submit", async function (event) {
        event.preventDefault();
        $("#statusMsg").text("Publishing…");

        const $modal = $("#modal_post_form");
        const originalSlug       = $modal.data("original-slug")       || null;
        const originalCreatedAt  = $modal.data("original-created-at")  || null;
        const originalImageURL   = $modal.data("original-image-url")   || null;
        const originalImagePath  = $modal.data("original-image-path")  || null;
        const hearts             = $modal.data("hearts") || 0; 
        const removeCover        = !!$modal.data("remove-cover");      // true if user clicked “Remove Cover”

        // 1) Title
        const titleRaw = $("#post_title").val().trim();
        if (!titleRaw) {
            $("#statusMsg").text("Title is required.");
            return;
        }

        // 2) Slug logic
        let baseSlug = $("#post_slug").val().trim();
        baseSlug = baseSlug ? slugify(baseSlug) : slugify(titleRaw);
        const slug = (originalSlug === baseSlug)
            ? originalSlug
            : await ensureUniqueSlug(baseSlug);
        $("#post_slug").val(slug);

        // 3) Tags array
        const tagsRaw = $("#post_tags").val().trim();
        const tags = tagsRaw
            ? tagsRaw.toLowerCase().split(/\s*,\s*/).filter(tag => tag)
            : [];

        // 4) Cover‐image file input
        const coverFile = document.getElementById("image").files[0] || null;
        // where we store all covers
        const coverPath = `posts/${slug}/cover.jpg`;

        let imageURL = null;

        try {
            // 5a) New file chosen → upload it, update URL & path on modal
            if (coverFile) {
                const coverRef = storageRef(storage, coverPath);
                await uploadBytes(coverRef, coverFile);
                imageURL = await getDownloadURL(coverRef);
                $modal
                    .data("original-image-url",  imageURL)
                    .data("original-image-path", coverPath)
                    .removeData("remove-cover");

                // 5b) Editing + “Remove Cover” clicked + had an old cover → delete it
            } else if (originalSlug && removeCover && originalImagePath) {
                await deleteObject(storageRef(storage, originalImagePath));
                imageURL = null;
                $modal.removeData("original-image-url original-image-path remove-cover");

                // 5c) Editing + no new file + didn’t remove → keep old URL
            } else if (originalSlug) {
                imageURL = originalImageURL;
            }

            // 6) Inline Trix attachments: upload any new ones and rewrite their URLs
            const trixEditor   = $("#modal_post_form trix-editor")[0]
            const inlineUploads = [];
            trixEditor.editor.getDocument().getAttachments().forEach(att => {
            if (att.file) {
                const file     = att.file;
                const ext      = file.name.split(".").pop();
                const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                const path     = `posts/${slug}/inline-images/${filename}`;
                const imgRef   = storageRef(storage, path);
                inlineUploads.push(
                uploadBytes(imgRef, file)
                    .then(() => getDownloadURL(imgRef))
                    .then(url => att.setAttributes({ url }))
                    .catch(err => console.error("Inline upload failed:", err))
                );
            }
            });
            await Promise.all(inlineUploads);

            // 7) Grab final HTML
            const contentHtml = $("#content").val();
            if (!contentHtml) {
                $("#statusMsg").text("Content is required.");
                return;
            }

            // 8) Build the Firestore payload
            const postData = {
                title:     titleRaw,
                slug,
                tags,
                content:   contentHtml,
                imageURL,
                createdAt: originalCreatedAt || serverTimestamp(),
                editedAt:  serverTimestamp(),
                hearts
            };

            // 9) Write (or overwrite) the document
            await setDoc(doc(db, "posts", slug), postData);

            // 10) If slug changed, delete the old doc
            if (originalSlug && originalSlug !== slug) {
                await deleteDoc(doc(db, "posts", originalSlug));
            }

            // 11) UI feedback & cleanup
            $("#statusMsg").text("Post saved!");
            this.reset();
            $("#modal_post_form trix-editor")[0].editor.loadHTML("");
            $("#image_preview").attr("src", "").hide();
            $("#remove_cover_button").hide();
            loadPreviousPosts();

            setTimeout(() => {
                $modal.addClass("hidden");
                $("#statusMsg").text("");
            }, 500);

        } catch (error) {
            console.error("Error publishing post:", error);
            $("#statusMsg").text("Error: " + error.message);
        }
    });

    // E) (OPTIONAL) LOAD AND LIST PREVIOUS POSTS
  
    async function loadPreviousPosts(filterTag = null) {
        try {
            const postsCol = collection(db, "posts");
            let q;

            if (filterTag) {
                // only posts whose tags array contains filterTag
                q = query(
                    postsCol,
                    where("tags", "array-contains", filterTag),
                    orderBy("createdAt", "desc")
                );
            } else {
                // all posts
                q = query(postsCol, orderBy("createdAt", "desc"));
            }

            const snapshot = await getDocs(q);
            const $list    = $("#previous_posts");
            $list.empty();

            let postNum = 0;

            snapshot.forEach(docSnap => {
                postNum++;
                const data = docSnap.data();
                const slug = docSnap.id;
                const tags = data.tags || [];

                // build tag buttons
                const tagsHtml = tags
                    .map(tag => `<button 
                                    class="blog_tag_button primary-button" 
                                    data-tag="${tag}">
                                    ${tag}
                                </button>`)
                    .join("");

                const coverImg = data.imageURL
                    ? `<div class="blog_cover_image_wrapper"><img class="blog_cover_image" src="${data.imageURL}" alt=""></div>`
                    : "";

                let month = "", day = "", year = "";

                if (data.createdAt) {
                    const dt = data.createdAt.toDate();
                    month = dt.toLocaleString("en-US", { month: "short" }); // e.g. "Jun"
                    day   = String(dt.getDate()).padStart(2, "0");                        // e.g. "16"
                    year  = dt.getFullYear().toString();                    // e.g. "2025"
                } else {
                // fallback
                    month = day = year = "";
                }

                let rowCol = postNum % 2 === 0 ? "even" : "odd";

                const $post = $(`
                    <section class="${rowCol}">
                        <div class="blog_post_wrapper row white">
                            <div class="blog_header">
                                <div class="blog_date_wrapper">
                                    <div class="blog_month">${month}</div>
                                    <div class="blog_day">${day}</div>
                                    <div class="blog_year">${year}</div>
                                </div>
                                <h2>${data.title}</h2>
                            </div>
                            ${coverImg}
                            <hr>
                            <div class="blog_tags">${tagsHtml}</div>
                            <hr>
                            <div class="blog_content_wrapper">
                                <div class="blog_content">${data.content}</div>
                            </div>
                            <div class="button_wrapper">
                                <button class="edit-post-btn primary-button" data-slug="${slug}">
                                    edit
                                </button>
                                <button class="delete-post-btn primary-button" data-slug="${slug}">
                                    delete
                                </button>
                            </div>
                        </div>

                    </section>
                `);

                $list.append($post);
            });
            return postNum; // return the number of posts loaded

        } catch (err) {
            console.error("Error loading posts:", err);
        }
    }

  
    // Call it once on page load (after auth state is determined)
    loadPreviousPosts();

    //$("#clear_filter").on("click", () => loadPreviousPosts());
     $("#clear_filter").click(function(){
        loadPreviousPosts();
        $(this).fadeOut(800);
    });

    // Open the “are you sure?” modal when any delete‐post button is clicked
    $(document).on("click", ".delete-post-btn", function() {
        const slug  = $(this).data("slug");
        const title = $(this).closest(".blog_post_wrapper").find("h2").text();

        // Populate modal text
        $(".messages_heading").text("Confirm Deletion");
        $(".messages_content").html(`
            Are you sure you want to delete the post 
            <strong>${title}</strong>?<br><br>
            This action cannot be undone.
        `);

        // Turn the “OK” button into “No”
        $("#modal_messages .close_button").text("No");

        // Remove any old confirm button, then inject the new one
        $("#modal_messages .button_wrapper .confirm-button").remove();
        $("#modal_messages .button_wrapper").append(`
            <button id="modal_confirm" type="button" class="primary-button confirm-button">
                Yes
            </button>
        `);

        // Store the slug we're about to delete
        $("#modal_messages").data("slug-to-delete", slug);

        // Show the modal
        $("#modal_messages").removeClass("hidden");
    });

    $(document).on("click", ".edit-post-btn", async function(e) {
        e.preventDefault();

        const slug    = $(this).data("slug");
        const postRef = doc(db, "posts", slug);

        try {
            const snap = await getDoc(postRef);
            if (!snap.exists()) {
                alert("Post not found!");
                return;
            }
            const data = snap.data();

            // 1) Prefill title, slug, tags
            $("#post_title").val(data.title);
            $("#post_slug").val(data.slug);
            $("#post_tags").val(data.tags.join(", "));

            console.log("hearts:", data.hearts);

            // 2) Load Trix editor HTML
            $("#modal_post_form trix-editor")[0].editor.loadHTML(data.content);

            // 3) Show or hide the current cover + remove button
            if (data.imageURL) {
                $("#image_preview").attr("src", data.imageURL).show();
                $("#remove_cover_button").show();
            } else {
                $("#image_preview").hide();
                $("#remove_cover_button").hide();
            }

            // 4) Store everything we need for submit time
            const $modal = $("#modal_post_form");
            $modal
            .data("original-slug",        slug)
            .data("original-created-at",  data.createdAt)
            .data("original-image-url",   data.imageURL || null)
            .data("original-image-path",  data.imageURL ? `posts/${slug}/cover.jpg` : null)
            .data("hearts",               data.hearts || 0) // default to 0 if not set
            .data("remove-cover",         false);

            console.log("Modal data:", $modal.data("hearts"));

            // 5) Update UI text
            $("#modal_post_form .form_heading").text("Edit Post");
            $("#modal_post_form [type='submit']").text("Save Changes");

            // 6) Show the modal
            $modal.removeClass("hidden");

        } catch (err) {
            console.error("Error loading post for edit:", err);
            alert("Could not load post data.");
        }
    });


    $(document).on("click", "#modal_confirm", async function(){
        // Hide the modal immediately
        $("#modal_messages").addClass("hidden");

        // Grab the slug you stored earlier
        const slug = $("#modal_messages").data("slug-to-delete");

        // Call your deletePost function and then refresh the list
        await deletePost(slug);
        loadPreviousPosts();
    });

    $(".close_button").click(function () {
        console.log("Close button clicked");
        $(this).closest(".modal_wrapper").addClass("hidden");
    });

    $("#remove_cover_button").click(function(e){
        e.preventDefault(); 
        
        $("#image").val("");
        
        $("#image_preview").hide();
        $(this).hide();

        $("#modal_post_form").data("remove-cover", true);

    });

    $(document).on("click", ".blog_tag_button", async function() {
        const tag = $(this).data("tag");
        const numPosts = await loadPreviousPosts(tag);
        console.log("filter button fading in");
        $("#clear_filter").text(`${tag} (${numPosts})`).fadeIn(800);
    });

    setupFileUpload({
        inputSelector: "#newsletter_input",
        dropSelector: "#file_drop_area",
        previewSelector: "#file_preview",
        removeButtonSelector: "#remove_file_button",
        fileFilter: (file) => {
            const isPdf =
            file.type === "application/pdf" || /\.pdf$/i.test(file.name);
            if (!isPdf) {
                alert("Please upload a PDF file.");
                return false;
            }
            return true;
        },
        previewRenderer: (file, $preview) => {
            // For PDF, just show filename (or icon + name)
            $preview
            .text(file.name)
            .show();
        },
    });


}); // end of $(function())

$(async function () {
  const $testMode = $("#newsletter_test_mode");

  try {
    const settingsRef = doc(db, "settings", "newsletter");
    const snap = await getDoc(settingsRef);

    let testMode = true; // default: TEST mode
    if (snap.exists()) {
      const data = snap.data() || {};
      if (typeof data.testMode === "boolean") {
        testMode = data.testMode;
      }
    }

    // Set checkbox from Firestore
    $testMode.prop("checked", testMode);

    // Attach handler (next step)
    attachTestModeHandler(settingsRef, $testMode);

  } catch (err) {
    console.error("Failed to load newsletter test mode:", err);
    // Fallback: stay in TEST mode
    $testMode.prop("checked", true);
    const settingsRef = doc(db, "settings", "newsletter");
    attachTestModeHandler(settingsRef, $testMode);
  }
});

function attachTestModeHandler(settingsRef, $testMode) {
  $testMode.on("change", async function () {
    const goingLive = !this.checked; // unchecked = LIVE

    if (goingLive) {
      const input = prompt(
        "To go LIVE, type LIVE below to confirm:"
      );

      if (!input || input.trim() !== "LIVE") {
        alert("Did not type LIVE — remaining in TEST mode.");
        this.checked = true;
        return;
      }

      alert("⚠️ TEST MODE DISABLED\nEmails will be sent LIVE.");
    } else {
      alert("✅ TEST MODE ENABLED\nEmails will be sent ONLY in test mode.");
    }

    const newTestMode = this.checked;

    try {
      await setDoc(
        settingsRef,
        { testMode: newTestMode },
        { merge: true }
      );
      console.log("Newsletter testMode saved:", newTestMode);
    } catch (err) {
      console.error("Failed to save testMode:", err);
      alert("Error saving test mode. Reverting.");
      this.checked = !newTestMode;
    }
  });
}

function processTags(input) {
    let tagHTML = "";
    for (let i = 0; i < input.length; i++) {
        tagHTML += `<button type="button" class="blog_tag_button primary-button">${input[i]}</button>`;
    }
    return tagHTML;
}

// On Title input → update Slug
$("#post_title").on("input", function() {
    const title = $(this).val();
    const autoSlug = slugify(title);
    $("#post_slug").val(autoSlug);
});

// Turn any string into a URL‐friendly slug
function slugify(str) {
  return str
    .normalize("NFKD")                  // strip accents
    .replace(/[^\w\s-]/g, "")           // remove non-word chars
    .trim()                             // trim whitespace
    .toLowerCase()                      // lowercase
    .replace(/[\s_-]+/g, "-")           // collapse spaces/underscores
    .replace(/^-+|-+$/g, "");           // trim leading/trailing hyphens
}

// Given a baseSlug, check Firestore and append "-2", "-3", … until it's free
async function ensureUniqueSlug(baseSlug) {
  let slug = baseSlug;
  let count = 1;
  while (true) {
    const snap = await getDoc(doc(db, "posts", slug));
    if (!snap.exists()) {
      // no document with this slug yet → it’s unique
      return slug;
    }
    count += 1;
    slug = `${baseSlug}-${count}`;
  }
}

/**
 * Deletes a post’s Firestore doc and all its Storage files
 * under posts/{slug}/ (cover + inline images)
 */
async function deletePost(slug) {
    try {
        // 1) Delete Firestore document
        await deleteDoc(doc(db, "posts", slug));

        // 2) Delete all files in the Storage folder for this post
        const folderRef = storageRef(storage, `posts/${slug}`);
        const listResult = await listAll(folderRef);

        // Collect promises for deleting each file
        const deletePromises = listResult.items.map(itemRef =>
            deleteObject(itemRef)
        );

        // Wait for all deletes to complete
        await Promise.all(deletePromises);

        console.log(`Deleted post "${slug}" and its ${deletePromises.length} file(s).`);
    } catch (err) {
        console.error("Error deleting post:", err);
        alert("Failed to delete post: " + err.message);
    }
}


/**** NEWSLETTER ****/

// tiny helper to avoid XSS when inserting text
const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

async function loadContactsAndNewsletters() {
  const $wrapper = $(".contacts_list_wrapper");
  $wrapper.html('<div class="item_row"><div>Loading…</div></div>');

  try {
    // fetch both collections in parallel
    const [contactsSnap, newslettersSnap] = await Promise.all([
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "newsletters_email")),
    ]);

    // Merge into a map keyed by normalized email
    const byEmail = new Map();

    // helper to upsert an entry
    const upsert = ({ name, email, isContact = false, isNewsletter = false, unsubscribed = false }) => {
      if (!email) return;
      const key = email.trim().toLowerCase();

      const existing = byEmail.get(key) || {
        name: "",
        email: key,
        isContact: false,
        isNewsletter: false,
        unsubscribed: false,
      };

      // prefer non-empty name if one source has it
      const nextName = existing.name || name || "";

      byEmail.set(key, {
        name: nextName,
        email: key,
        isContact: existing.isContact || isContact,
        isNewsletter: existing.isNewsletter || isNewsletter,
        // once unsubscribed is true anywhere, keep it true
        unsubscribed: existing.unsubscribed || unsubscribed,
      });
    };

    // contacts collection
    contactsSnap.forEach(doc => {
      const d = doc.data() || {};
      const email = (d.email || doc.id || "").toString();
      const name  = (d.name || "").toString();
      upsert({ name, email, isContact: true });
    });

    // newsletters_email collection
    newslettersSnap.forEach(doc => {
      const d = doc.data() || {};
      const email = (d.email || doc.id || "").toString();
      const name  = (d.name || "").toString();
      // NOTE: read unsubscribed flag from Firestore
      const unsubscribed = !!d.unsubscribed;
      upsert({ name, email, isNewsletter: true, unsubscribed });
    });

    // Sort rows: by name then email (tweak as you like)
    const rows = Array.from(byEmail.values()).sort((a, b) => {
      const an = (a.name || "").toLowerCase();
      const bn = (b.name || "").toLowerCase();
      if (an && bn && an !== bn) return an.localeCompare(bn);
      return a.email.localeCompare(b.email);
    });

    // Render
    if (rows.length === 0) {
      $wrapper.html('<div class="item_row"><div>No contacts yet.</div></div>');
      return;
    }

    const html = rows.map(({ name, email, isContact, isNewsletter, unsubscribed }, i) =>
      `<div class="item_row">
        <div>${escapeHtml(name)}</div>
        <div class="email">${escapeHtml(email)}</div>
        <div class="type_contact_wrapper">
          <div class="subscription ${isContact ? "contact" : ""}"></div>
          <div class="subscription ${isNewsletter ? "newsletter" : ""}"></div>
        </div>
        <label>
          <input 
            type="checkbox" 
            class="subscriber-unsub-toggle"
            data-email="${escapeHtml(email)}"
            ${unsubscribed ? "checked" : ""}
          />
        </label>
      </div>`
    ).join("");

    $wrapper.html(html);

    $("#contact_choice_wrapper input").trigger("change");

  } catch (err) {
    console.error("Failed loading contacts/newsletters:", err);
    $(".contacts_list_wrapper").html(
      `<div class="item_row"><div>Failed to load entries.</div></div>`
    );
  }
}

// call it when the admin page is ready / after auth completes
$(loadContactsAndNewsletters);

$("#contact_choice_wrapper input").on("change", function() {
    console.log("Filter change triggered");
    const showContacts    = $("#contacts_check").is(":checked");
    const showNewsletters = $("#newsletter_check").is(":checked");
    const $allRows = $("#contacts_table_wrapper .item_row:not(.header_row)");

    console.log($allRows.length + " rows found");

    let visibleUsers       = 0;
    let visibleContacts    = 0;
    let visibleNewsletters = 0;
    let visibleIndex       = 0; // for striping

    $allRows.each(function() {
        console.log("Processing a row");
        const $row         = $(this);
        const isContact    = $row.find(".subscription.contact").length > 0;
        const isNewsletter = $row.find(".subscription.newsletter").length > 0;

        const shouldShow =
            (showContacts && isContact) ||
            (showNewsletters && isNewsletter);

        if (shouldShow) {
            $row.show();

            // --- striping on visible rows ---
            $row.removeClass("even_row odd_row");
            const stripeClass = (visibleIndex % 2 === 0) ? "even_row" : "odd_row";
            $row.addClass(stripeClass);
            visibleIndex++;

            // --- visible counters ---
            visibleUsers++;
            if (isContact)    visibleContacts++;
            if (isNewsletter) visibleNewsletters++;
        } else {
            $row.hide();
        }
    });

    // Update your displayed counters using your selectors:
    $(".contact .items_count").text(visibleContacts);
    $(".newsletter .items_count").text(visibleNewsletters);

    // Pick the one that matches your actual HTML:
    // e.g. <span id="total_count" class="items_count"></span>
    $("#total_contacts_count .total_count").text(visibleUsers);
});

$("#copy_addresses_button").on("click", async function() {
    const $email_modal = $("#email_copied_result .small_modal");
    const emails = [];
    $("#contacts_table_wrapper .item_row:not(.header_row):visible").each(function() {
        const email = $(this).find(".email").text().trim();
        if (email && !emails.includes(email)) emails.push(email);
    });

    if (!emails.length) {
        $email_modal.text("No visible emails to copy.");
        $email_modal.parent().fadeIn(200);
        setTimeout(() => $email_modal.parent().fadeOut(800), 2000);
        return;
    }

    const emailString = emails.join(", ");
    //const $btn = $(this);
    //const originalText = $btn.text();

    try {
        await navigator.clipboard.writeText(emailString);
        $email_modal.text(`Copied ${emails.length} emails to clipboard!`);
        $email_modal.parent().fadeIn(200);
        setTimeout(() => $email_modal.parent().fadeOut(800), 2000);
    } catch (err) {
        console.error("Clipboard error:", err);
        alert("Clipboard access failed. Try manually copying.");
    }
});

/*** UPLOAD NEWSLETTERS */

$("#newsletter_open_button").on("click", () => {
    // reset the HTML form
        $("#newsletter_preview_modal form")[0].reset();
        // clear the trix editor
        //document.querySelector("trix-editor").editor.loadHTML("");
        $("#newsletter_preview_modal trix-editor")[0].editor.loadHTML("");

        // hide any old cover-preview
        $("#file_preview").empty().hide();

        // clear data
        $("#newsletter_preview_modal")
        .removeClass("hidden")
        .data({
            mode: "create",
            docId: null,
            originalPath: null,
            originalURL: null,
            originalFilename: null
        });

        // reset headings/buttons
        $("#newsletter_preview_modal .form_heading").text("New Newsletter");
        $("#newsletter_preview_modal [type='submit']").text("Publish Newsletter");
});

// helper: safe filename
const safeName = (name) => name.replace(/[^\w.\-]+/g, "_");

// Handle newsletter form submit (CREATE + EDIT)
$("#newsletter_preview_modal form").on("submit", function (e) {
    e.preventDefault();

    const $modal = $("#newsletter_preview_modal");

    // Are we creating or editing?
    const mode           = $modal.data("mode") || "create";   // "create" or "edit"
    const docId          = $modal.data("docId") || null;
    const originalPath   = $modal.data("originalPath") || null;
    const originalURL    = $modal.data("originalURL") || null;
    const originalName   = $modal.data("originalFilename") || null;

    // 1) Grab values from *inside* the newsletter modal
    const titleRaw = $("#newsletter_preview_modal #newsletter_title").val().trim();
    const title    = titleRaw || "NEWSLETTER";

    const tagsRaw = $("#newsletter_preview_modal #newsletter_tags").val().trim();
    const tags = tagsRaw
        ? tagsRaw.toLowerCase().split(/\s*,\s*/).filter(Boolean)
        : [];

    const sendDateValue = $("#newsletter_send_date").val();


    if (!sendDateValue) {
        alert("Please select a date to send.");
        return;
    }

    const [year, month, day] = sendDateValue.split("-").map(Number);
    const scheduledSendAt    = new Date(year, month - 1, day, 0, 0, 0);

    // Trix writes HTML into the hidden input
    const noteHtml = $("#newsletter_note").val() || "";

    // 2) Get the PDF file from newsletter_input (may be null in EDIT mode)
    const fileInput = document.getElementById("newsletter_input");
    const file = fileInput.files && fileInput.files[0];

    // --- CREATE requires a file, EDIT can reuse existing file ---
    if (!file && mode === "create") {
        alert("Please select a PDF newsletter file.");
        return;
    }

    // If no new file in EDIT mode → just update metadata & bail
    if (!file && mode === "edit" && docId && originalPath && originalURL) {
        setDoc(doc(db, "newsletters_data", docId), {
            kind: "newsletter_pdf",
            title,
            path: originalPath,
            url: originalURL,
            filename: originalName || "newsletter.pdf",
            note: noteHtml,
            tags,
            scheduledSendAt,
            editedAt: serverTimestamp()
        }, { merge: true })
        .then(() => {
            // Clean up UI + reload list
            fileInput.value = "";
            $("#file_preview").empty().hide();
            $("#remove_file_button").hide();
            $("#newsletter_preview_modal trix-editor")[0].editor.loadHTML("");
            $("#newsletter_preview_modal form")[0].reset();
            $modal.addClass("hidden");
            loadNewsletters();
        })
        .catch(err => {
            console.error("Error updating newsletter (no new file):", err);
            alert("Failed to save newsletter changes.");
        });

        return; // IMPORTANT: stop here, no upload
    }

    // 3) From here on, we KNOW we have a new file (create OR edit)
    // Validate PDF and size
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) {
        alert("Please select a valid PDF file.");
        return;
    }

    const MAX_MB = 25;
    if (file.size > MAX_MB * 1024 * 1024) {
        alert(`PDF must be ≤ ${MAX_MB} MB.`);
        return;
    }

    // 4) Build a storage path
    const ts   = Date.now();
    const path = `newsletters/${ts}_${safeName(file.name)}`;
    const fileRef = storageRef(storage, path);

    const metadata = {
        contentType: "application/pdf",
        cacheControl: "public,max-age=31536000,immutable"
    };

    // 5) Start upload with progress
    const task = uploadBytesResumable(fileRef, file, metadata);

    $("#upload_progress").show().val(0);
    $("#upload_status").text("Uploading newsletter…");

    task.on(
        "state_changed",
        (snap) => {
            const pct = Math.round(
                (snap.bytesTransferred / snap.totalBytes) * 100
            );
            $("#upload_progress").val(pct);
            $("#upload_status").text(`Uploading… ${pct}%`);
        },
        (err) => {
            console.error("Upload error:", err);
            $("#upload_status").text("Upload failed.");
            alert("Upload failed. Check console for details.");
            $("#upload_progress").hide().val(0);
        },
        async () => {
            try {
                // 6) Upload done → get URL
                const url = await getDownloadURL(task.snapshot.ref);

                // 7) Save metadata in Firestore (create vs edit)
                if (mode === "edit" && docId) {
                    await setDoc(doc(db, "newsletters_data", docId), {
                        kind: "newsletter_pdf",
                        title,
                        path,
                        url,
                        filename: file.name,
                        note: noteHtml,
                        tags,
                        scheduledSendAt,
                        editedAt: serverTimestamp()
                    }, { merge: true });
                } else {
                    await addDoc(collection(db, "newsletters_data"), {
                        kind: "newsletter_pdf",
                        title,
                        path,
                        url,
                        filename: file.name,
                        note: noteHtml,
                        tags,
                        uploadedAt: serverTimestamp(),
                        scheduledSendAt
                    });
                }

                $("#upload_status").text("Upload complete.").fadeOut(800);
                $("#upload_progress").hide().val(0);

                // 8) Reset form, clear preview, close modal
                fileInput.value = "";
                $("#file_preview").empty().hide();
                $("#remove_file_button").hide();
                $("#newsletter_preview_modal trix-editor")[0].editor.loadHTML("");
                $("#newsletter_preview_modal form")[0].reset();
                $modal.addClass("hidden");

                // 9) Refresh the list of newsletters
                loadNewsletters();

            } catch (error) {
                console.error("Error saving newsletter:", error);
                $("#upload_status").text("Error saving newsletter.");
                alert("Newsletter save failed. Check console for details.");
            }
        }
    );
});

let newsletterRows = [];

// Helper to safely render note HTML as plain text if you ever want that
// (you’re currently trusting `noteHtml`, so leave as-is unless you change that)
function formatDateOrDash(date) {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function loadNewsletters(filterTag = null) {
  const $container = $("#previous_newsletters");
  $container.empty().append("<p>Loading newsletters...</p>");

  try {
    const q = query(
      collection(db, "newsletters_data"),
      orderBy("uploadedAt", "desc")
    );
    const snap = await getDocs(q);

    newsletterRows = [];

    snap.forEach(docSnap => {
      const data = docSnap.data();
      const tags = data.tags || [];

      // optional future filter by tag
      if (filterTag && !tags.includes(filterTag)) return;

      const title    = data.title    || "Untitled";
      const url      = data.url      || "#";
      const filename = data.filename || "Untitled";

      const uploadedAt = data.uploadedAt?.toDate
        ? data.uploadedAt.toDate()
        : null;

      const scheduledSendAt = data.scheduledSendAt?.toDate
        ? data.scheduledSendAt.toDate()
        : null;

      const noteHtml = data.note || "No note";
      const tagsHtml = tags
        .map(tag => `
          <button 
            class="newsletter_tag" 
            data-tag="${tag}">
            ${tag}
          </button>
        `)
        .join("");

      newsletterRows.push({
        id: docSnap.id,
        title,
        url,
        filename,
        uploadedAt,
        scheduledSendAt,
        uploadedAtFormatted: formatDateOrDash(uploadedAt),
        scheduledSendAtFormatted: formatDateOrDash(scheduledSendAt),
        tagsHtml,
        noteHtml,
        path: data.path || null, 
      });
    });

    $container.empty();

    if (!newsletterRows.length) {
      $container.append("<p>No newsletters found.</p>");
      $("#newsletter_total_count").text("0");
      return;
    }

    const html = newsletterRows
        .map((row, index) => {
            //const stripeClass = ""; //index % 2 === 0 ? "even_row" : "odd_row";
            return `
                <div class="row">
                    <div class="newsletter_table_wrapper blob white">
                        <div class="">
                            <div class="item_row header_row">  
                                <div>Title</div>
                                <div>File name</div>
                                <div>Upload Date</div>
                                <div>Release Date</div>
                            </div>
                        </div>
                        <div class="item_row">
                            <a href="${row.url}" target="_blank" class="primary-button newsletter_title item">
                                ${row.title}
                            </a>
                            <div href="${row.url}" class="newsletter_filename item">
                                ${row.filename}
                            </div>
                            <div class="newsletter_date item">
                                ${row.uploadedAtFormatted}
                            </div>
                            <div class="newsletter_date item">
                                ${row.scheduledSendAtFormatted}
                            </div>
                            <div class="note_wrapper">
                                <div class="newsletter_tag_wrapper">
                                    ${row.tagsHtml}
                                </div>
                                <div class="newsletter_note">
                                    ${row.noteHtml}
                                </div>
                                <div class="button_wrapper">
                                    <button 
                                        class="edit-newsletter-btn primary-button" 
                                        data-id="${row.id}" 
                                        data-path="${row.path || ""}">
                                        edit
                                    </button>
                                    <button 
                                        class="delete-newsletter-btn primary-button" 
                                        data-id="${row.id}" 
                                        data-path="${row.path || ""}">
                                        delete
                                    </button>
                                    <button 
                                        class="push-newsletter-btn primary-button" 
                                        data-id="${row.id}" 
                                        data-path="${row.path || ""}">
                                        push
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        })
      .join("");

    $container.html(html);

    // Update total count
    $("#newsletter_total_count .total_count").text(newsletterRows.length);

  } catch (error) {
    console.error("Error loading newsletters:", error);
    $container.html(
      `<p style="color:red;">Error loading newsletters. Check console for details.</p>`
    );
    $("#newsletter_total_count").text("0");
  }
}

// Call on page load or after upload completes
$(document).ready(() => {
  loadNewsletters();
});

// Turn an email into a Firestore-safe doc id
function emailKey(email = "") {
  return email
    .trim()
    .toLowerCase()
    .replace(/[.#$/\[\]]/g, "_"); // Firestore doc-id safe
}

// Super simple HTML -> text
function stripHtml(html = "") {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/***** DELETE NEWSLETTER *****/

$(document).on("click", ".delete-newsletter-btn", async function () {
  const id   = $(this).data("id");
  const path = $(this).data("path") || null;

  if (!id) {
    console.error("No newsletter id on delete button");
    return;
  }

  const ok = window.confirm("Delete this newsletter? This cannot be undone.");
  if (!ok) return;

  try {
    // 1) Delete Firestore doc
    await deleteDoc(doc(db, "newsletters_data", id));

    // 2) Try to delete the file from Storage too (if we know the path)
    if (path) {
      try {
        const fileRef = storageRef(storage, path);
        await deleteObject(fileRef);
      } catch (err) {
        // Non-fatal: doc is gone, file cleanup failed
        console.warn("Failed to delete newsletter file from Storage:", err);
      }
    }

    // 3) Reload list
    await loadNewsletters();

  } catch (err) {
    console.error("Error deleting newsletter:", err);
    alert("Failed to delete newsletter. Check console for details.");
  }
});

/***** EDIT */

$(document).on("click", ".edit-newsletter-btn", async function () {
    const id   = $(this).data("id");
    const path = $(this).data("path") || null;

    if (!id) return console.error("Missing doc ID for edit.");

    try {
        const docRef = doc(db, "newsletters_data", id);
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
            alert("Newsletter not found.");
            return;
        }

        const data = snap.data();

        const $modal = $("#newsletter_preview_modal");

        // Populate fields
        $("#newsletter_title").val(data.title || "");
        $("#newsletter_tags").val((data.tags || []).join(", "));
        $("#newsletter_preview_modal trix-editor")[0].editor.loadHTML(data.note || "");

        // Show existing file name in preview (not changing the file until user uploads)
        if (data.filename) {
            $("#file_preview")
                .text(data.filename)
                .show();
            $("#remove_file_button").show();
        } else {
            $("#file_preview").empty().hide();
            $("#remove_file_button").hide();
        }

        if (data.scheduledSendAt && data.scheduledSendAt.toDate) {
            const dt = data.scheduledSendAt.toDate();  // JS Date in local time

            const yyyy = dt.getFullYear();
            const mm   = String(dt.getMonth() + 1).padStart(2, "0"); // 0-based month
            const dd   = String(dt.getDate()).padStart(2, "0");

            // This is what <input type="date"> expects: YYYY-MM-DD (local)
            $("#newsletter_send_date").val(`${yyyy}-${mm}-${dd}`);
        } else {
            $("#newsletter_send_date").val("");
        }

        // Store BOOTSTRAP data
        $modal
            .removeClass("hidden")
            .data({
                mode: "edit",
                docId: id,
                originalPath: data.path || null,
                originalURL: data.url || null,
                originalFilename: data.filename || ""
            });

        // Update UI labels
        $modal.find(".form_heading").text("Edit Newsletter");
        $modal.find("[type='submit']").text("Save Changes");

    } catch (err) {
        console.error("Edit-load error:", err);
        alert("Failed to load newsletter.");
    }
});

/*** PUSH */

$(document).on("click", ".push-newsletter-btn", async function () {
  const newsletterId = $(this).data("id");
  console.log("Pushing newsletter id:", newsletterId);
  if (!newsletterId) {
    alert("Missing newsletter id on this button.");
    return;
  }

  // Decide mode from radio buttons
  //const mode = $("input[name='newsletter_send_mode']:checked").val() || "live";
  const isTest = isNewsletterTestMode();
  const dedupeInTests = true;


  let options = {};
  let confirmMsg = "";

  if (isTest) {
    //const raw = $("#newsletter_test_emails").val() || "";
    /*const testEmails = raw
      .split(",")
      .map(e => e.trim())
      .filter(Boolean);
    */
    const testEmails = ["agarcia@nscds.org","artgarcia77@gmail.com",
        "web@mcree-ed.consulting"];
    if (!testEmails.length) {
      alert("Enter at least one test email.");
      return;
    }

    options = { testEmails, dedupeInTests };

    confirmMsg =
      `Send TEST newsletter to:\n\n` +
      testEmails.join("\n") +
      `\n\nDedupe in test mode: ${dedupeInTests ? "YES" : "NO"}`;
  } else {
    confirmMsg =
      "Send LIVE newsletter to all newsletter subscribers?\n\n" +
      "This will create email jobs in the /mail collection.";
  }

  if (!window.confirm(confirmMsg)) return;

  // UI feedback on the button
  const $btn = $(this);
  const originalText = $btn.text();
  $btn.prop("disabled", true).text("Sending…");

  try {
    const result = await pushNewsletter(newsletterId, options);
    const modeLabel = result.isTestMode ? "TEST" : "LIVE";

    alert(
      `${modeLabel} send complete.\n\n` +
      `Emails created this run: ${result.createdCount}\n` +
      `Skipped (already sent): ${result.skippedCount}\n` +
      `Total subscribers in DB: ${result.totalSubscribers}\n` +
      `Total targets this run: ${result.totalTargets}`
    );
  } catch (err) {
    console.error("pushNewsletter failed:", err);
    alert("Failed to push newsletter. Check console for details.");
  } finally {
    $btn.prop("disabled", false).text(originalText);
  }
});

async function pushNewsletter(newsletterId, options = {}) {
  const {
    testEmails = [],    // array of strings, or empty for live send
    dedupeInTests = false,
  } = options;

  if (!newsletterId) {
    throw new Error("Missing newsletter id");
  }

  // ----------------------------
  // 1) Load the newsletter doc
  // ----------------------------
  const newsletterRef = doc(db, "newsletters_data", newsletterId);
  const newsletterSnap = await getDoc(newsletterRef);

  if (!newsletterSnap.exists()) {
    throw new Error("Newsletter not found");
  }

  const data = newsletterSnap.data();
  const title    = data.title || "Newsletter";
  const url      = data.url;
  const filename = data.filename || "newsletter.pdf";
  const noteHtml = data.note || "";
  const noteText = stripHtml(noteHtml);

  if (!url) {
    throw new Error("Newsletter is missing a PDF URL.");
  }

  const isTestMode = Array.isArray(testEmails) && testEmails.length > 0;

  // ----------------------------
  // 2) Choose dedupe subcollection
  //    - live  → "recipients"
  //    - test  → "testRecipients"
  // ----------------------------
  const recipientsCol = collection(
    newsletterRef,
    isTestMode ? "testRecipients" : "recipients"
  );

  const recipientsSnap = await getDocs(recipientsCol);
  const alreadySent = new Set();
  recipientsSnap.forEach(recSnap => {
    alreadySent.add(recSnap.id); // doc id = emailKey(email)
  });

  // ----------------------------
  // 3) Build subscribers from newsletters_email only
  // ----------------------------
  const subscribersSnap = await getDocs(collection(db, "newsletters_email"));

  const subscribers = [];
  const seen = new Set(); // avoid duplicates

  subscribersSnap.forEach(docSnap => {
  const d = docSnap.data() || {};
  const email = (d.email || docSnap.id || "")
    .toString()
    .trim()
    .toLowerCase();

  if (!email || seen.has(email)) return;
  if (d.unsubscribed === true) return; // ← NEW: skip unsubscribed

  seen.add(email);

  subscribers.push({
    email,
    name: (d.name || "").toString(),
  });
});

  // ----------------------------
  // 4) Decide targets:
  //    - live: all subscribers
  //    - test: only testEmails
  // ----------------------------
  let targets;

  if (isTestMode) {
    const seenTest = new Set();
    targets = [];

    // quick lookup from email → subscriber (for names, if they exist)
    const lookup = new Map(subscribers.map(s => [s.email, s]));

    testEmails.forEach(raw => {
      const email = (raw || "").trim().toLowerCase();
      if (!email || seenTest.has(email)) return;
      seenTest.add(email);

      // Either use subscriber info (with name) or just bare email
      const entry = lookup.get(email) || { email, name: "" };
      targets.push(entry);
    });
  } else {
    targets = subscribers;
  }

  if (!targets.length) {
    return {
      createdCount: 0,
      skippedCount: 0,
      totalSubscribers: subscribers.length,
      totalTargets: 0,
      isTestMode,
    };
  }

  // ----------------------------
  // 5) Create docs in /mail for Trigger Email
  // ----------------------------
  const mailCol = collection(db, "mail");

  let createdCount = 0;
  let skippedCount = 0;
  const tasks = [];

  // live → always dedupe
  // test → dedupe only if dedupeInTests === true
  const shouldDedupe = !isTestMode || (isTestMode && dedupeInTests);

  for (const sub of targets) {
    const email = sub.email;
    if (!email) continue;

    const key = emailKey(email);

    if (shouldDedupe && alreadySent.has(key)) {
      skippedCount++;
      continue;
    }

    createdCount++;

    const namePart = sub.name ? ` ${sub.name}` : "";
    const greeting = "Hi,"; //sub.name ? `Hi ${sub.name},` : "Hi,";

    const subject = `Roots & Reason - ${title}`;

    // --- Footer (HTML & Text) ---
    const unsubscribeEmail = "web@mcree-ed.consulting";

    const footerHtml = `
      <p style="font-size:12px; color:#555; margin-top:16px;">
        You're receiving this email because you signed up for the Roots &amp; Reason newsletter
        at mcree-ed.consulting. If you no longer wish to receive these emails,
        you can <a href="mailto:${unsubscribeEmail}?subject=Unsubscribe%20Roots%20%26%20Reason">
        unsubscribe by email</a>.
      </p>
      <p style="font-size:12px; color:#555;">
        McRee Ed Consulting · Illinois · USA
      </p>
    `;

    const footerText = `
        ---
        You're receiving this email because you signed up for the Roots & Reason newsletter
        at mcree-ed.consulting. If you no longer wish to receive these emails, you can
        unsubscribe by emailing ${unsubscribeEmail} with "Unsubscribe Roots & Reason"
        in the subject line.

        McRee Ed Consulting
        Illinois, USA
        `;

    // --- Main bodies with footer appended ---
    const htmlBody = `
      <p>${greeting}</p>
      ${noteHtml}
      <p>Enjoy the Roots and Reason Newsletter below:</p>
      <p><a href="${url}">${filename}</a></p>
      <p>— Nicole</p>
      <hr />
      ${footerHtml}
    `;

    const textBody = `${greeting}

        ${noteText}

        View the newsletter: ${url}

        — Nicole
        ${footerText}
        `;

    const mailDoc = {
        to: [email],
        message: {
            subject,
            text: textBody,
            html: htmlBody,
        },
        newsletterId,
        mode: isTestMode ? "test" : "live",
        createdAt: serverTimestamp(),
    };

    const recipientRef = doc(recipientsCol, key);

    // If you still want to pause before actually sending, you can temporarily do:
    // console.log("Would send to:", email, "mailDoc:", mailDoc);
    // continue; // <-- prevents any writes

    tasks.push(
      addDoc(mailCol, mailDoc)
        .then(() =>
          setDoc(
            recipientRef,
            {
              email,
              name: sub.name || "",
              sentAt: serverTimestamp(),
            },
            { merge: true }
          )
        )
    );
  }

  await Promise.all(tasks);

  console.log("email sent");

  return {
    createdCount,
    skippedCount,
    totalSubscribers: subscribers.length,
    totalTargets: targets.length,
    isTestMode,
  };
}

// Toggle unsubscribed flag for a given email
async function setSubscriberUnsubscribed(email, flag) {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return;

  const qRef = collection(db, "newsletters_email");
  const q = query(qRef, where("email", "==", cleanEmail));
  const snap = await getDocs(q);

  if (snap.empty) {
    console.warn("No subscriber doc found for email:", cleanEmail);
    return;
  }

  const updates = [];
  snap.forEach(docSnap => {
    updates.push(
      updateDoc(docSnap.ref, {
        unsubscribed: !!flag,
      })
    );
  });

  await Promise.all(updates);
  console.log("Unsubscribe flag updated for:", cleanEmail, "→", !!flag);
}

function isNewsletterTestMode() {
  const el = document.getElementById("newsletter_test_mode");
  return !!(el && el.checked);
}

// Toggle unsubscribed flag in Firestore when checkbox is changed
$(document).on("change", ".subscriber-unsub-toggle", async function () {
  const email = $(this).data("email");
  const flag = this.checked;

  // Ask the user to type the email to confirm the change
  const actionText = flag ? "unsubscribe" : "resubscribe";
  
  const input = prompt(
    `To ${actionText} this subscriber, please type the email address:\n\n${email}`
  );

  // If cancelled or doesn't match, revert checkbox and cancel the update
  if (!input || input.trim().toLowerCase() !== email.toLowerCase()) {
    alert("Email did not match — no changes were made.");
    this.checked = !flag;
    return;
  }

  try {
    console.log("Updating unsubscribe:", email, "→", flag);
    await setSubscriberUnsubscribed(email, flag);
  } catch (err) {
    console.error("Failed to update unsubscribe flag:", err);
    alert("There was an issue updating this subscriber.");
    // Revert UI if Firestore write failed
    this.checked = !flag;
  }
});

/*$("#newsletter_test_mode").on("change", function () {
  if (!this.checked) {
    const input = prompt(
        `To go LIVE, type LIVE below to confirm:`
    );

    if (!input || input.trim() !== "LIVE") {
        alert("Did not type LIVE — remaining in TEST mode.");
        this.checked = true;
        return;
    }

    alert("⚠️ TEST MODE DISENABLED\nEmails will be sent LIVE.");
  }
});*/

async function getDeliveryReport(newsletterId, isTestMode = false) {
  if (!newsletterId) {
    throw new Error("Missing newsletterId");
  }

  const newsletterRef = doc(db, "newsletters_data", newsletterId);

  // Make sure the newsletter exists (optional but nice)
  const newsletterSnap = await getDoc(newsletterRef);
  if (!newsletterSnap.exists()) {
    throw new Error("Newsletter not found");
  }

  // 1) Recipients for this newsletter (live or test)
  const recipientsCol = collection(
    newsletterRef,
    isTestMode ? "testRecipients" : "recipients"
  );

  const recipientsSnap = await getDocs(recipientsCol);
  const receivedMap = new Map(); // email -> sentAt

  recipientsSnap.forEach(docSnap => {
    const d = docSnap.data() || {};
    const email = (d.email || docSnap.id || "").toString().toLowerCase();
    if (!email) return;
    receivedMap.set(email, d.sentAt || null);
  });

  // 2) All subscribers from newsletters_email
  const subsSnap = await getDocs(collection(db, "newsletters_email"));

  const received = [];
  const notReceived = [];
  const unsubscribed = [];

  subsSnap.forEach(docSnap => {
    const d = docSnap.data() || {};
    const email = (d.email || docSnap.id || "").toString().toLowerCase();
    const name  = (d.name || "").toString();
    if (!email) return;

    if (d.unsubscribed === true) {
      // keep separate so they don't show as "missed"
      unsubscribed.push({ name, email });
      return;
    }

    if (receivedMap.has(email)) {
      received.push({
        name,
        email,
        sentAt: receivedMap.get(email),
      });
    } else {
      notReceived.push({ name, email });
    }
  });

  return { received, notReceived, unsubscribed };
}

// ------------------------------
    // FILE HANDLING
    // ------------------------------

function setupFileUpload({
    inputSelector, 
    dropSelector, 
    previewSelector, 
    removeButtonSelector, 
    fileFilter,        // (file) => true/false
    previewRenderer,   // (file, $preview) => void
}) {
    const $input   = $(inputSelector);
    const $drop    = $(dropSelector);
    const $preview = $(previewSelector);
    const $remove  = $(removeButtonSelector);

    if (!$input.length || !$drop.length || !$preview.length) {
        console.warn("setupFileUpload: missing element(s) for", { inputSelector, dropSelector, previewSelector });
        return;
    }

    // Helper to clear
    function clearFile() {
        $input.val("");                 // clear file input
        $preview.hide().empty();        // hide/remove preview
        console.log("file cleared");
        $remove.hide();
    }

    // When file is selected via the label
    $input.on("change", function () {
        const file = this.files?.[0];
        if (!file) {
            clearFile();
            return;
        }
        if (fileFilter && !fileFilter(file)) {
            clearFile();
            return;
        }
        previewRenderer(file, $preview);
        $remove.show();
    });

    // Drag & drop styling
    $drop.on("dragover", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $drop.addClass("dragover");
    });

    $drop.on("dragleave", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $drop.removeClass("dragover");
    });

    $drop.on("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $drop.removeClass("dragover");

        const file = e.originalEvent.dataTransfer.files?.[0];
        if (!file) return;

        if (fileFilter && !fileFilter(file)) {
            clearFile();
            return;
        }

        // Push it into the real input so your submit handlers see it
        $input[0].files = e.originalEvent.dataTransfer.files;

        previewRenderer(file, $preview);
        $remove.show();
    });

    // Remove / clear button
    if ($remove.length) {
        $remove.on("click", function () {
            clearFile();
        });
    }
}