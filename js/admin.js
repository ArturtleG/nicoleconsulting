

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
    deleteObject
} from "./firebaseSetup.js";

import {
    signInWithPopup,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js";

import { getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js";


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
    $(document).on("click", "#new_post_button", function() {
        // 1) Heading and button text
        $("#form_heading").text("New Post");
        $("#post_button").text("Publish Post");

        // 2) Clear any stored edit state
        $("#modal_post_form")
            .removeData("original-slug")
            .removeData("original-created-at");

        // 3) Reset the form inputs
        const form = document.getElementById("post_form");
        form.reset();

        // 4) Clear the Trix editor’s content
        document.querySelector("trix-editor").editor.loadHTML("");

        // 5) Hide any image preview
        $("#image").val("");              // reset the file input
        $("#image_preview")
            .attr("src", "")                // remove the src attribute
            .hide();                        // optionally hide the <img> element

        // 6) Show the modal
        $("#modal_post_form").removeClass("hidden");
    });

    $(".close_button").click(function () {
        console.log("Close button clicked");
        $(this).closest(".modal").addClass("hidden");
    });


    // --------------------------------------------------
    // D) FORM SUBMISSION → UPLOAD IMAGE + WRITE FIRESTORE
    // --------------------------------------------------
    $("#post_form").on("submit", async function (event) {
        event.preventDefault();
        $("#statusMsg").text("Publishing…");

        const $modal            = $("#modal_post_form");
        const originalSlug      = $modal.data("original-slug")       || null;
        const originalCreatedAt = $modal.data("original-created-at") || null;
        const originalImageURL  = $modal.data("original-imageURL")   || null;

        // 1) Read & slugify title
        const titleRaw = $("#title").val().trim();
        if (!titleRaw) {
            $("#statusMsg").text("Title is required.");
            return;
        }

        // 2) Slug logic
        let baseSlug = $("#slug").val().trim();
        baseSlug     = baseSlug ? slugify(baseSlug) : slugify(titleRaw);

        //    reuse old slug if unchanged, otherwise generate unique one
        const slug = originalSlug && originalSlug === baseSlug
        ? originalSlug
        : await ensureUniqueSlug(baseSlug);
        $("#slug").val(slug);

        // 3) Tags
        const tagsRaw = $("#tags").val().trim();
        const tags = tagsRaw
            ? tagsRaw
                .split(/\s*,\s*/)    // [ "tag1", "", "tag2", "" ]
                .filter(tag => tag)  // [ "tag1", "tag2" ]
            : [];

        // 4) Cover‐image file
        const coverFile = document.getElementById("image").files[0] || null;
        let   imageURL  = originalImageURL;

        try {
            // 5) Upload new cover image if provided
            if (coverFile) {
                const coverRef = storageRef(storage, `posts/${slug}/cover.jpg`);
                await uploadBytes(coverRef, coverFile);
                imageURL = await getDownloadURL(coverRef);
            }

            // 6) Upload inline Trix attachments all at once
            const trixEditor  = document.querySelector("trix-editor");
            const attachments = trixEditor.editor.getDocument().getAttachments();
            const inlineUploads = [];

            attachments.forEach(att => {
                if (att.file) {
                const file = att.file;
                const ext  = file.name.split(".").pop();
                const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                const path = `posts/${slug}/inline-images/${filename}`;
                const imgRef = storageRef(storage, path);

                const p = uploadBytes(imgRef, file)
                    .then(() => getDownloadURL(imgRef))
                    .then(url => att.setAttributes({ url }))    // no href → no <a>
                    .catch(err => console.error("Inline upload failed:", err));

                inlineUploads.push(p);
                }
            });
            await Promise.all(inlineUploads);

            // 7) Grab final HTML
            const contentHtml = $("#content").val();
            if (!contentHtml) {
                $("#statusMsg").text("Content is required.");
                return;
            }

            // 8) Build post object
            const postData = {
                title:     titleRaw,
                slug:      slug,
                tags:      tags,
                content:   contentHtml,
                imageURL:  imageURL,
                createdAt: originalCreatedAt || serverTimestamp(),
                editedAt:  serverTimestamp()
            };

            // 9) Write (or overwrite) the doc
            await setDoc(doc(db, "posts", slug), postData);

            // 10) If the slug was changed, delete the old document
            if (originalSlug && originalSlug !== slug) {
                await deleteDoc(doc(db, "posts", originalSlug));
            }

            // 11) Success UI
            $("#statusMsg").text("Post saved!");
            this.reset();
            document.querySelector("trix-editor").editor.loadHTML("");
            $("#image_preview").attr("src", "").hide();

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
  
    async function loadPreviousPosts() {
        try {
            const postsCol = collection(db, "posts");
            const q = query(postsCol, orderBy("createdAt", "desc"));
            const snapshot = await getDocs(q);
            const $list = $("#previous_posts");
            $list.empty();

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const slug = docSnap.id;
                const title = data.title;
                const tags = processTags(data.tags);
                const date = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : "no date";
                const content = data.content || "no content";
                const coverImg = data.imageURL ?
                    `<img class="blog_cover_image" src="${data.imageURL}" alt="Cover image for ${title}">` : "";
                const $post = $(`
                <div class="blog_post_wrapper">
                    <div class="blog_tags">${tags}</div>
                    ${coverImg}
                    <h2>${title}</h2>
                    <hr>
                    <div class="blog_date">Posted on ${date}</div>
                    <div class="blog_content">${content}</div>
                    <div class="button_wrapper">
                        <button class="delete-post-btn primary-button" data-slug="${slug}">
                            delete
                        </button>

                        <button class="edit-post-btn primary-button" data-slug="${slug}">
                            edit
                        </button>
                    </div>
                </div>
                `);
                $list.append($post);
            });
        } catch (err) {
            console.error("Error loading previous posts:", err);
        }
    }
  
    // Call it once on page load (after auth state is determined)
    loadPreviousPosts();

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

            // 2) Load Trix editor HTML
            document.querySelector("trix-editor").editor.loadHTML(data.content);

            // 3) Show cover image preview if one exists
            if (data.imageURL) {
            $("#image_preview")
                .attr("src", data.imageURL)
                .show();
            } else {
                $("#image_preview").hide();
            }

            // 4) Update modal heading & button text
            $("#form_heading").text("Edit Post");
            $("#post_button").text("Save Changes");

            // 5) Store original slug, createdAt and imageURL on the modal
            $("#modal_post_form")
                .data("original-slug",       slug)
                .data("original-created-at", data.createdAt)
                .data("original-imageURL",   data.imageURL || null);

            // 6) Show the modal
            $("#modal_post_form").removeClass("hidden");

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

}); // end of $(function())

function processTags(input) {
    let tagHTML = "";
    for (let i = 0; i < input.length; i++) {
        tagHTML += `<button class="blog_tag_button primary-button">${input[i]}</button>`;
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
