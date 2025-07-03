import {
    auth,
    provider,
    db,
    collection,
    query, 
    where, 
    orderBy, 
    getDocs,
    increment,
    doc,
    updateDoc,
    onSnapshot
} from "./firebaseSetup.js";

let modal = $("#modal_wrapper");
let modalMessage = $("#modal_message_wrapper");
let modalForm = $("#modal_wrapper form");
let modalFormHeader = $("#modal_wrapper #form_heading");
let modalFormMessage = $("#modal_wrapper #form_message");
let modalText = $("#modal_text");
let modalTitle = $("#modal_title");
let modalTypeForm = $(".type_form");


// 2) WRAP EVERYTHING IN A JQUERY READY CALLBACK
$(function () {  
    $("#icon_contact").click(function (e) {
        //e.preventDefault(); // Prevent default anchor click behavior
        showContactForm();
    });

    $(".modal_close").click(function (e) {
        console.log("close button clicked");
        //e.preventDefault(); // Prevent default anchor click behavior
        closeModal(this);
    });
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
                const numHearts = data.hearts;
                const alreadyHearted = JSON.parse(localStorage.getItem('hearted')||'[]').includes(slug);

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
                        <div class="blog_post_wrapper row white" data-slug="${slug}">
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
                            <div class="button_wrapper small_gap">
                                <div class="blog_heart_button"></div>
                                <span class="blog_heart_num">${numHearts}</span>
                            </div>
                        </div>
                    </section>
                `);

                $list.append($post);
            });
            return postNum;

        } catch (err) {
            console.error("Error loading posts:", err);
            return 0; // return 0 if error occurs;
        }
    }

  
    // Call it once on page load (after auth state is determined)
    loadPreviousPosts().then(() => {
        // then start listening for changes
        let initial = true;
        const postsQuery = query(
            collection(db, "posts"),
            orderBy("createdAt", "desc")
        );
        
        onSnapshot(postsQuery, snapshot => {
            // skip the very first snapshot (it’s just our initial load)
            if (initial) {
            initial = false;
            return;
            }
            
            snapshot.docChanges().forEach(change => {
            const slug = change.doc.id;
            const data = change.doc.data();
            
            if (change.type === "added") {
                // 🚨 New post arrived!
                $("#notification_banner").fadeIn();
            }
            
            if (change.type === "modified") {
                // ❤️ Maybe hearts or other fields changed — update only the counter
                const $heartNum = $(`.blog_post_wrapper[data-slug="${slug}"] .blog_heart_num`);
                if ($heartNum.length) {
                    $heartNum.text(data.hearts ?? 0);
                }
            }
            
            // you could also handle `removed` here if you want to auto-remove deleted posts
            });
        });
    });

    $("#clear_filter").click(function(){
        loadPreviousPosts();
        $(this).fadeOut(800);
    });


    $(document).on("click", ".blog_tag_button", async function() {
        const tag = $(this).data("tag");
        const numPosts = await loadPreviousPosts(tag);
        $("#clear_filter").text(`${tag} (${numPosts})`).fadeIn(800);
    });

    $(document).on("click", ".blog_heart_button", async function(){
        console.log("hearted");
        const $btn   = $(this);
        const slug   = $btn.closest(".blog_post_wrapper").data("slug");
        const postRef = doc(db, "posts", slug);

        const $count = $btn.siblings(".blog_heart_num");
        console.log("Current heart count:", $count.text());

        // load or init our “hearted” list
        let hearted = JSON.parse(localStorage.getItem("hearted") || "[]");
        if (hearted.includes(slug)){
            console.log("Already hearted this post");
            // Populate modal text
            $(".messages_heading").text("Already Hearted");
            $(".messages_content").html(`
                You have already hearted this post.
            `);

            // Turn the “OK” button into “No”
            $("#modal_messages .close_button").text("Close");

            // Show the modal
            $("#modal_messages").removeClass("hidden");
            return;
        }             // already done

        // optimistically update UI
        //const $count = $btn.find(".blog_heart_num");
        //console.log("Current heart count:", $count.text());
        $count.text( Number($count.text()) + 1 );
        $btn.prop("disabled", true);

        // update Firestore
        try {
            await updateDoc(postRef, { hearts: increment(1) });
            // record so we don’t let them heart again:
            hearted.push(slug);
            localStorage.setItem("hearted", JSON.stringify(hearted));
        } catch (e) {
            console.error("Couldn't heart:", e);
            // rollback UI if you want:
            $count.text( Number($count.text()) - 1 );
            $btn.prop("disabled", false);
        }
    });

    $(".close_button").click(function () {
        console.log("Close button clicked");
        $(this).closest(".modal").addClass("hidden");
    });

    // “Load it” replaces the list with the newest data
    $("#load-new-post").on("click", () => {
        $("#notification_banner").hide();
        loadPreviousPosts();
    });

    // “Later” just hides the banner
    $("#dismiss-new-post").on("click", () => {
        $("#notification_banner").hide();
    });
}); // end of $(function())

function showContactForm(){
    showForm(
        "https://formspree.io/f/mnndgnqz",
        "Contact",
        `<p>
            Discover more about my work! Below are samples. For a more detailed look, 
            please send me a message, and I will respond as soon as possible. Thank you 
            for reaching out!
        </p>
        <div class="button_wrapper u-flex-center">
            <a href="https://drive.google.com/drive/folders/1Prrg3mlEv0TZ6Ha174LWF4ufzyHZMR8n?usp=sharing" target="_blank" class="primary-button">
                Click for Samples
            </a>
        </div>`,
        "message", 
        "I will get back to you as soon as possible.",
        "showContactButton"
    )
}

function showForm(action, header, message, type, response, callback=null) {
    modalForm.attr("action", action);
    modalTypeForm.text(type);
    modalFormHeader.text(header + " Nicole");
    modalFormMessage.html(message);
    modalTitle.text("Thank you for sumitting your " + type + ".");
    modalText.text(response);

    console.log("showForm header:", header);
    console.log("showForm callback:", callback);

    if(callback)
        modalForm.attr("callback", callback);

    //modal.removeClass("no_display");
    modalForm.removeClass("no_display");

    modal.css("display", "flex")
    .hide()
    .fadeIn(800);
}

const callbacks = {
    showContactButton
}

function closeModal(buttonClicked) {
    //modal.addClass("no_display");
    modal.fadeOut(800);
    modalMessage.addClass("no_display");
    modalForm.addClass("no_display");
    modalForm.each(function() {
        $(this)[0].reset();
    })

    console.log("buttonClicked:", buttonClicked);

    let callback = $(buttonClicked).closest("form").attr("callback");

    console.log("closeModal callback:", callback);

    if(callback && callbacks[callback] && typeof callbacks[callback] === 'function') {
        console.log("Executing callback function:", callback);
        callbacks[callback].call();
        $(buttonClicked).closest("form").attr("callback","");
    }
}

function showContactButton(){
    console.log("showContactButton called");
    //$("#icon_contact").css("opacity", 0).removeClass("no_display");
    gsap.to(
        "#icon_contact", 
        {
            scale:1.3,
            duration: .8, 
            yoyoEase: "easyInOut",
            yoyo: true, 
            repeat:1,
            onComplete() {
                // remove anything left over on the "style" attribute
                document.querySelector("#icon_contact")?.removeAttribute("style");
            }
        }
    );
}

document.addEventListener("DOMContentLoaded", function () {
    const form = document.querySelector("#modal_wrapper form");

    if (!form) {
        console.log("Form not found in modal_wrapper.");
        return;
    }

    form.addEventListener("submit", function (e) {
        e.preventDefault(); // stop default form submission so we can handle it manually

        const formData = new FormData(form);

        fetch(form.action, {
            method: form.method,
            body: formData,
            headers: {
                'Accept': 'application/json'
            }
        }).then(response => {
        if (response.ok) {
            modalMessage.removeClass("no_display");
            modalForm.addClass("no_display");
            form.reset();
        } else {
            alert("There was a problem submitting the form. Please try again.");
        }
        }).catch(error => {
            alert("There was a problem submitting the form.");
        });
    });
});