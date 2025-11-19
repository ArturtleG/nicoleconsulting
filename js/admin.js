

// 1) IMPORT AUTH, FIRESTORE, AND STORAGE HELPERS
import {
    auth,
    provider,
    db,
    serverTimestamp,
    doc,
    setDoc,
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
 /*   const $dropArea   = $(".upload-drop-area");
    const $fileInput  = $("#image");
    const $previewImg = $("#image_preview");

    function handleImage(file) {
        if (file && file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = function (e) {
                $previewImg.attr("src", e.target.result).show();
            };
            reader.readAsDataURL(file);
        }
    }

  // When a file is selected via the “Upload Cover Image” label
    $fileInput.on("change", function () {
        const file = this.files[0];
        handleImage(file);
    });

  // Drag & drop styling & logic
    $dropArea.on("dragover", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $dropArea.addClass("dragover");
    });

    $dropArea.on("dragleave", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $dropArea.removeClass("dragover");
    });

    $dropArea.on("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $dropArea.removeClass("dragover");
        const file = e.originalEvent.dataTransfer.files[0];
        if (file) {
            // Update the hidden file input so form submission can see it
            $fileInput[0].files = e.originalEvent.dataTransfer.files;
            handleImage(file);
        }
    }); */


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
        const titleRaw = $("#title").val().trim();
        if (!titleRaw) {
            $("#statusMsg").text("Title is required.");
            return;
        }

        // 2) Slug logic
        let baseSlug = $("#slug").val().trim();
        baseSlug = baseSlug ? slugify(baseSlug) : slugify(titleRaw);
        const slug = (originalSlug === baseSlug)
            ? originalSlug
            : await ensureUniqueSlug(baseSlug);
        $("#slug").val(slug);

        // 3) Tags array
        const tagsRaw = $("#tags").val().trim();
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
            const trixEditor   = document.querySelector("trix-editor");
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
            document.querySelector("trix-editor").editor.loadHTML("");
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
            $("#title").val(data.title);
            $("#slug").val(data.slug);
            $("#tags").val(data.tags.join(", "));

            console.log("hearts:", data.hearts);

            // 2) Load Trix editor HTML
            document.querySelector("trix-editor").editor.loadHTML(data.content);

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

function processTags(input) {
    let tagHTML = "";
    for (let i = 0; i < input.length; i++) {
        tagHTML += `<button type="button" class="blog_tag_button primary-button">${input[i]}</button>`;
    }
    return tagHTML;
}

// On Title input → update Slug
$("#title").on("input", function() {
    const title = $(this).val();
    const autoSlug = slugify(title);
    $("#slug").val(autoSlug);
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
  $wrapper.html('<div class="contact_list_row"><div>Loading…</div></div>');

  try {
    // fetch both collections in parallel
    const [contactsSnap, newslettersSnap] = await Promise.all([
      getDocs(collection(db, "contacts")),
      getDocs(collection(db, "newsletters_email")),
    ]);

    // Merge into a map keyed by normalized email
    const byEmail = new Map();

    // helper to upsert an entry
    const upsert = ({ name, email, isContact = false, isNewsletter = false }) => {
      if (!email) return;
      const key = email.trim().toLowerCase();
      const existing = byEmail.get(key) || { name: "", email: key, isContact: false, isNewsletter: false };

      // prefer non-empty name if one source has it
      const nextName = existing.name || name || "";

      byEmail.set(key, {
        name: nextName,
        email: key,
        isContact: existing.isContact || isContact,
        isNewsletter: existing.isNewsletter || isNewsletter,
      });
    };

    contactsSnap.forEach(doc => {
      const d = doc.data() || {};
      // doc.id is your sanitized email, but use field if available
      const email = (d.email || doc.id || "").toString();
      const name  = (d.name || "").toString();
      upsert({ name, email, isContact: true });
    });

    newslettersSnap.forEach(doc => {
      const d = doc.data() || {};
      const email = (d.email || doc.id || "").toString();
      const name  = (d.name || "").toString();
      upsert({ name, email, isNewsletter: true });
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
      $wrapper.html('<div class="contact_list_row"><div>No contacts yet.</div></div>');
      return;
    }

    const html = rows.map(({ name, email, isContact, isNewsletter }) => `
      <div class="contact_list_row">
        <div>${escapeHtml(name)}</div>
        <div class="email">${escapeHtml(email)}</div>
        <div class="type_contact_wrapper">
          <div class="subscription ${isContact ? "contact" : ""}"></div>
          <div class="subscription ${isNewsletter ? "newsletter" : ""}"></div>
        </div>
      </div>
    `).join("");

    $wrapper.html(html);

    // Optionally: trigger your existing filter once to apply initial state
    $("#contact_choice_wrapper input").trigger("change");

  } catch (err) {
    console.error("Failed loading contacts/newsletters:", err);
    $(".contacts_list_wrapper").html(
      `<div class="contact_list_row"><div>Failed to load entries.</div></div>`
    );
  }
}

// call it when the admin page is ready / after auth completes
$(loadContactsAndNewsletters);


$("#contact_choice_wrapper input").on("change", function() {
    let showContacts = $("#contacts_check").is(":checked");
    let showNewsletters = $("#newsletter_check").is(":checked");
    let allRows = $(".contact_list_row:not(.header_row)");

    allRows.hide();

    allRows.each(function(){
        const isContact    = $(this).find(".subscription.contact").length > 0;
        const isNewsletter = $(this).find(".subscription.newsletter").length > 0;

        if(showContacts && isContact || showNewsletters && isNewsletter){
            $(this).show();
        }
    });
});

$("#copy_addresses_button").on("click", async function() {
    const $email_modal = $("#email_copied_result .small_modal");
    const emails = [];
    $(".contact_list_row:not(.header_row):visible").each(function() {
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
                
            });

        // reset headings/buttons
        $("#newsletter_preview_modal .form_heading").text("New Newsletter");
        $("#newsletter_preview_modal [type='submit']").text("Publish Newsletter");
});

/*$("#upload_newsletter_button").on("click", () => {
    $("#newsletter_pdf_input").trigger("click");
});*/

// helper: safe filename
const safeName = (name) => name.replace(/[^\w.\-]+/g, "_");

// Handle newsletter form submit
$("#newsletter_preview_modal form").on("submit", function (e) {
    e.preventDefault();

    const $modal = $("#newsletter_preview_modal");

    // 1) Grab values from *inside* the newsletter modal
    const titleRaw = $("#newsletter_preview_modal #title").val().trim();
    const title    = titleRaw || "NEWSLETTER";

    const tagsRaw = $("#newsletter_preview_modal #tags").val().trim();
    const tags = tagsRaw
        ? tagsRaw.toLowerCase().split(/\s*,\s*/).filter(Boolean)
        : [];

    // Trix writes HTML into the hidden input
    const noteHtml = $("#newsletter_note").val() || "";

    // 2) Get the PDF file from newsletter_input
    const fileInput = document.getElementById("newsletter_input");
    const file = fileInput.files && fileInput.files[0];

    if (!file) {
        alert("Please select a PDF newsletter file.");
        return;
    }

    // 3) Validate PDF and size
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

                // 7) Save metadata in Firestore
                await addDoc(collection(db, "newsletters_data"), {
                    kind: "newsletter_pdf",
                    title,
                    path,
                    url,
                    filename: file.name,
                    note: noteHtml,
                    tags,
                    uploadedAt: serverTimestamp(),
                });

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
                alert("Newsletter saved upload failed. Check console for details.");
            }
        }
    );
});

