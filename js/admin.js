

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
    const $postsSection  = $("#previous_posts_wrapper");
    const $loginButton   = $("#login_button");

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
            $postsSection.show();
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
            $postsSection.show();
            $loginWrapper.hide();
        } else {
            $postsSection.hide();
            $loginWrapper.show();
        }
    });


    // --------------------------------------------------
    // B) IMAGE PREVIEW / DRAG & DROP (UNCHANGED)
    // --------------------------------------------------
    const $dropArea   = $("#image_drop_area");
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
    });


    // --------------------------------------------------
    // C) MODAL SHOW/HIDE FOR “NEW POST”
    // --------------------------------------------------
    $("#new_post_button").click(function () {
        // reset the HTML form
        $("#post_form")[0].reset();
        // clear the trix editor
        document.querySelector("trix-editor").editor.loadHTML("");

        // hide any old cover-preview
        $("#image_preview").hide();

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
        $("#form_heading").text("New Post");
        $("#post_button").text("Publish Post");
        $("#modal_post_form").removeClass("hidden");
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
            $("#form_heading").text("Edit Post");
            $("#post_button").text("Save Changes");

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
        $(this).closest(".modal").addClass("hidden");
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
