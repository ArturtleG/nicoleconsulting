

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
  storage,
  storageRef,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL
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
  $("#new_post_button").click(function () {
    $("#modal").fadeIn(300);
  });

  $("#post_close_button").click(function () {
    $("#modal").fadeOut(200);
  });


  // --------------------------------------------------
  // D) FORM SUBMISSION → UPLOAD IMAGE + WRITE FIRESTORE
  // --------------------------------------------------
  $("#post_form").on("submit", async function (event) {
  event.preventDefault();
  $("#statusMsg").text("Publishing…");

  // 1) Read & slugify title
  const titleRaw = $("#title").val().trim();
  if (!titleRaw) {
    $("#statusMsg").text("Title is required.");
    return;
  }

  // Slug logic
  let baseSlug = $("#slug").val().trim();
  baseSlug = baseSlug ? slugify(baseSlug) : slugify(titleRaw);
  const slug = await ensureUniqueSlug(baseSlug);
  $("#slug").val(slug);

  // Tags
  const tagsRaw = $("#tags").val().trim();
  const tags    = tagsRaw ? tagsRaw.split(/\s*,\s*/) : [];

  // Cover-image file
  const coverFile = document.getElementById("image").files[0] || null;

  try {
    let imageURL = null;

    // 2) Upload cover image if present
    if (coverFile) {
      const coverRef = storageRef(storage, `posts/${slug}/cover.jpg`);
      await uploadBytes(coverRef, coverFile);
      imageURL = await getDownloadURL(coverRef);
    }

    // 3) Upload inline Trix attachments now (instead of on add)
    const trixEditor  = document.querySelector("trix-editor");
    const attachments = trixEditor.editor.getDocument().getAttachments();
    const inlineUploads = [];

    attachments.forEach(att => {
      if (att.file) {
        const file = att.file;
        // generate unique filename
        const ext      = file.name.split(".").pop();
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const path     = `posts/${slug}/inline-images/${filename}`;
        const imgRef   = storageRef(storage, path);

        // upload + then replace src with real URL
        const p = uploadBytes(imgRef, file)
          .then(() => getDownloadURL(imgRef))
          .then(url => {
            att.setAttributes({ url });   // no href → no <a> wrapper
          })
          .catch(err => {
            console.error("Inline upload failed:", err);
          });

        inlineUploads.push(p);
      }
    });

    // wait for all inline images to finish uploading
    await Promise.all(inlineUploads);

    // 4) Now grab the final HTML from the Trix hidden input
    const contentHtml = $("#content").val();
    if (!contentHtml) {
      $("#statusMsg").text("Content is required.");
      return;
    }

    // 5) Build and write the Firestore document
    const postData = {
      title:     titleRaw,
      slug:      slug,
      tags:      tags,
      content:   contentHtml,
      imageURL:  imageURL,
      createdAt: serverTimestamp()
    };
    await setDoc(doc(db, "posts", slug), postData);

    // 6) Success UI
    $("#statusMsg").text("Post published successfully!");
    this.reset();
    $previewImg.hide();
    setTimeout(() => {
      $("#modal").fadeOut(200);
      $("#statusMsg").text("");
      loadPreviousPosts();
    }, 1000);

  } catch (error) {
    console.error("Error publishing post:", error);
    $("#statusMsg").text("Error: " + error.message);
  }
});


  /*$("#post_form").on("submit", async function (event) {
    event.preventDefault();
    $("#statusMsg").text("Publishing…");

    // 1) Read values from the form
    const title       = $("#title").val().trim();

    let   baseSlug = $("#slug").val().trim();
    if (!baseSlug) {
        baseSlug = slugify(title);
    } else {
        baseSlug = slugify(baseSlug);
    }

    // 2. Ensure it's unique (appends "-2", "-3", … if needed)
    const slug = await ensureUniqueSlug(baseSlug);

    // 3. Update the slug input so the UI reflects what we'll use
    $("#slug").val(slug);
    
    const tagsRaw     = $("#tags").val().trim();
    const tags        = tagsRaw ? tagsRaw.split(/\s*,\s*/    //) : [];
    /*const contentHtml = $("#content").val();   // Trix editor puts its HTML here
    const fileInputEl = document.getElementById("image");
    const file        = fileInputEl.files[0] || null;

    // Basic validation
    if (!title || !slug || !contentHtml) {
      $("#statusMsg").text("Title, slug, and content are required.");
      return;
    }

    try {
      let imageURL = null;

      // 2) If a cover image was chosen, upload it to Storage
      if (file) {
        const storagePath = `posts/${slug}/cover.jpg`;
        const imgRef      = storageRef(storage, storagePath);

        // Upload the file bytes
        await uploadBytes(imgRef, file);

        // Get a public download URL
        imageURL = await getDownloadURL(imgRef);
      }

      // 3) Build the post object for Firestore
      const postData = {
        title:       title,
        slug:        slug,
        tags:        tags,
        content:     contentHtml,
        imageURL:    imageURL,
        createdAt:   serverTimestamp()
      };

      // 4) Write (or overwrite) a document at posts/{slug}
      await setDoc(doc(db, "posts", slug), postData);

      // 5) Show success, reset form, and close modal
      $("#statusMsg").text("Post published successfully!");
      this.reset();
      $previewImg.hide();

      setTimeout(() => {
        $("#modal").fadeOut(200);
        $("#statusMsg").text("");
      }, 1000);
      loadPreviousPosts()
    } catch (error) {
      console.error("Error publishing post:", error);
      $("#statusMsg").text("Error: " + error.message);
    }
    });*/

    /*document.addEventListener("trix-attachment-add", async (event) => {
        const attachment = event.attachment;
        if (!attachment.file) return;             // only care about new file attachments

        // 1. Generate a unique path for this inline image
        const file     = attachment.file;
        const ext      = file.name.split(".").pop();
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const path     = `posts/inline-images/${filename}`;

        // 2. Create a Storage ref and upload
        const imgRef = storageRef(storage, path);
        const uploadTask = uploadBytesResumable(imgRef, file);

        // 3. Update Trix’s progress bar
        uploadTask.on("state_changed", snap => {
            const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
            attachment.setUploadProgress(pct);
        });

        // 4. When done, get the download URL and update the attachment
        uploadTask.then(async snapshot => {
            const url = await getDownloadURL(snapshot.ref);
            attachment.setAttributes({
                url: url
                //href: url   // so clicking it opens the full image
            });
        }).catch(err => {
            console.error("Upload failed:", err);
            // you could show an error in the editor here…
        });
    });*/

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
                    <button class="edit-post-btn primary-button" data-slug="${slug}">
                        edit
                    </button>
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
  
   // Then you could bind a click handler on .edit-post-btn to load that post’s data into the modal


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