/*// change → upload
$("#newsletter_pdf_input").on("change", function () {
    const file = this.files?.[0];
    if (!file) return;

    // 1) Validate PDF and size (tweak size limit as you like)
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) { alert("Please select a PDF."); this.value = ""; return; }

    const MAX_MB = 25;

    if (file.size > MAX_MB * 1024 * 1024) {
        alert(`PDF must be ≤ ${MAX_MB} MB.`);
        this.value = "";
        return;
    }

    // 2) Build a storage path
    // Default: newsletters/<timestamp>_<filename>.pdf
    // If you prefer per-post or per-slug: `posts/${slug}/assets/${...}`
    const ts = Date.now();
    const path = `newsletters/${ts}_${safeName(file.name)}`;
    const title    =  "NEWSLETTER";

    const storage = getStorage();
    const fileRef = storageRef(storage, path);

    // 3) Optional metadata + nice caching
    const metadata = {
        contentType: "application/pdf",
        cacheControl: "public,max-age=31536000,immutable"
    };

    // 4) Start upload with progress
    const task = uploadBytesResumable(fileRef, file, metadata);

    $("#upload_progress").show().val(0);
    $("#upload_status").text("Uploading…");

    task.on("state_changed",
        (snap) => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            $("#upload_progress").val(pct);
            $("#upload_status").text(`Uploading… ${pct}%`);
        },
        (err) => {
            console.error("Upload error:", err);
            $("#upload_status").text("Upload failed.");
            alert("Upload failed. Check console for details.");
            $("#upload_progress").hide().val(0);
            this.value = "";
        },
        async () => {
            // 5) Done → get URL
            const url = await getDownloadURL(task.snapshot.ref);
            $("#upload_status").text("Upload complete.").fadeOut(800);

            $("#upload_progress").hide().val(0);
            this.value = "";

            // 6) (Optional) Save a record in Firestore so you can list/download later
            // You can replace this with setDoc(doc(db,"posts",slug), {newsletterUrl: url}, {merge:true})
            await addDoc(collection(db, "newsletters_data"), {
                kind: "newsletter_pdf",
                title,
                path,
                url,
                filename: file.name,
                uploadedAt: serverTimestamp()
            });

            // 7) Show the URL or wire it into your UI as needed
            console.log("PDF available at:", url);
            loadNewsletters();
        }
    );
});*/



async function loadNewsletters() {
  const container = $("#previous_newsletters");
  container.empty().append("<p>Loading newsletters...</p>");

  try {
    // Query newsletters_data ordered by uploadedAt descending
    const q = query(collection(db, "newsletters_data"), orderBy("uploadedAt", "desc"));
    const querySnapshot = await getDocs(q);

    container.empty(); // clear the "Loading..." message

    if (querySnapshot.empty) {
      container.append("<p>No newsletters found.</p>");
      return;
    }

    querySnapshot.forEach(docSnap => {
      const data = docSnap.data();
      const title = data.title || "Untitled";
      const url = data.url || "#";
      const uploadedAt = data.uploadedAt?.toDate
        ? data.uploadedAt.toDate()
        : new Date();
      
      // Format date
      const formattedDate = uploadedAt.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      // Build row HTML
      const row = $(`
        <div class="newsletter_row">
          <a href="${url}" target="_blank" class="newsletter_title">${title}</a>
          <div class="newsletter_date">${formattedDate}</div>
        </div>
      `);

      container.append(row);
    });

  } catch (error) {
    console.error("Error loading newsletters:", error);
    container.html(`<p style="color:red;">Error loading newsletters. Check console for details.</p>`);
  }
}

// Call on page load or after upload completes
$(document).ready(() => {
  loadNewsletters();
});

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